/**
 * routes/faucet.js — On-demand IQC token faucet for Base Sepolia testnet.
 * Sends a small amount of IQC tokens to a requesting wallet. Rate-limited by address + IP.
 * No auth required — testnet tokens have no real value.
 */
const express = require('express');
const router = express.Router();
const dbFaucet = require('../db/faucet_requests');

// Rate limit: 1 request per address per hour, 3 per IP per hour
const FAUCET_AMOUNT = '0.1';           // IQC per dispense
const WALLET_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const IP_COOLDOWN_MS = 60 * 60 * 1000;     // 1 hour
const MAX_PER_IP = 3;

// IQC token config
const IQC_CONTRACT = process.env.IQC_CONTRACT_ADDRESS || '0x6D3a4fb7D139d6bb2F241D7F5842955b9d747a4C'; // Real deployed IQCToken
const IQC_CHAIN_ID = 84532; // Base Sepolia
const RPC_URL = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';

const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

async function getEthProvider() {
  const { ethers } = await import('ethers');
  return new ethers.JsonRpcProvider(RPC_URL);
}

async function sendIqcTokens(toAddress, amountEth) {
  const { ethers } = await import('ethers');
  const provider = await getEthProvider();
  const faucetKey = process.env.FAUCET_PRIVATE_KEY;
  if (!faucetKey) throw new Error('Faucet not configured: FAUCET_PRIVATE_KEY env var missing');

  const wallet = new ethers.Wallet(faucetKey, provider);
  const contract = new ethers.Contract(IQC_CONTRACT, ERC20_TRANSFER_ABI, wallet);

  // Parse amount (18 decimals)
  const amountWei = ethers.parseUnits(amountEth, 18);
  const tx = await contract.transfer(toAddress, amountWei);
  // Wait for 1 confirmation
  await tx.wait(1);
  return tx.hash;
}

// POST /api/faucet
router.post('/', async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    // Validate EVM address
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid EVM address format' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
             || req.socket?.remoteAddress
             || 'unknown';

    // Rate limit: wallet cooldown
    const lastByWallet = await dbFaucet.getLastRequestByWallet(walletAddress);
    if (lastByWallet) {
      const elapsed = Date.now() - new Date(lastByWallet.created_at).getTime();
      if (elapsed < WALLET_COOLDOWN_MS) {
        const remaining = Math.ceil((WALLET_COOLDOWN_MS - elapsed) / 1000 / 60);
        return res.status(429).json({
          error: `Rate limit: address can request again in ${remaining} minute(s)`,
          retryAfter: Math.ceil((WALLET_COOLDOWN_MS - elapsed) / 1000),
        });
      }
    }

    // Rate limit: IP cooldown
    const lastByIP = await dbFaucet.getLastRequestByIP(ip);
    if (lastByIP) {
      const elapsed = Date.now() - new Date(lastByIP.created_at).getTime();
      if (elapsed < IP_COOLDOWN_MS) {
        const remaining = Math.ceil((IP_COOLDOWN_MS - elapsed) / 1000 / 60);
        return res.status(429).json({
          error: `Rate limit: too many requests from this IP. Try again in ${remaining} minute(s)`,
          retryAfter: Math.ceil((IP_COOLDOWN_MS - elapsed) / 1000),
        });
      }
    }

    // IP request count (within current hour window)
    const stats = await dbFaucet.getFaucetStats();

    let txHash;
    try {
      txHash = await sendIqcTokens(walletAddress, FAUCET_AMOUNT);
    } catch (err) {
      await dbFaucet.createFaucetRequest({
        walletAddress,
        ipAddress: ip,
        success: false,
        errorMessage: err.message,
      });
      return res.status(502).json({ error: 'Failed to send tokens: ' + err.message });
    }

    await dbFaucet.createFaucetRequest({
      walletAddress,
      ipAddress: ip,
      success: true,
      errorMessage: null,
    });

    res.json({
      success: true,
      amount: FAUCET_AMOUNT,
      txHash,
      explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`,
    });
  } catch (err) {
    console.error('POST /api/faucet error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/faucet/stats — Admin visibility
router.get('/stats', async (_req, res) => {
  try {
    const stats = await dbFaucet.getFaucetStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;