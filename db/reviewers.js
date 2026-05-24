/**
 * db/reviewers.js — Reviewer queries.
 */
const { pool } = require('./index');

async function getAllReviewers(activeOnly = true) {
  const q = activeOnly
    ? 'SELECT * FROM reviewers WHERE active = true ORDER BY name ASC'
    : 'SELECT * FROM reviewers ORDER BY name ASC';
  const { rows } = await pool.query(q);
  return rows;
}

async function getReviewerById(id) {
  const { rows } = await pool.query('SELECT * FROM reviewers WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getReviewerByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM reviewers WHERE email = $1', [email]);
  return rows[0] || null;
}

async function createReviewer({ name, email, role, department }) {
  const { rows } = await pool.query(
    `INSERT INTO reviewers (name, email, role, department)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name, email, role, department]
  );
  return rows[0];
}

module.exports = { getAllReviewers, getReviewerById, getReviewerByEmail, createReviewer };