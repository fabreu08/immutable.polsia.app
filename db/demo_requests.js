/**
 * db/demo_requests.js — Demo request queries.
 * Owns reads and inserts for the demo_requests table only.
 */
const { pool } = require('./index');

async function createDemoRequest({ name, email, company }) {
  const result = await pool.query(
    `INSERT INTO demo_requests (name, email, company)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, email, company || null]
  );
  return result.rows[0];
}

async function getDemoRequestByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM demo_requests WHERE email = $1',
    [email]
  );
  return result.rows[0];
}

async function listDemoRequests({ limit = 50, offset = 0 } = {}) {
  const result = await pool.query(
    'SELECT * FROM demo_requests ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return result.rows;
}

async function countDemoRequests() {
  const result = await pool.query('SELECT COUNT(*) as c FROM demo_requests');
  return parseInt(result.rows[0].c);
}

module.exports = { createDemoRequest, getDemoRequestByEmail, listDemoRequests, countDemoRequests };