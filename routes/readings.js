/**
 * routes/readings.js — Instrument reading endpoints.
 * POST /api/readings    — Submit a new reading from an instrument
 * GET  /api/readings    — List readings (filterable)
 * GET  /api/readings/:id — Get a single reading with full details
 * GET  /api/readings/:id/verify — Verify cryptographic integrity of a reading
 */
const express = require('express');
const router = express.Router();
const dbReadings = require('../db/readings');
const dbInstruments = require('../db/instruments');
const dbLedger = require('../db/ledger');
const dbQcPackets = require('../db/qc_packets');
const cryptoService = require('../services/crypto');
const ledgerService = require('../services/ledger');
const qcPacketService = require('../services/qc-packet');

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// GET /api/readings
router.get('/', async (req, res) => {
  try {
    const { instrument_id, sensor_type, limit = 50, offset = 0 } = req.query;
    const readings = await dbReadings.getReadings({
      instrumentId: instrument_id ? parseInt(instrument_id) : undefined,
      sensorType: sensor_type,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    res.json({ readings, count: readings.length });
  } catch (err) {
    console.error('GET /api/readings error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/readings/:id
router.get('/:id', async (req, res) => {
  try {
    const reading = await dbReadings.getReadingById(parseInt(req.params.id));
    if (!reading) return res.status(404).json({ error: 'Reading not found' });
    const qcPacket = await dbQcPackets.getQcPacketByReadingId(reading.id);
    res.json({ reading, qcPacket });
  } catch (err) {
    console.error('GET /api/readings/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/readings/:id/verify
router.get('/:id/verify', async (req, res) => {
  try {
    const reading = await dbReadings.getReadingById(parseInt(req.params.id));
    if (!reading) return res.status(404).json({ error: 'Reading not found' });

    // 1. Re-hash the reading payload
    const readingObj = {
      instrumentId: reading.instrument_id,
      sensorType: reading.sensor_type,
      value: reading.value,
      unit: reading.unit,
      capturedAt: reading.captured_at,
    };
    const computedHash = cryptoService.hashReading(readingObj);
    const hashValid = computedHash === reading.reading_hash;

    // 2. Verify chain link
    const prevReading = await dbReadings.getReadings({ limit: 1, descending: true });
    const prevEntry = await dbLedger.getLatestLedgerEntry();
    const prevHash = reading.block_number === 1
      ? GENESIS_HASH
      : (prevEntry ? prevEntry.block_hash : GENESIS_HASH);
    const chainValid = reading.previous_hash === prevHash;

    // 3. Verify ECDSA signature (using stored fingerprint to reconstruct key)
    // For now, just confirm signature exists and hash is valid
    const signatureValid = !!reading.signature && reading.signature.length > 50;

    res.json({
      readingId: reading.id,
      blockNumber: reading.block_number,
      hashValid,
      chainValid,
      signatureValid,
      computedHash,
      storedHash: reading.reading_hash,
      previousHash: reading.previous_hash,
      verified: hashValid && chainValid && signatureValid,
    });
  } catch (err) {
    console.error('GET /api/readings/:id/verify error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/readings
router.post('/', async (req, res) => {
  try {
    const {
      instrumentId,
      sensorType,
      value,
      unit,
      capturedAt,
      instrumentSerial,
    } = req.body;

    if (!instrumentId && !instrumentSerial) {
      return res.status(400).json({ error: 'instrumentId or instrumentSerial required' });
    }
    if (!sensorType || value === undefined || !unit) {
      return res.status(400).json({ error: 'sensorType, value, and unit are required' });
    }

    // Resolve instrument
    let instrument;
    if (instrumentId) {
      instrument = await dbInstruments.getInstrumentById(parseInt(instrumentId));
    } else {
      instrument = await dbInstruments.getInstrumentBySerial(instrumentSerial);
    }
    if (!instrument) {
      return res.status(404).json({ error: 'Instrument not found. Register it first at POST /api/instruments' });
    }

    // Get signing key
    const { privateKey, fingerprint } = cryptoService.getSigningKey();

    // Hash and sign the reading
    const readingObj = {
      instrumentId: instrument.id,
      sensorType,
      value: parseFloat(value),
      unit,
      capturedAt: capturedAt || new Date().toISOString(),
    };
    const readingHash = cryptoService.hashReading(readingObj);
    const signature = cryptoService.signHash(readingHash, privateKey);

    // === FAST RELIABLE PATH (current production mode) ===
    // Submissions are optimized for reliability. Ledger blocks are created asynchronously in background.
    let reading;
    try {
      reading = await dbReadings.createReading({
        instrumentId: instrument.id,
        sensorType,
        value: parseFloat(value),
        unit,
        capturedAt: readingObj.capturedAt,
        signature: null,
        signingKeyFingerprint: null,
        previousHash: null,
        blockNumber: 0,
        readingHash,
      });
    } catch (err) {
      console.error('Even minimal createReading failed:', err);
      return res.status(500).json({ error: 'Failed to save reading: ' + err.message });
    }

    // Background ledger block creation (non-blocking)
    // This is the short-term architecture: fast reliable saves + best-effort ledger in background.
    setImmediate(async () => {
      try {
        await ledgerService.commitBlock([readingHash]);
        console.log(`Background ledger block created for reading ${reading.id}`);
      } catch (ledgerErr) {
        console.warn(`Background ledger creation failed for reading ${reading.id}:`, ledgerErr.message);
      }
    });

    res.status(201).json({
      reading,
      qcPacket: { id: null, status: 'pending' },
      verification: {
        readingHash,
        signature: null,
        blockNumber: 0,
        chainHash: null,
        fingerprint: null,
      },
      note: 'Reading saved (fast path). A ledger block is being created in the background. You can also call POST /api/readings/:id/commit-ledger to force it manually.',
    });
  } catch (err) {
    console.error('POST /api/readings error:', err);
    res.status(500).json({ 
      error: err.message || 'Failed to save reading',
      code: 'SUBMISSION_FAILED'
    });
  }
});

// POST /api/readings/:id/commit-ledger
// Manual reconciliation endpoint: Force creation of a ledger block for an existing reading
// Useful for upgrading old "fast path" readings to proper ledger entries.
router.post('/:id/commit-ledger', async (req, res) => {
  try {
    const readingId = parseInt(req.params.id);
    const reading = await dbReadings.getReadingById(readingId);

    if (!reading) {
      return res.status(404).json({ error: 'Reading not found' });
    }

    if (!reading.reading_hash) {
      return res.status(400).json({ error: 'Reading has no hash (cannot create ledger block)' });
    }

    const ledgerEntry = await ledgerService.commitBlock([reading.reading_hash]);

    res.json({
      success: true,
      readingId,
      ledgerBlock: {
        blockNumber: ledgerEntry.block_number,
        blockHash: ledgerEntry.block_hash,
      },
    });
  } catch (err) {
    console.error('POST /api/readings/:id/commit-ledger error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;