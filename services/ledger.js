/**
 * services/ledger.js — Blockchain ledger operations.
 * Manages the hash chain and block creation.
 */
const crypto = require('crypto');
const dbLedger = require('../db/ledger');
const { merkleRoot } = require('./crypto');

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const GENESIS_PREV = 'GENESIS';

async function getOrCreateGenesisBlock() {
  let genesis = await dbLedger.getLedgerEntryByBlock(0);
  if (!genesis) {
    const blockHash = crypto.createHash('sha256')
      .update('GENESIS_BLOCK_1779507419')
      .digest('hex');
    genesis = await dbLedger.createLedgerEntry({
      blockNumber: 0,
      blockHash,
      previousHash: GENESIS_PREV,
      merkleRoot: blockHash,
      readingCount: 0,
      blockTimestamp: new Date('2026-01-01T00:00:00Z'),
    });
  }
  return genesis;
}

/**
 * Commit a batch of reading hashes to a new ledger block.
 */
async function commitBlock(readingHashes) {
  const latestBlock = await dbLedger.getLatestLedgerEntry() || await getOrCreateGenesisBlock();
  const blockNumber = latestBlock.block_number + 1;
  const previousHash = latestBlock.block_hash;

  const merkleRootHash = merkleRoot(readingHashes);

  const blockContent = JSON.stringify({ blockNumber, previousHash, merkleRootHash, readingHashes });
  const blockHash = crypto.createHash('sha256').update(blockContent).digest('hex');

  const entry = await dbLedger.createLedgerEntry({
    blockNumber,
    blockHash,
    previousHash,
    merkleRoot: merkleRootHash,
    readingCount: readingHashes.length,
    blockTimestamp: new Date(),
  });

  return entry;
}

/**
 * Verify the integrity of the entire ledger chain.
 */
async function verifyLedgerIntegrity() {
  const entries = await dbLedger.verifyChainIntegrity();
  const results = { valid: true, blocks: [], errors: [] };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const blockContent = JSON.stringify({
      blockNumber: entry.block_number,
      previousHash: entry.previous_hash,
      merkleRoot: entry.merkle_root,
    });
    const computedHash = crypto.createHash('sha256').update(blockContent).digest('hex');

    if (computedHash !== entry.block_hash) {
      results.valid = false;
      results.errors.push(`Block ${entry.block_number}: hash mismatch`);
    }

    if (i > 0) {
      const prevEntry = entries[i - 1];
      if (entry.previous_hash !== prevEntry.block_hash) {
        results.valid = false;
        results.errors.push(`Block ${entry.block_number}: chain broken (previous_hash mismatch)`);
      }
    }

    results.blocks.push({
      blockNumber: entry.block_number,
      blockHash: entry.block_hash,
      readingCount: entry.reading_count,
      merkleRoot: entry.merkle_root,
      valid: results.errors.filter(e => e.includes(`${entry.block_number}:`)).length === 0,
    });
  }

  return results;
}

module.exports = { getOrCreateGenesisBlock, commitBlock, verifyLedgerIntegrity };