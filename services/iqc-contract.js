/**
 * services/iqc-contract.js — IQC token contract queries on Base Sepolia.
 * Queries on-chain attestation events from the IQC token contract.
 * Does NOT own wallet signing or QC packet lifecycle.
 */

const { ethers } = require('ethers');

const IQC_CONTRACT = '0x5a1014b0221ee57078f5d63e32c841834464d2f9';
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASESCAN_BASE = 'https://sepolia.basescan.org';

// ERC-20 + Attestation ABI — events we query from the contract
const CONTRACT_ABI = [
  // ERC-20 standard (for context)
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  // Attestation event — emitted when a QC packet reading hash is attested on-chain
  // The contract may emit this in a future version; currently defined as contract interface
  'event AttestationCreated(address indexed attestor, bytes32 indexed dataHash, uint256 indexed packetId, string metadata)',
];

async function getProvider() {
  return new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);
}

/**
 * Fetch AttestationCreated events from the IQC contract.
 * Falls back to an empty array if the contract has not yet emitted these events
 * (early-stage deployments may not have attestation events yet).
 *
 * @param {number} fromBlock — starting block number (default: 0)
 * @param {number} toBlock   — ending block number (default: 'latest')
 * @returns {Array} attestation records
 */
async function getOnChainAttestations(fromBlock = 0, toBlock = 'latest') {
  try {
    const provider = await getProvider();
    const contract = new ethers.Contract(IQC_CONTRACT, CONTRACT_ABI, provider);

    const filter = contract.filters.AttestationCreated();
    const events = await contract.queryFilter(filter, fromBlock, toBlock);

    return events.map((e) => ({
      attestor: e.args.attestor,
      dataHash: e.args.dataHash,
      packetId: e.args.packetId ? e.args.packetId.toString() : null,
      metadata: e.args.metadata || '',
      txHash: e.transactionHash,
      blockNumber: e.blockNumber,
      blockTimestamp: null, // resolved below if available
    }));
  } catch (err) {
    console.error('iqc-contract.getOnChainAttestations error:', err.message);
    return [];
  }
}

/**
 * Fetch AttestationCreated events enriched with block timestamps.
 * Resolves block timestamps via batch provider calls to avoid flooding RPC.
 */
async function getOnChainAttestationsWithTimestamps(fromBlock = 0, toBlock = 'latest') {
  const attestations = await getOnChainAttestations(fromBlock, toBlock);
  if (attestations.length === 0) return [];

  try {
    const provider = await getProvider();
    const uniqueBlocks = [...new Set(attestations.map((a) => a.blockNumber))];

    const timestampMap = {};
    await Promise.all(
      uniqueBlocks.map(async (blockNum) => {
        try {
          const block = await provider.getBlock(blockNum);
          timestampMap[blockNum] = block ? new Date(block.timestamp * 1000).toISOString() : null;
        } catch {
          timestampMap[blockNum] = null;
        }
      })
    );

    return attestations.map((a) => ({
      ...a,
      blockTimestamp: timestampMap[a.blockNumber] || null,
      explorerUrl: `${BASESCAN_BASE}/tx/${a.txHash}`,
      explorerBlockUrl: `${BASESCAN_BASE}/block/${a.blockNumber}`,
    }));
  } catch (err) {
    console.error('iqc-contract timestamp enrichment error:', err.message);
    return attestations.map((a) => ({ ...a, blockTimestamp: null }));
  }
}

/**
 * Get IQC token basic on-chain stats (total supply, name, symbol).
 */
async function getIqcTokenInfo() {
  try {
    const provider = await getProvider();
    const erc20ABI = [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function totalSupply() view returns (uint256)',
      'function owner() view returns (address)',
    ];
    const contract = new ethers.Contract(IQC_CONTRACT, erc20ABI, provider);
    const [name, symbol, totalSupply, owner] = await Promise.all([
      contract.name(),
      contract.symbol(),
      contract.totalSupply(),
      contract.owner().catch(() => null),
    ]);
    return {
      name,
      symbol,
      totalSupply: ethers.formatUnits(totalSupply, 18),
      owner,
      explorerUrl: `${BASESCAN_BASE}/address/${IQC_CONTRACT}`,
    };
  } catch (err) {
    console.error('iqc-contract.getIqcTokenInfo error:', err.message);
    return null;
  }
}

/**
 * Fetch all attestation events across a given range with a progress-safe limit.
 * Strips results to the latest N to avoid huge responses.
 */
async function getRecentAttestations(limit = 100) {
  const provider = await getProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - 5000); // last ~5000 blocks (~3.5 hrs on Base)

  const attestations = await getOnChainAttestationsWithTimestamps(fromBlock, latestBlock);

  // Return newest first, limited to `limit`
  return attestations
    .sort((a, b) => b.blockNumber - a.blockNumber)
    .slice(0, limit);
}

module.exports = {
  getOnChainAttestations,
  getOnChainAttestationsWithTimestamps,
  getIqcTokenInfo,
  getRecentAttestations,
  IQC_CONTRACT,
  BASE_SEPOLIA_CHAIN_ID,
  BASESCAN_BASE,
};