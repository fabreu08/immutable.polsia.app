/**
 * db/readings.js — Sensor reading queries.
 */
const { pool } = require('./index');

async function createReading({
  instrumentId, sensorType, value, unit, capturedAt,
  signature, signingKeyFingerprint, previousHash, blockNumber, readingHash
}) {
  const { rows } = await pool.query(
    `INSERT INTO readings
       (instrument_id, sensor_type, value, unit, captured_at,
        signature, signing_key_fingerprint, previous_hash, block_number, reading_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [instrumentId, sensorType, value, unit, capturedAt,
     signature, signingKeyFingerprint, previousHash, blockNumber, readingHash]
  );
  return rows[0];
}

async function createReadingWithMetadata({
  instrumentId, sensorType, value, unit, capturedAt,
  signature, signingKeyFingerprint, previousHash, blockNumber, readingHash,
  measurementMetadata,
}) {
  const { rows } = await pool.query(
    `INSERT INTO readings
       (instrument_id, sensor_type, value, unit, captured_at,
        signature, signing_key_fingerprint, previous_hash, block_number, reading_hash,
        measurement_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [instrumentId, sensorType, value, unit, capturedAt,
     signature, signingKeyFingerprint, previousHash, blockNumber, readingHash,
     measurementMetadata]
  );
  return rows[0];
}

async function getReadingById(id) {
  const { rows } = await pool.query(
    `SELECT r.*, i.name as instrument_name, i.serial_number as instrument_serial
     FROM readings r
     JOIN instruments i ON i.id = r.instrument_id
     WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getReadings({ instrumentId, sensorType, limit = 50, offset = 0, descending = true }) {
  const order = descending ? 'DESC' : 'ASC';
  let q = `SELECT r.*, i.name as instrument_name, i.serial_number as instrument_serial
           FROM readings r JOIN instruments i ON i.id = r.instrument_id WHERE 1=1`;
  const params = [];
  if (instrumentId) { params.push(instrumentId); q += ` AND r.instrument_id = $${params.length}`; }
  if (sensorType) { params.push(sensorType); q += ` AND r.sensor_type = $${params.length}`; }
  params.push(limit, offset);
  q += ` ORDER BY r.captured_at ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const { rows } = await pool.query(q, params);
  return rows;
}

async function getLatestReading() {
  const { rows } = await pool.query(
    'SELECT * FROM readings ORDER BY block_number DESC LIMIT 1'
  );
  return rows[0] || null;
}

async function getNextBlockNumber() {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(block_number), 0) + 1 as next FROM ledger_entries'
  );
  return rows[0].next;
}

async function countReadings() {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM readings');
  return parseInt(rows[0].count);
}

/**
 * Link a reading to the ledger block it was committed in.
 * This is critical for proper audit trail after background ledger creation.
 */
async function updateReadingLedgerBlock(readingId, blockNumber) {
  const { rows } = await pool.query(
    `UPDATE readings 
     SET ledger_block_number = $2 
     WHERE id = $1 
     RETURNING *`,
    [readingId, blockNumber]
  );
  return rows[0] || null;
}

module.exports = { 
  createReading, 
  createReadingWithMetadata, 
  getReadingById, 
  getReadings, 
  getLatestReading, 
  getNextBlockNumber, 
  countReadings,
  updateReadingLedgerBlock 
};