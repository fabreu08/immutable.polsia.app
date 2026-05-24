/**
 * services/qc-packet.js — QC Packet creation and workflow.
 * Wraps a reading in a QC packet and manages the attestation flow.
 */
const dbQcPackets = require('../db/qc_packets');
const dbAttestations = require('../db/attestations');
const dbReviewers = require('../db/reviewers');

/**
 * Create a QC packet for a new reading.
 * Auto-assigns to the next available reviewer in round-robin.
 */
async function createPacketForReading(readingId, instrumentId) {
  // Determine priority based on value ranges
  const priority = 'normal';

  const packet = await dbQcPackets.createQcPacket({ readingId, priority });

  // Auto-assign a reviewer (round-robin by lowest workload)
  const reviewers = await dbReviewers.getAllReviewers(true);
  if (reviewers.length > 0) {
    // Simple round-robin: pick the reviewer with least assigned packets
    let assigned = reviewers[0];
    for (const rev of reviewers) {
      const existingPackets = await dbQcPackets.getQcPackets({ status: 'pending', limit: 100 });
      const assignedCount = existingPackets.filter(p => p.assigned_reviewer_id === rev.id).length;
      const minCount = existingPackets.filter(p => p.assigned_reviewer_id === assigned.id).length;
      if (assignedCount < minCount) assigned = rev;
    }
    await dbQcPackets.assignReviewer(packet.id, assigned.id);
    packet.assigned_reviewer_id = assigned.id;
  }

  // Record the auto-creation attestation
  if (reviewers.length > 0) {
    await dbAttestations.createAttestation({
      qcPacketId: packet.id,
      reviewerId: reviewers[0].id,
      action: 'submitted',
      notes: 'Auto-created QC packet from reading ingestion',
      signature: null,
    });
  }

  return packet;
}

/**
 * Attest a QC packet (approve/reject/flag).
 */
async function attestPacket(qcPacketId, reviewerId, action, notes) {
  const packet = await dbQcPackets.getQcPacketById(qcPacketId);
  if (!packet) throw new Error('QC packet not found');

  const validActions = ['approved', 'rejected', 'flagged'];
  if (!validActions.includes(action)) throw new Error(`Invalid action: ${action}`);

  const now = new Date();
  await dbQcPackets.updateQcPacketStatus(qcPacketId, {
    status: action,
    reviewerId,
    notes,
    approvedAt: now,
  });

  const attestation = await dbAttestations.createAttestation({
    qcPacketId,
    reviewerId,
    action,
    notes,
    signature: null,
  });

  return { packet, attestation };
}

module.exports = { createPacketForReading, attestPacket };