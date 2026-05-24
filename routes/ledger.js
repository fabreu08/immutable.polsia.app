/**
 * routes/ledger.js — Blockchain ledger endpoints.
 * GET /api/ledger            — List ledger entries
 * GET /api/ledger/stats      — Ledger statistics
 * GET /api/ledger/verify     — Verify entire chain integrity
 * GET /api/ledger/block/:n   — Get a specific block
 * GET /api/ledger/on-chain-attestations — On-chain attestation events from IQC contract
 */
const express = require('express');
const router = express.Router();
const ledgerService = require('../services/ledger');
const dbLedger = require('../db/ledger');
const dbReadings = require('../db/readings');
const iqcContract = require('../services/iqc-contract');

// GET /api/ledger
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const chain = await dbLedger.getLedgerChain(parseInt(limit), parseInt(offset));
    const stats = await dbLedger.getLedgerStats();
    res.json({ chain, stats, count: chain.length });
  } catch (err) {
    console.error('GET /api/ledger error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ledger/stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await dbLedger.getLedgerStats();
    const readingsCount = await dbReadings.countReadings();
    const pendingPackets = await dbReadings.getReadings({ limit: 1 });
    res.json({ ...stats, readingsInChain: readingsCount });
  } catch (err) {
    console.error('GET /api/ledger/stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ledger/verify
router.get('/verify', async (req, res) => {
  try {
    const result = await ledgerService.verifyLedgerIntegrity();
    res.json(result);
  } catch (err) {
    console.error('GET /api/ledger/verify error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ledger/block/:n
router.get('/block/:n', async (req, res) => {
  try {
    const blockNumber = parseInt(req.params.n);
    const entry = await dbLedger.getLedgerEntryByBlock(blockNumber);
    if (!entry) return res.status(404).json({ error: 'Block not found' });
    res.json({ block: entry });
  } catch (err) {
    console.error('GET /api/ledger/block/:n error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ledger/on-chain-attestations — fetch attestation events from IQC token contract
router.get('/on-chain-attestations', async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const attestations = await iqcContract.getRecentAttestations(parseInt(limit));
    const tokenInfo = await iqcContract.getIqcTokenInfo();
    res.json({
      attestations,
      tokenInfo,
      contract: iqcContract.IQC_CONTRACT,
      network: 'Base Sepolia',
      chainId: iqcContract.BASE_SEPOLIA_CHAIN_ID,
      explorerBase: iqcContract.BASESCAN_BASE,
    });
  } catch (err) {
    console.error('GET /api/ledger/on-chain-attestations error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;