/**
 * routes/demo-requests.js — Demo request API.
 * Handles demo request submissions. Inbox notification is handled via the daily operating cycle.
 * Does NOT own pricing page rendering.
 */
const express = require('express');
const router = express.Router();
const dbDemoRequests = require('../db/demo_requests');

// POST /api/demo-request — Submit a demo request
router.post('/', async (req, res) => {
  try {
    const { name, email, company } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'name and email are required' });
    }

    // Basic email format check
    const emailRegex = /^[^\n@\t ]+@[^\n@\t ]+\//;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const existing = await dbDemoRequests.getDemoRequestByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'A demo request from this email is already on file' });
    }

    const record = await dbDemoRequests.createDemoRequest({ name, email, company });

    res.json({
      message: 'Demo request received. We will be in touch.',
      id: record.id,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A demo request from this email is already on file' });
    }
    console.error('POST /api/demo-request error:', err);
    res.status(500).json({ error: 'Failed to submit demo request. Please try again.' });
  }
});

// GET /api/demo-request/count — Public count of demo requests (trust signal)
router.get('/count', async (_req, res) => {
  try {
    const count = await dbDemoRequests.countDemoRequests();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch count' });
  }
});

module.exports = router;