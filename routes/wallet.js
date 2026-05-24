/**
 * routes/wallet.js — Wallet attestation API.
 * Records EVM wallet signatures on QC packets. Does NOT own QC lifecycle or readings.
 */
const express = require('express');
const router = express.Router();
const dbWallet = require('../db/wallet_attestations');
const dbQcPackets = require('../db/qc_packets');

// POST /api/wallet/attest — Record an on-chain wallet signature for a QC packet
router.post('/attest', async (req, res) => {
  try {
    const { packetId, readingHash, walletAddress, chainId, signature, message, txHash } = req.body;

    if (!packetId || !walletAddress || !chainId || !signature || !message) {
      return res.status(400).json({ error: 'Missing required fields: packetId, walletAddress, chainId, signature, message' });
    }

    // Validate tx_hash format if provided
    if (txHash && !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return res.status(400).json({ error: 'Invalid txHash format — must be a 66-char hex string with 0x prefix' });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    // Verify QC packet exists
    const packet = await dbQcPackets.getQcPacketById(parseInt(packetId));
    if (!packet) {
      return res.status(404).json({ error: 'QC packet not found' });
    }

    // Check for duplicate attestation from same wallet
    const existing = await dbWallet.getWalletAttestationByPacketAndWallet(packetId, walletAddress);
    if (existing) {
      return res.status(409).json({ error: 'This wallet has already attested this packet', attestation: existing });
    }

    const attestation = await dbWallet.createWalletAttestation({
      qcPacketId: parseInt(packetId),
      walletAddress,
      chainId: parseInt(chainId),
      signature,
      message,
      readingHash: readingHash || packet.reading_hash,
      txHash: txHash || null,
    });

    res.json({ attestation });
  } catch (err) {
    console.error('POST /api/wallet/attest error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wallet/attestations/:packetId — Get wallet attestations for a QC packet
router.get('/attestations/:packetId', async (req, res) => {
  try {
    const attestations = await dbWallet.getWalletAttestationsForPacket(parseInt(req.params.packetId));
    res.json({ attestations });
  } catch (err) {
    console.error('GET /api/wallet/attestations error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wallet/stats — Wallet attestation stats
router.get('/stats', async (_req, res) => {
  try {
    const stats = await dbWallet.getWalletAttestationStats();
    res.json(stats);
  } catch (err) {
    console.error('GET /api/wallet/stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
