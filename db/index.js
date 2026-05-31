/**
 * db/index.js — PostgreSQL connection pool.
 * All database access goes through named functions in db/<entity>.js files.
 * No inline pool.query() outside this directory.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 20,
});

/**
 * Defensive: ensure non-critical tables exist at runtime.
 * This is a safety net in case migrate.js hasn't run or the DB is behind.
 * Critical tables (readings, qc_packets, etc.) should still come from migrate.js.
 */
async function ensureTables() {
  const client = await pool.connect();
  try {
    // analytics_events (non-critical - used for product analytics)
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id SERIAL PRIMARY KEY,
        event_name VARCHAR(128) NOT NULL,
        properties JSONB DEFAULT '{}',
        session_id VARCHAR(255),
        user_agent TEXT,
        ip_address VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // faucet_requests (used by the testnet faucet)
    await client.query(`
      CREATE TABLE IF NOT EXISTS faucet_requests (
        id SERIAL PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        ip_address VARCHAR(100),
        success BOOLEAN DEFAULT false,
        error_message TEXT,
        iqc_amount NUMERIC(18,8) DEFAULT 0.1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // demo_requests (early access signups)
    await client.query(`
      CREATE TABLE IF NOT EXISTS demo_requests (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        company VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Ensure qc_packets has assigned_reviewer_id (schema drift safety)
    await client.query(`
      ALTER TABLE qc_packets 
      ADD COLUMN IF NOT EXISTS assigned_reviewer_id INTEGER REFERENCES reviewers(id)
    `);

    // Ensure instruments has key_fingerprint (required by seed + signing)
    await client.query(`
      ALTER TABLE instruments 
      ADD COLUMN IF NOT EXISTS key_fingerprint TEXT
    `);

    // Schema drift fixes for readings table (needed for on-chain + hash chain)
    await client.query(`ALTER TABLE readings ADD COLUMN IF NOT EXISTS signing_key_fingerprint TEXT`);
    await client.query(`ALTER TABLE readings ADD COLUMN IF NOT EXISTS previous_hash TEXT`);
    await client.query(`ALTER TABLE readings ADD COLUMN IF NOT EXISTS block_number INTEGER`);
    await client.query(`ALTER TABLE readings ADD COLUMN IF NOT EXISTS reading_hash TEXT`);
    await client.query(`ALTER TABLE readings ADD COLUMN IF NOT EXISTS ledger_block_number INTEGER`);
    await client.query(`ALTER TABLE readings ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ DEFAULT NOW()`);

    // Defensive creation of ledger_entries (critical for hash chain)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id SERIAL PRIMARY KEY,
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        previous_hash TEXT,
        merkle_root TEXT,
        reading_count INTEGER DEFAULT 0,
        block_timestamp TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Ensure required columns exist on ledger_entries
    await client.query(`ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ`);
    await client.query(`ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS merkle_root TEXT`);
  } catch (err) {
    console.warn('ensureTables warning (non-fatal):', err.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, ensureTables };