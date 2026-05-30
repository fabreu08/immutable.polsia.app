/**
 * services/iqc-contract.js — On-chain queries for IQC Alpha on Base Sepolia.
 * Points at V2 Registry (0x80c00E...) where real user stake lives.
 * Used by /ledger page and other server-side on-chain reads.
 */

const { ethers } = require('ethers');

// Real deployed contracts from iqc-alpha
// IMPORTANT: Using V2 Registry (with unstake support) where user stake actually lives
const IQC_REGISTRY = '0x80c00E40DF46E36652319662929a49bCaeBE52A3'; // V2
const IQC_TOKEN = '0x6D3a4fb7D139d6bb2F241D7F5842955b9d747a4C';
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASESCAN_BASE = 'https://sepolia.basescan.org';

// Registry ABI (focus on the real commit event)
const REGISTRY_ABI = [
  'event QCPacketCommitted(address indexed validator, string instrumentId, string dataHash, uint256 feeBurned)',
  'function getStakedBalance(address validator) external view returns (uint256)',
  'function COMMIT_FEE() external view returns (uint256)',
];

async function getProvider() {
  return new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);
}

/**
 * Fetch real QCPacketCommitted events from the deployed IQCRegistry.
 * This is the authoritative on-chain record of QC packet commitments.
 */
async function getOnChainAttestations(fromBlock = 0, toBlock = 'latest') {
  try {
    const provider = await getProvider();
    const contract = new ethers.Contract(IQC_REGISTRY, REGISTRY_ABI, provider);

    const filter = contract.filters.QCPacketCommitted();
    const events = await contract.queryFilter(filter, fromBlock, toBlock);

    return events.map((e) => ({
      validator: e.args.validator,
      instrumentId: e.args.instrumentId,
      dataHash: e.args.dataHash,
      feeBurned: e.args.feeBurned ? ethers.formatUnits(e.args.feeBurned, 18) : '1',
      txHash: e.transactionHash,
      blockNumber: e.blockNumber,
      blockTimestamp: null,
    }));
  } catch (err) {
    console.error('iqc-contract.getOnChainAttestations error:', err.message);
    return [];
  }
}

/**
 * Enrich Registry commitments with block timestamps.
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
 * Get basic on-chain info for both the Registry and the IQC Token.
 */
async function getIqcTokenInfo() {
  try {
    const provider = await getProvider();

    const tokenABI = [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function totalSupply() view returns (uint256)',
    ];

    const token = new ethers.Contract(IQC_TOKEN, tokenABI, provider);
    const [name, symbol, totalSupply] = await Promise.all([
      token.name(),
      token.symbol(),
      token.totalSupply(),
    ]);

    return {
      name,
      symbol,
      totalSupply: ethers.formatUnits(totalSupply, 18),
      tokenAddress: IQC_TOKEN,
      registryAddress: IQC_REGISTRY,
      explorerUrl: `${BASESCAN_BASE}/address/${IQC_REGISTRY}`,
    };
  } catch (err) {
    console.error('iqc-contract.getIqcTokenInfo error:', err.message);
    return null;
  }
}

/**
 * Fetch recent real commitments from the IQCRegistry.
 */
async function getRecentAttestations(limit = 100) {
  const provider = await getProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - 5000);

  const attestations = await getOnChainAttestationsWithTimestamps(fromBlock, latestBlock);

  return attestations
    .sort((a, b) => b.blockNumber - a.blockNumber)
    .slice(0, limit);
}

module.exports = {
  getOnChainAttestations,
  getOnChainAttestationsWithTimestamps,
  getIqcTokenInfo,
  getRecentAttestations,
  IQC_REGISTRY,
  IQC_TOKEN,
  BASE_SEPOLIA_CHAIN_ID,
  BASESCAN_BASE,
};