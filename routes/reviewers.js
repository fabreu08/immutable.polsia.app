/**
 * routes/reviewers.js — Reviewer management.
 * GET  /api/reviewers         — List reviewers
 * POST /api/reviewers         — Create a reviewer
 * GET  /api/reviewers/:id      — Get reviewer details and attestation history
 */
const express = require('express');
const router = express.Router();
const dbReviewers = require('../db/reviewers');
const dbAttestations = require('../db/attestations');

// GET /api/reviewers
router.get('/', async (req, res) => {
  try {
    const { active_only = true } = req.query;
    const reviewers = await dbReviewers.getAllReviewers(active_only !== 'false');
    res.json({ reviewers, count: reviewers.length });
  } catch (err) {
    console.error('GET /api/reviewers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reviewers/:id
router.get('/:id', async (req, res) => {
  try {
    const reviewer = await dbReviewers.getReviewerById(parseInt(req.params.id));
    if (!reviewer) return res.status(404).json({ error: 'Reviewer not found' });
    const attestations = await dbAttestations.getAttestationsByReviewer(reviewer.id);
    res.json({ reviewer, attestations, count: attestations.length });
  } catch (err) {
    console.error('GET /api/reviewers/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reviewers
router.post('/', async (req, res) => {
  try {
    const { name, email, role, department } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ error: 'name, email, and role required' });
    }
    const existing = await dbReviewers.getReviewerByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Reviewer with this email already exists', reviewer: existing });
    }
    const reviewer = await dbReviewers.createReviewer({ name, email, role, department: department || null });
    res.status(201).json({ reviewer });
  } catch (err) {
    console.error('POST /api/reviewers error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;