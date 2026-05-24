/**
 * db/faucet_requests.js — Faucet request tracking.
 * Tracks IQC token faucet dispenses by wallet + IP for rate limiting and abuse detection.
 */
const { pool } = require('./index');

async function createFaucetRequest({ walletAddress, ipAddress, success, errorMessage }) {
  const result = await pool.query(
    `INSERT INTO faucet_requests (wallet_address, ip_address, success, error_message)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [walletAddress, ipAddress || null, success, errorMessage || null]
  );
  return result.rows[0];
}

async function getLastRequestByWallet(walletAddress) {
  const result = await pool.query(
    `SELECT * FROM faucet_requests
     WHERE wallet_address = $1 AND success = true
     ORDER BY created_at DESC LIMIT 1`,
    [walletAddress]
  );
  return result.rows[0] || null;
}

async function getLastRequestByIP(ipAddress) {
  if (!ipAddress) return null;
  const result = await pool.query(
    `SELECT * FROM faucet_requests
     WHERE ip_address = $1 AND success = true
     ORDER BY created_at DESC LIMIT 1`,
    [ipAddress]
  );
  return result.rows[0] || null;
}

async function getFaucetStats() {
  const result = await pool.query(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN success THEN iqc_amount ELSE 0 END) as total_dispensed,
            COUNT(DISTINCT wallet_address) as unique_wallets
     FROM faucet_requests WHERE success = true`
  );
  return result.rows[0];
}

module.exports = {
  createFaucetRequest,
  getLastRequestByWallet,
  getLastRequestByIP,
  getFaucetStats,
};