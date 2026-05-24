/**
 * jobs/qc-digest.js — Daily QC packet digest.
 * Reports pending/approved/rejected counts to dashboard.
 */
const { pool } = require('../db/index');

async function run() {
  try {
    const stats = await pool.query(
      'SELECT status, COUNT(*) as count FROM qc_packets GROUP BY status'
    );
    const summary = stats.rows.map(r => `${r.status}: ${r.count}`).join(', ');
    console.log(`QC Digest: ${summary}`);
    process.exit(0);
  } catch (err) {
    console.error('QC digest failed:', err);
    process.exit(1);
  }
}

run();