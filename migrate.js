/**
 * Database Migration Runner
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrate() {
  console.log('Running migrations...');
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runCoreMigrations(client);
    await runFolderMigrations(client);
    console.log('Migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

async function runCoreMigrations(client) {
  // Users
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      password_hash VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      stripe_subscription_id VARCHAR(255),
      subscription_status VARCHAR(50),
      subscription_plan VARCHAR(255),
      subscription_expires_at TIMESTAMPTZ,
      subscription_updated_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (LOWER(email))`);

  // QC Tables
  await client.query(`
    CREATE TABLE IF NOT EXISTS instruments (
      id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, sensor_type VARCHAR(50) NOT NULL,
      serial_number VARCHAR(100), location VARCHAR(255), active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS readings (
      id SERIAL PRIMARY KEY, instrument_id INTEGER REFERENCES instruments(id),
      value DOUBLE PRECISION NOT NULL, unit VARCHAR(50), captured_at TIMESTAMPTZ DEFAULT NOW(), timestamp TIMESTAMPTZ DEFAULT NOW(),
      sensor_type VARCHAR(50), signature TEXT, chain_hash TEXT, measurement_metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS qc_packets (
      id SERIAL PRIMARY KEY, reading_id INTEGER REFERENCES readings(id), assigned_reviewer_id INTEGER REFERENCES reviewers(id),
      status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Ensure assigned_reviewer_id column exists (added later in development)
  await client.query(`
    ALTER TABLE qc_packets 
    ADD COLUMN IF NOT EXISTS assigned_reviewer_id INTEGER REFERENCES reviewers(id)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS reviewers (
      id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL,
      role VARCHAR(50), department VARCHAR(255), active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS attestations (
      id SERIAL PRIMARY KEY, qc_packet_id INTEGER REFERENCES qc_packets(id),
      reviewer_id INTEGER REFERENCES reviewers(id), action VARCHAR(20), comment TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id SERIAL PRIMARY KEY, block_hash TEXT NOT NULL, previous_hash TEXT, merkle_root TEXT,
      reading_count INTEGER DEFAULT 0, block_number INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wallet_attestations (
      id SERIAL PRIMARY KEY, qc_packet_id INTEGER, wallet_address TEXT NOT NULL,
      chain VARCHAR(50), signature TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Analytics, Faucet, Demo requests (added 2026-05-29 to fix production schema)
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

  await client.query(`
    CREATE TABLE IF NOT EXISTS demo_requests (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      company VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function runFolderMigrations(client) {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js')).sort();
  if (files.length === 0) return;
  const applied = await client.query('SELECT name FROM _migrations');
  const appliedNames = new Set(applied.rows.map(r => r.name));
  for (const file of files) {
    const migration = require(path.join(migrationsDir, file));
    const name = migration.name || file.replace('.js', '');
    if (appliedNames.has(name)) continue;
    console.log(`Running migration: ${name}`);
    try {
      await client.query('BEGIN');
      await migration.up(client);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
