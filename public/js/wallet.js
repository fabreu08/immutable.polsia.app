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

  // IQC contracts on Base Sepolia (from iqc-alpha deployment)
  // Switched to V2 (with unstaking support) as the active registry for on-chain operations
  const IQC_REGISTRY = '0x80c00E40DF46E36652319662929a49bCaeBE52A3'; // V2
  const IQC_TOKEN = '0x6D3a4fb7D139d6bb2F241D7F5842955b9d747a4C'; // Real deployed IQCToken
  const IQC_CHAIN_ID = 84532; // Base Sepolia

  // Full ABI for the deployed IQCRegistry (staking + commit model)
  const REGISTRY_ABI = [
    'function stake(uint256 amount) external',
    'function slash(address validator, uint256 amount) external',
    'function commitQCPacket(string memory instrumentId, string memory dataHash) external',
    'function getStakedBalance(address validator) external view returns (uint256)',
    'function COMMIT_FEE() external view returns (uint256)',
    'event QCPacketCommitted(address indexed validator, string instrumentId, string dataHash, uint256 feeBurned)',
  ];

  // Minimal ERC-20 ABI (for the real IQC token)
  const ERC20_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transfer(address to, uint256 amount) returns (bool)',
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

  // ── Get current staked balance on the IQCRegistry ──
  async function getStakedBalance() {
    if (!provider || !connectedAddress || currentChainId !== IQC_CHAIN_ID) return null;
    try {
      const contract = new ethers.Contract(IQC_REGISTRY, REGISTRY_ABI, provider);
      const staked = await contract.getStakedBalance(connectedAddress);
      return ethers.formatUnits(staked, 18);
    } catch (err) {
      console.warn('[wallet] getStakedBalance failed:', err.message);
      return null;
    }
  }

  // ── Stake IQC tokens to the Registry (required to commit packets) ──
  async function stake(amountInIqc) {
    if (!signer) throw new Error('Wallet not connected');
    if (currentChainId !== IQC_CHAIN_ID) {
      throw new Error(`Must be on Base Sepolia to stake`);
    }

    const token = new ethers.Contract(IQC_TOKEN, ERC20_ABI, signer);
    const registry = new ethers.Contract(IQC_REGISTRY, REGISTRY_ABI, signer);

    const amount = ethers.parseUnits(String(amountInIqc), 18);

    console.log(`[wallet] Approving ${amountInIqc} IQC for staking...`);
    const approveTx = await token.approve(IQC_REGISTRY, amount);
    await approveTx.wait();
    console.log('[wallet] Approve confirmed:', approveTx.hash);

    console.log(`[wallet] Staking ${amountInIqc} IQC...`);
    const stakeTx = await registry.stake(amount);
    const receipt = await stakeTx.wait();
    console.log('[wallet] Stake confirmed:', stakeTx.hash);

    const newStaked = await getStakedBalance();
    return {
      txHash: stakeTx.hash,
      stakedBalance: newStaked,
    };
  }

  // ── Commit a QC packet on-chain to the real IQCRegistry ──
  // Matches the deployed contract:
  //   commitQCPacket(string instrumentId, string dataHash)
  // Requires the caller to have >= 1 IQC staked in the Registry.
  async function commitQCPacket(instrumentId, dataHash) {
    if (!signer) throw new Error('Wallet not connected');
    if (currentChainId !== IQC_CHAIN_ID) {
      throw new Error(`Must be on Base Sepolia (chain ${IQC_CHAIN_ID}) — current: ${currentChainId}`);
    }

    const contract = new ethers.Contract(IQC_REGISTRY, REGISTRY_ABI, signer);

    // Normalize dataHash to 0x-hex string
    let hash = dataHash;
    if (!hash.startsWith('0x')) hash = '0x' + hash;

    // Basic validation — Registry will also enforce stake
    const staked = await contract.getStakedBalance(connectedAddress);
    const fee = await contract.COMMIT_FEE().catch(() => ethers.parseUnits('1', 18));
    if (staked < fee) {
      const needed = ethers.formatUnits(fee, 18);
      throw new Error(`Insufficient stake. You have ${ethers.formatUnits(staked, 18)} IQC staked. Need at least ${needed} IQC staked to commit. Use the stake() function or contact an operator.`);
    }

    console.log('[wallet] Calling commitQCPacket(', instrumentId, hash, ') on', IQC_REGISTRY);

    const tx = await contract.commitQCPacket(instrumentId, hash);
    console.log('[wallet] TX submitted:', tx.hash);

    const receipt = await tx.wait();
    console.log('[wallet] TX confirmed in block', receipt.blockNumber);

    const message = [
      'Immutable QC — On-Chain Commitment',
      '',
      `Instrument: ${instrumentId}`,
      `Data Hash: ${hash}`,
      `Chain: ${CHAINS[currentChainId]?.name || currentChainId}`,
      `TX Hash: ${tx.hash}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join('\n');

    return {
      txHash: tx.hash,
      message,
      signer: connectedAddress,
      chainId: currentChainId,
      instrumentId,
      dataHash: hash,
    };
  }

  // Legacy wrapper for older callers (kept for compatibility during transition)
  async function signPacketHash(readingHash, packetId) {
    // We no longer have packetId on-chain in the current Registry model.
    // Use commitQCPacket(instrumentId, dataHash) instead for real commits.
    throw new Error('signPacketHash(readingHash, packetId) is deprecated. Use commitQCPacket(instrumentId, dataHash) with the real Registry ABI.');
  }

  // ── IQC token balance (optional, only on Base Sepolia) ──
  async function getIqcBalance() {
    if (!provider || !connectedAddress) return null;
    if (currentChainId !== IQC_CHAIN_ID) return null;

    try {
      const contract = new ethers.Contract(IQC_TOKEN, ERC20_ABI, provider);
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
      const contract = new ethers.Contract(IQC_TOKEN, ERC20_ABI, provider);
      const [name, symbol, totalSupply] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.totalSupply(),
      ]);
      return { name, symbol, totalSupply: ethers.formatUnits(totalSupply, 18), address: IQC_TOKEN };
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

  // ── Submit on-chain commitment to backend (records the real Registry tx) ──
  // Calls the IQCRegistry.commitQCPacket, waits for confirmation, then records in wallet_attestations.
  async function submitOnChainAttestation(packetId, readingHash, instrumentId) {
    if (!instrumentId) {
      instrumentId = 'UNKNOWN-INSTRUMENT';
    }

    const committed = await commitQCPacket(instrumentId, readingHash);

    const res = await fetch('/api/wallet/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packetId,
        readingHash,
        walletAddress: committed.signer,
        chainId: committed.chainId,
        txHash: committed.txHash,
        message: committed.message,
        signature: committed.txHash, // For Registry commit flow, the tx itself serves as the attestation proof
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

  // Base Name (from base.org/name/immutableqc)
  const BASE_NAME = 'immutableqc.base';

  // Return the project's Base Name only on Base mainnet
  async function getDisplayName(addr) {
    if (!addr) return null;
    const state = getState();

    // Only show the nice name on Base mainnet (chain 8453)
    if (state.chainId === 8453) {
      return BASE_NAME;
    }
    return null;
  }

  return {
    isWalletAvailable,
    connect,
    disconnect,
    getState,
    onStateChange,
    // New correct entry point
    commitQCPacket,
    getStakedBalance,
    // Deprecated (will throw)
    signPacketHash,
    getIqcBalance,
    getIqcTokenInfo,
    submitOnChainAttestation,
    requestFaucetTokens,
    shortAddress,
    getDisplayName,
    BASE_NAME,
    CHAINS,
    IQC_REGISTRY,
    IQC_TOKEN,
    IQC_CHAIN_ID,
    // Staking
    stake,
    getStakedBalance,
  };
})();
