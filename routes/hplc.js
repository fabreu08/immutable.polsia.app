/**
 * routes/hplc.js — HPLC CSV upload endpoints.
 * POST /api/hplc/upload   — Parse and ingest HPLC CSV, create readings + QC packets
 * GET  /api/hplc/formats   — List supported formats
 *
 * Accepts CSV as base64-encoded string in JSON body (no multer needed).
 * Client sends: { csv: "base64-encoded CSV", instrumentSerial?, batchId?, injectionTime? }
 */
const express = require('express');
const router = express.Router();

const { parseHplcCsv } = require('../services/hplc-parser');
const dbReadings = require('../db/readings');
const dbInstruments = require('../db/instruments');
const dbLedger = require('../db/ledger');
const ledgerService = require('../services/ledger');
const qcPacketService = require('../services/qc-packet');
const cryptoService = require('../services/crypto');

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// GET /api/hplc/formats — supported HPLC CSV formats
router.get('/formats', (_req, res) => {
  res.json({
    supported: ['waters_empower', 'agilent_openlab'],
    fields: ['retentionTime (min)', 'peakArea (counts or pA*s)', 'resolution', 'tailingFactor', 'height', 'amount', 'name'],
    note: 'POST CSV as base64: { csv: "<base64>", instrumentSerial?, batchId?, injectionTime? }',
  });
});

