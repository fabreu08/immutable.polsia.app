/**
 * routes/instruments.js — Instrument registration.
 * GET  /api/instruments        — List registered instruments
 * POST /api/instruments         — Register a new instrument
 * GET  /api/instruments/:id     — Get instrument details
 */
const express = require('express');
const router = express.Router();
const dbInstruments = require('../db/instruments');
const cryptoService = require('../services/crypto');

// GET /api/instruments
router.get('/', async (req, res) => {
  try {
    const { active_only = true } = req.query;
    const instruments = await dbInstruments.getAllInstruments(active_only !== 'false');
    res.json({ instruments, count: instruments.length });
  } catch (err) {
    console.error('GET /api/instruments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/instruments/:id
router.get('/:id', async (req, res) => {
  try {
    const instrument = await dbInstruments.getInstrumentById(parseInt(req.params.id));
    if (!instrument) return res.status(404).json({ error: 'Instrument not found' });
    res.json({ instrument });
  } catch (err) {
    console.error('GET /api/instruments/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/instruments
router.post('/', async (req, res) => {
  try {
    const { name, sensorType, serialNumber, location } = req.body;
    if (!name || !sensorType || !serialNumber) {
      return res.status(400).json({ error: 'name, sensorType, and serialNumber required' });
    }

    // Check if already registered
    const existing = await dbInstruments.getInstrumentBySerial(serialNumber);
    if (existing) {
      return res.status(409).json({ error: 'Instrument already registered', instrument: existing });
    }

    // Generate a key fingerprint for this instrument
    const { fingerprint } = cryptoService.getSigningKey();

    const instrument = await dbInstruments.createInstrument({
      name,
      sensorType,
      serialNumber,
      keyFingerprint: fingerprint,
      location: location || null,
    });

    res.status(201).json({
      instrument,
      note: 'ECDSA key generated for this instrument. Use the fingerprint for verification.',
    });
  } catch (err) {
    console.error('POST /api/instruments error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;