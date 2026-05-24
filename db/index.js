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

module.exports = { pool };