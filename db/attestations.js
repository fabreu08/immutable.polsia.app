/**
 * db/attestations.js — Attestation queries.
 */
const { pool } = require('./index');

async function createAttestation({ qcPacketId, reviewerId, action, notes, signature }) {
  const { rows } = await pool.query(
    `INSERT INTO attestations (qc_packet_id, reviewer_id, action, notes, signature)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [qcPacketId, reviewerId, action, notes, signature]
  );
  return rows[0];
}

async function getAttestationsForPacket(qcPacketId) {
  const { rows } = await pool.query(
    `SELECT a.*, rev.name as reviewer_name, rev.role as reviewer_role
     FROM attestations a
     JOIN reviewers rev ON rev.id = a.reviewer_id
     WHERE a.qc_packet_id = $1
     ORDER BY a.created_at ASC`,
    [qcPacketId]
  );
  return rows;
}

async function getAttestationsByReviewer(reviewerId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT a.*, qp.id as qc_packet_id, r.value, r.unit, r.sensor_type
     FROM attestations a
     JOIN qc_packets qp ON qp.id = a.qc_packet_id
     JOIN readings r ON r.id = qp.reading_id
     WHERE a.reviewer_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [reviewerId, limit]
  );
  return rows;
}

module.exports = { createAttestation, getAttestationsForPacket, getAttestationsByReviewer };