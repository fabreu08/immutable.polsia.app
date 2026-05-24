/**
 * routes/analytics.js — Analytics event collection API.
 * Owns event ingestion. Does NOT own analytics dashboard rendering.
 */
const express = require('express');
const router = express.Router();
const dbAnalytics = require('../db/analytics');

// POST /api/analytics/event — Record a client-side event
router.post('/event', async (req, res) => {
  try {
    const { event_name, properties, session_id } = req.body;
    if (!event_name || typeof event_name !== 'string' || event_name.length > 128) {
      return res.status(400).json({ error: 'event_name is required (max 128 chars)' });
    }
    const record = await dbAnalytics.recordEvent({
      eventName: event_name,
      properties: properties || {},
      sessionId: session_id || req.headers['x-session-id'] || null,
      userAgent: req.headers['user-agent'] || null,
      ipAddress: req.ip || null,
    });
    res.json({ recorded: true, id: record.id });
  } catch (err) {
    // Non-critical: don't fail requests if analytics fails
    console.error('analytics event error:', err.message);
    res.status(500).json({ error: 'Failed to record event' });
  }
});

// GET /api/analytics/summary — Query event counts (internal / admin use)
router.get('/summary', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const [counts, pageViews] = await Promise.all([
      dbAnalytics.getEventCounts({ days }),
      dbAnalytics.getPageViewCounts({ days }),
    ]);
    res.json({ counts, pageViews, days });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;