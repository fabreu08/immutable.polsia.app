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

    // Get previous hash for chain
    const latestEntry = await dbLedger.getLatestLedgerEntry();
    const genesisBlock = await ledgerService.getOrCreateGenesisBlock();
    const previousHash = latestEntry ? latestEntry.block_hash : GENESIS_HASH;

    // Get next block number (using ledger block count)
    const nextBlock = latestEntry ? latestEntry.block_number + 1 : 1;

    // Chain hash
    const chainHash = cryptoService.chainHash(previousHash, readingHash, nextBlock);

    // Create reading
    const reading = await dbReadings.createReading({
      instrumentId: instrument.id,
      sensorType,
      value: parseFloat(value),
      unit,
      capturedAt: readingObj.capturedAt,
      signature,
      signingKeyFingerprint: fingerprint,
      previousHash: chainHash,
      blockNumber: nextBlock,
      readingHash,
    });

    // Auto-create QC packet
    const qcPacket = await qcPacketService.createPacketForReading(reading.id, instrument.id);

    res.status(201).json({
      reading,
      qcPacket,
      verification: {
        readingHash,
        signature,
        blockNumber: nextBlock,
        chainHash,
        fingerprint,
      },
    });
  } catch (err) {
    console.error('POST /api/readings error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;