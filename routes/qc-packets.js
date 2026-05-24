/**
 * routes/qc-packets.js — QC packet management and attestation.
 * GET  /api/qc-packets         — List QC packets
 * GET  /api/qc-packets/:id     — Get a QC packet with attestations
 * PATCH /api/qc-packets/:id     — Update status (attest/reject/flag)
 * POST /api/qc-packets/:id/attest — Submit attestation
 */
const express = require('express');
const router = express.Router();
const dbQcPackets = require('../db/qc_packets');
const dbAttestations = require('../db/attestations');
const qcPacketService = require('../services/qc-packet');

// GET /api/qc-packets
router.get('/', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const packets = await dbQcPackets.getQcPackets({
      status,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    const stats = await dbQcPackets.getQcPacketStats();
    res.json({ packets, stats, count: packets.length });
  } catch (err) {
    console.error('GET /api/qc-packets error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-packets/:id
router.get('/:id', async (req, res) => {
  try {
    const packet = await dbQcPackets.getQcPacketById(parseInt(req.params.id));
    if (!packet) return res.status(404).json({ error: 'QC packet not found' });
    const attestations = await dbAttestations.getAttestationsForPacket(packet.id);
    res.json({ packet, attestations });
  } catch (err) {
    console.error('GET /api/qc-packets/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/qc-packets/:id — reviewer attestation
router.patch('/:id', async (req, res) => {
  try {
    const { reviewerId, action, notes } = req.body;
    if (!reviewerId || !action) {
      return res.status(400).json({ error: 'reviewerId and action required' });
    }
    const result = await qcPacketService.attestPacket(
      parseInt(req.params.id),
      parseInt(reviewerId),
      action,
      notes || null
    );
    res.json(result);
  } catch (err) {
    console.error('PATCH /api/qc-packets/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;