// POST /api/hplc/upload — parse and ingest HPLC CSV
router.post('/upload', async (req, res) => {
  try {
    const { csv, instrumentId, instrumentSerial, batchId, injectionTime } = req.body;

    console.log('HPLC Upload: Received request', {
      csvLength: csv?.length,
      instrumentSerial,
      batchId,
      hasInjectionTime: !!injectionTime,
    });

    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({
        error: 'csv field required — pass base64-encoded CSV content as { csv: "<base64>" }',
        example: { csv: 'base64 string here', instrumentSerial: 'HPLC-2026-001', batchId: 'LOT-42' },
      });
    }

    // Decode base64 CSV content
    let csvBuffer;
    try {
      csvBuffer = Buffer.from(csv, 'base64');
    } catch {
      return res.status(400).json({ error: 'csv field must be valid base64-encoded text.' });
    }

    // Parse CSV early so we can use metadata for instrument resolution
    let parsed;
    try {
      parsed = parseHplcCsv(csvBuffer);
    } catch (err) {
      return res.status(422).json({
        error: `CSV parse error: ${err.message}`,
        hint: 'Ensure file is exported from Waters Empower or Agilent OpenLAB with Retention Time + Area columns',
      });
    }

    if (!parsed.peaks || parsed.peaks.length === 0) {
      return res.status(422).json({
        error: 'CSV parsed but no valid peaks found. Ensure the CSV has Retention Time and Area columns with numeric data.',
      });
    }

    // Require either form-provided serial or extractable instrument from CSV metadata
    const hasFormSerial = instrumentSerial && instrumentSerial.trim().length > 0;
    const hasCsvInstrument = parsed.metadata && parsed.metadata.instrument;

    if (!hasFormSerial && !hasCsvInstrument) {
      return res.status(400).json({
        error: 'Instrument Serial is required.',
        hint: 'Fill the "Instrument Serial" field in the form, or include an "Instrument" line in your CSV (e.g. "Instrument","Agilent 1260 Infinity II"). This prevents creating dozens of duplicate instruments.',
        receivedMetadata: parsed.metadata || null
      });
    }

    // Resolve or auto-register instrument.
    // Priority: 1. Form field, 2. CSV metadata (e.g. "Instrument" line), 3. Auto-create with timestamp
    let instrument;
    const csvInstrumentName = parsed.metadata?.instrument;

    if (instrumentId) {
      instrument = await dbInstruments.getInstrumentById(parseInt(instrumentId));
    } else if (instrumentSerial) {
      instrument = await dbInstruments.getInstrumentBySerial(instrumentSerial);
    } else if (csvInstrumentName) {
      // Try to find an existing instrument by name or serial that matches the CSV metadata
      instrument = await dbInstruments.getInstrumentBySerial(csvInstrumentName);
      if (!instrument) {
        // As a fallback, search by name (simple contains match)
        const all = await dbInstruments.getAllInstruments(false);
        instrument = all.find(i =>
          (i.name && i.name.toLowerCase().includes(csvInstrumentName.toLowerCase())) ||
          (i.serial_number && i.serial_number.toLowerCase().includes(csvInstrumentName.toLowerCase()))
        );
      }
    }

    if (!instrument) {
      // Only auto-create if we still have nothing
      const serial = instrumentSerial || csvInstrumentName || `HPLC-${Date.now()}`;
      const { fingerprint } = cryptoService.getSigningKey();
      instrument = await dbInstruments.createInstrument({
        name: csvInstrumentName ? `HPLC - ${csvInstrumentName}` : `HPLC Instrument (${serial})`,
        sensorType: 'hplc',
        serialNumber: serial,
        keyFingerprint: fingerprint,
        location: null,
      });
    }

    // Chain state for consecutive block numbering across peak batch
    const latestEntry = await dbLedger.getLatestLedgerEntry();
    await ledgerService.getOrCreateGenesisBlock();

    // FIX: Use mutable previous hash so each peak properly chains to the one before it
    let currentPreviousHash = latestEntry ? latestEntry.block_hash : GENESIS_HASH;
    const startBlock = latestEntry ? latestEntry.block_number + 1 : 1;

    const { privateKey, fingerprint } = cryptoService.getSigningKey();
    const capturedAt = injectionTime || new Date().toISOString();

    // Create signed reading + QC packet for each peak row
    const results = [];
    for (let i = 0; i < parsed.peaks.length; i++) {
      const peak = parsed.peaks[i];

      const readingObj = {
        instrumentId: instrument.id,
        sensorType: 'hplc',
        value: peak.peakArea,
        unit: 'counts',
        capturedAt,
      };

      const readingHash = cryptoService.hashReading(readingObj);
      const signature = cryptoService.signHash(readingHash, privateKey);
      const blockNum = startBlock + i;

      // Compute this block's chain hash from the *actual* previous link
      const chainHash = cryptoService.chainHash(currentPreviousHash, readingHash, blockNum);

      const reading = await dbReadings.createReadingWithMetadata({
        instrumentId: instrument.id,
        sensorType: 'hplc',
        value: peak.peakArea,
        unit: 'counts',
        capturedAt,
        signature,
        signingKeyFingerprint: fingerprint,
        // Store the correct previous link (not the new chainHash)
        previousHash: currentPreviousHash,
        blockNumber: blockNum,
        readingHash,
        measurementMetadata: JSON.stringify({
          format: parsed.format,
          retentionTime: peak.retentionTime,
          resolution: peak.resolution,
          tailingFactor: peak.tailingFactor,
          height: peak.height,
          amount: peak.amount,
          name: peak.name,
          batchId: batchId || null,
          peakIndex: i + 1,
          totalPeaks: parsed.peaks.length,
          chainHash, // persisted for verification/debugging
        }),
      });

      // CRITICAL: Advance the chain for the next peak
      currentPreviousHash = chainHash;

      const qcPacket = await qcPacketService.createPacketForReading(reading.id, instrument.id);
      results.push({ reading, qcPacket, peak });
    }

    res.status(201).json({
      instrument: { id: instrument.id, name: instrument.name, serialNumber: instrument.serial_number },
      format: parsed.format,
      peaksProcessed: parsed.peaks.length,
      readings: results,
      note: `${parsed.peaks.length} HPLC peaks ingested, signed, and assigned QC packets`,
    });
  } catch (err) {
    console.error('HPLC Upload Error:', {
      message: err.message,
      stack: err.stack,
      bodyKeys: Object.keys(req.body || {}),
      csvPrefix: req.body?.csv?.substring(0, 60),
    });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;