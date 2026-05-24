/**
 * db/ledger.js — Blockchain ledger queries.
 */
const { pool } = require('./index');

async function createLedgerEntry({ blockNumber, blockHash, previousHash, merkleRoot, readingCount, blockTimestamp }) {
  const { rows } = await pool.query(
    `INSERT INTO ledger_entries (block_number, block_hash, previous_hash, merkle_root, reading_count, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [blockNumber, blockHash, previousHash, merkleRoot, readingCount, blockTimestamp]
  );
  return rows[0];
}

async function getLedgerEntryByBlock(blockNumber) {
  const { rows } = await pool.query(
    'SELECT * FROM ledger_entries WHERE block_number = $1',
    [blockNumber]
  );
  return rows[0] || null;
}

async function getLatestLedgerEntry() {
  const { rows } = await pool.query(
    'SELECT * FROM ledger_entries ORDER BY block_number DESC LIMIT 1'
  );
  return rows[0] || null;
}

async function getLedgerChain(limit = 20, offset = 0) {
  const { rows } = await pool.query(
    `SELECT * FROM ledger_entries ORDER BY block_number DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function verifyChainIntegrity() {
  const entries = await pool.query(
    'SELECT * FROM ledger_entries ORDER BY block_number ASC'
  );
  return entries.rows;
}

async function getLedgerStats() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) as total_blocks,
       COALESCE(SUM(reading_count), 0) as total_readings,
       COALESCE(MAX(block_number), 0) as latest_block
     FROM ledger_entries`
  );
  return rows[0];
}

module.exports = { createLedgerEntry, getLedgerEntryByBlock, getLatestLedgerEntry, getLedgerChain, verifyChainIntegrity, getLedgerStats };