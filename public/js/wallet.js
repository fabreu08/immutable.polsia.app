/**
 * public/js/wallet.js — EVM wallet connector for Immutable QC.
 * Manages MetaMask / injected wallet connection and on-chain QC packet signing.
 * Does NOT own contract deployment or token logic — only wallet state and signing.
 */

/* global ethers */

const IQC_WALLET = (() => {
  // Known chain configs — extensible, not limited to these
  const CHAINS = {
    84532:   { name: 'Base Sepolia',   explorer: 'https://sepolia.basescan.org' },
    8453:    { name: 'Base',            explorer: 'https://basescan.org' },
    1:       { name: 'Ethereum',        explorer: 'https://etherscan.io' },
    11155111:{ name: 'Sepolia',         explorer: 'https://sepolia.etherscan.io' },
    137:     { name: 'Polygon',         explorer: 'https://polygonscan.com' },
    42161:   { name: 'Arbitrum One',    explorer: 'https://arbiscan.io' },
    10:      { name: 'Optimism',        explorer: 'https://optimistic.etherscan.io' },
  };

  // IQC contract on Base Sepolia — used when on that chain
  const IQC_CONTRACT = '0x5a1014b0221ee57078f5d63e32c841834464d2f9';
  const IQC_CHAIN_ID = 84532; // Base Sepolia

  // Minimal ERC-20 ABI for optional IQC token interaction
  const ERC20_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
  ];

  let provider = null;
  let signer = null;
  let connectedAddress = null;
  let currentChainId = null;

  // ── State listeners ──
  const listeners = [];
  function onStateChange(fn) { listeners.push(fn); }
  function emit() {
    const state = getState();
    listeners.forEach(fn => fn(state));
  }

  function getState() {
    return {
      connected: !!connectedAddress,
      address: connectedAddress,
      chainId: currentChainId,
      chainName: currentChainId ? (CHAINS[currentChainId]?.name || `Chain ${currentChainId}`) : null,
      isIqcChain: currentChainId === IQC_CHAIN_ID,
    };
  }

  // ── Detection ──
  function isWalletAvailable() {
    return typeof window !== 'undefined' && !!window.ethereum;
  }

  // ── Connect ──
  async function connect() {
    if (!isWalletAvailable()) {
      throw new Error('No EVM wallet detected. Install MetaMask or a compatible wallet.');
    }

    provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send('eth_requestAccounts', []);
    if (!accounts || accounts.length === 0) throw new Error('No accounts returned');

    signer = await provider.getSigner();
    connectedAddress = await signer.getAddress();

    const network = await provider.getNetwork();
    currentChainId = Number(network.chainId);

    // Listen for account and chain changes
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    emit();
    return getState();
  }

  function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
      disconnect();
    } else {
      connectedAddress = accounts[0];
      emit();
    }
  }

  function handleChainChanged(chainIdHex) {
    currentChainId = parseInt(chainIdHex, 16);
    // Re-init provider for new chain
    if (window.ethereum) {
      provider = new ethers.BrowserProvider(window.ethereum);
      provider.getSigner().then(s => { signer = s; }).catch(() => {});
    }
    emit();
  }

  function disconnect() {
    if (window.ethereum) {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    }
    provider = null;
    signer = null;
    connectedAddress = null;
    currentChainId = null;
    emit();
  }

  // ── Attest QC packet hash on-chain via IQC contract ──
  // Calls attest(dataHash, packetId, metadata) on the IQC contract, which:
  //   1. Opens MetaMask to confirm and sign the transaction
  //   2. Submits the TX to Base Sepolia
  //   3. Emits AttestationCreated event on-chain
  // Returns the TX hash so it can be stored in wallet_attestations.
  async function signPacketHash(readingHash, packetId) {
    if (!signer) throw new Error('Wallet not connected');
    if (currentChainId !== IQC_CHAIN_ID) throw new Error(`Must be on Base Sepolia (chain ${IQC_CHAIN_ID}) to attest — current: ${currentChainId}`);

    // ABI for the attest function on the IQC contract
    const ATTEST_ABI = [
      'function attest(bytes32 dataHash, uint256 packetId, string calldata metadata) external',
    ];
    const contract = new ethers.Contract(IQC_CONTRACT, ATTEST_ABI, signer);

    // Build metadata string for the attestation
    const metadata = JSON.stringify({
      source: 'immutable-qc-web',
      timestamp: new Date().toISOString(),
      chainId: currentChainId,
    });

    // Parse readingHash as bytes32
    const dataHashBytes32 = readingHash.startsWith('0x') ? readingHash : '0x' + readingHash;

    // Send transaction — this triggers MetaMask
    console.log('[wallet] Calling attest(', dataHashBytes32, packetId, metadata, ') on', IQC_CONTRACT);
    const tx = await contract.attest(dataHashBytes32, BigInt(packetId), metadata);
    console.log('[wallet] TX submitted:', tx.hash);

    // Wait for confirmation
    const receipt = await tx.wait();
    console.log('[wallet] TX confirmed in block', receipt.blockNumber);

    // Build a human-readable message for the record
    const message = [
      'Immutable QC — On-Chain Attestation',
      '',
      `QC Packet: #${packetId}`,
      `Reading Hash: ${readingHash}`,
      `Chain: ${CHAINS[currentChainId]?.name || currentChainId}`,
      `TX Hash: ${tx.hash}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join('\n');

    return {
      txHash: tx.hash,
      message,
      signer: connectedAddress,
      chainId: currentChainId,
    };
  }

  // ── IQC token balance (optional, only on Base Sepolia) ──
  async function getIqcBalance() {
    if (!provider || !connectedAddress) return null;
    if (currentChainId !== IQC_CHAIN_ID) return null;

    try {
      const contract = new ethers.Contract(IQC_CONTRACT, ERC20_ABI, provider);
      const balance = await contract.balanceOf(connectedAddress);
      return ethers.formatUnits(balance, 18);
    } catch {
      return null;
    }
  }

  // ── IQC token info ──
  async function getIqcTokenInfo() {
    if (!provider || currentChainId !== IQC_CHAIN_ID) return null;

    try {
      const contract = new ethers.Contract(IQC_CONTRACT, ERC20_ABI, provider);
      const [name, symbol, totalSupply] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.totalSupply(),
      ]);
      return { name, symbol, totalSupply: ethers.formatUnits(totalSupply, 18), address: IQC_CONTRACT };
    } catch {
      return null;
    }
  }

  // ── Request faucet tokens (Base Sepolia testnet) ──
  async function requestFaucetTokens() {
    if (!connectedAddress) throw new Error('Wallet not connected');
    const res = await fetch('/api/faucet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: connectedAddress }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Faucet request failed');
    return data;
  }

  // ── Submit on-chain attestation to backend ──
  // Calls the IQC contract, waits for confirmation, then records the attestation.
  async function submitOnChainAttestation(packetId, readingHash) {
    const signed = await signPacketHash(readingHash, packetId);

    const res = await fetch('/api/wallet/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packetId,
        readingHash,
        walletAddress: signed.signer,
        chainId: signed.chainId,
        txHash: signed.txHash,
        // No signature field — the on-chain TX is the canonical attestation
        message: signed.message,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to record on-chain attestation');
    }

    return res.json();
  }

  // ── Short address for display ──
  function shortAddress(addr) {
    if (!addr) return '';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  return {
    isWalletAvailable,
    connect,
    disconnect,
    getState,
    onStateChange,
    signPacketHash,
    getIqcBalance,
    getIqcTokenInfo,
    submitOnChainAttestation,
    requestFaucetTokens,
    shortAddress,
    CHAINS,
    IQC_CONTRACT,
    IQC_CHAIN_ID,
  };
})();
