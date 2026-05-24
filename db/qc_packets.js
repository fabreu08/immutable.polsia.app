/**
 * db/qc_packets.js — QC packet queries.
 */
const { pool } = require('./index');

async function createQcPacket({ readingId, priority = 'normal' }) {
  const { rows } = await pool.query(
    `INSERT INTO qc_packets (reading_id, status, priority)
     VALUES ($1, 'pending', $2)
     RETURNING *`,
    [readingId, priority]
  );
  return rows[0];
}

async function getQcPacketById(id) {
  const { rows } = await pool.query(
    `SELECT qp.*, r.value, r.unit, r.sensor_type, r.captured_at,
            r.signature, r.reading_hash, r.block_number,
            i.name as instrument_name, i.serial_number as instrument_serial,
            rev.name as reviewer_name, rev.role as reviewer_role,
            ass_reviewer.name as assigned_reviewer_name
     FROM qc_packets qp
     JOIN readings r ON r.id = qp.reading_id
     JOIN instruments i ON i.id = r.instrument_id
     LEFT JOIN reviewers rev ON rev.id = qp.reviewer_id
     LEFT JOIN reviewers ass_reviewer ON ass_reviewer.id = qp.assigned_reviewer_id
     WHERE qp.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getQcPackets({ status, limit = 50, offset = 0 }) {
  let q = `SELECT qp.*, r.value, r.unit, r.sensor_type, r.captured_at,
                  i.name as instrument_name
           FROM qc_packets qp
           JOIN readings r ON r.id = qp.reading_id
           JOIN instruments i ON i.id = r.instrument_id
           WHERE 1=1`;
  const params = [];
  if (status) { params.push(status); q += ` AND qp.status = $${params.length}`; }
  params.push(limit, offset);
  q += ` ORDER BY qp.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const { rows } = await pool.query(q, params);
  return rows;
}

async function getQcPacketByReadingId(readingId) {
  const { rows } = await pool.query(
    `SELECT qp.*, rev.name as reviewer_name, rev.role as reviewer_role
     FROM qc_packets qp
     LEFT JOIN reviewers rev ON rev.id = qp.reviewer_id
     WHERE qp.reading_id = $1`,
    [readingId]
  );
  return rows[0] || null;
}

async function updateQcPacketStatus(id, { status, reviewerId, notes, approvedAt }) {
  const { rows } = await pool.query(
    `UPDATE qc_packets
     SET status = $2, reviewer_id = $3, notes = $4, approved_at = $5
     WHERE id = $1
     RETURNING *`,
    [id, status, reviewerId, notes, approvedAt]
  );
  return rows[0] || null;
}

async function assignReviewer(qcPacketId, reviewerId) {
  const { rows } = await pool.query(
    `UPDATE qc_packets SET assigned_reviewer_id = $2 WHERE id = $1 RETURNING *`,
    [qcPacketId, reviewerId]
  );
  return rows[0] || null;
}

async function getQcPacketStats() {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*) as count FROM qc_packets GROUP BY status`
  );
  return rows;
}

module.exports = { createQcPacket, getQcPacketById, getQcPackets, getQcPacketByReadingId, updateQcPacketStatus, assignReviewer, getQcPacketStats };