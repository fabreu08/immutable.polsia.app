/**
 * jobs/ledger-health.js — Daily ledger integrity check.
 * Verifies the hash-chain integrity and reports any broken blocks.
 */
const { pool } = require('../db/index');

async function run() {
  try {
    const res = await pool.query('SELECT * FROM ledger_entries ORDER BY block_number ASC');
    let valid = true;
    for (let i = 0; i < res.rows.length; i++) {
      const entry = res.rows[i];
      if (i > 0) {
        const prev = res.rows[i - 1];
        if (entry.previous_hash !== prev.block_hash) {
          console.error(`CHAIN BROKEN at block ${entry.block_number}: previous_hash mismatch`);
          valid = false;
        }
      }
    }
    if (valid) {
      console.log(`Ledger health OK: ${res.rows.length} blocks, chain intact`);
    }
    process.exit(valid ? 0 : 1);
  } catch (err) {
    console.error('Ledger health check failed:', err);
    process.exit(1);
  }
}

run();