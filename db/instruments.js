/**
 * db/instruments.js — Instrument registry queries.
 */
const { pool } = require('./index');

async function getAllInstruments(activeOnly = true) {
  const q = activeOnly
    ? 'SELECT * FROM instruments WHERE active = true ORDER BY created_at DESC'
    : 'SELECT * FROM instruments ORDER BY created_at DESC';
  const { rows } = await pool.query(q);
  return rows;
}

async function getInstrumentById(id) {
  const { rows } = await pool.query('SELECT * FROM instruments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getInstrumentBySerial(serialNumber) {
  const { rows } = await pool.query('SELECT * FROM instruments WHERE serial_number = $1', [serialNumber]);
  return rows[0] || null;
}

async function createInstrument({ name, sensorType, serialNumber, keyFingerprint, location }) {
  const { rows } = await pool.query(
    `INSERT INTO instruments (name, sensor_type, serial_number, key_fingerprint, location)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, sensorType, serialNumber, keyFingerprint, location]
  );
  return rows[0];
}

async function deactivateInstrument(id) {
  const { rows } = await pool.query(
    'UPDATE instruments SET active = false WHERE id = $1 RETURNING *',
    [id]
  );
  return rows[0] || null;
}

module.exports = { getAllInstruments, getInstrumentById, getInstrumentBySerial, createInstrument, deactivateInstrument };