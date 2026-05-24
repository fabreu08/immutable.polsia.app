/**
 * db/wallet_attestations.js — On-chain wallet attestation queries.
 * Stores EVM wallet signatures for QC packets. Does NOT own QC packet lifecycle.
 */
const { pool } = require('./index');

async function createWalletAttestation({ qcPacketId, walletAddress, chainId, signature, message, readingHash, txHash }) {
  const { rows } = await pool.query(
    `INSERT INTO wallet_attestations (qc_packet_id, wallet_address, chain_id, signature, message, reading_hash, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [qcPacketId, walletAddress.toLowerCase(), chainId, signature, message, readingHash, txHash || null]
  );
  return rows[0];
}

async function getWalletAttestationsForPacket(qcPacketId) {
  const { rows } = await pool.query(
    `SELECT * FROM wallet_attestations WHERE qc_packet_id = $1 ORDER BY created_at ASC`,
    [qcPacketId]
  );
  return rows;
}

async function getWalletAttestationByPacketAndWallet(qcPacketId, walletAddress) {
  const { rows } = await pool.query(
    `SELECT * FROM wallet_attestations WHERE qc_packet_id = $1 AND wallet_address = $2`,
    [qcPacketId, walletAddress.toLowerCase()]
  );
  return rows[0] || null;
}

async function getWalletAttestationStats() {
  const { rows } = await pool.query(
    `SELECT COUNT(*) as total,
            COUNT(DISTINCT wallet_address) as unique_wallets,
            COUNT(DISTINCT chain_id) as chains_used
     FROM wallet_attestations`
  );
  return rows[0];
}

module.exports = {
  createWalletAttestation,
  getWalletAttestationsForPacket,
  getWalletAttestationByPacketAndWallet,
  getWalletAttestationStats,
};
