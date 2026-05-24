/**
 * db/analytics.js — Analytics event queries.
 * Owns reads and inserts for the analytics_events table only.
 */
const { pool } = require('./index');

async function recordEvent({ eventName, properties = {}, sessionId, userAgent, ipAddress }) {
  const result = await pool.query(
    `INSERT INTO analytics_events (event_name, properties, session_id, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [eventName, JSON.stringify(properties), sessionId || null, userAgent || null, ipAddress || null]
  );
  return result.rows[0];
}

async function queryEvents({ eventName, startDate, endDate, limit = 100 }) {
  let q = 'SELECT * FROM analytics_events WHERE 1=1';
  const p = [];
  if (eventName) { p.push(eventName); q += ` AND event_name = $${p.length}`; }
  if (startDate) { p.push(startDate); q += ` AND created_at >= $${p.length}`; }
  if (endDate) { p.push(endDate); q += ` AND created_at <= $${p.length}`; }
  p.push(limit);
  q += ` ORDER BY created_at DESC LIMIT $${p.length}`;
  const result = await pool.query(q, p);
  return result.rows;
}

async function getEventCounts({ days = 7 }) {
  const result = await pool.query(`
    SELECT
      event_name,
      COUNT(*) as count,
      COUNT(DISTINCT session_id) as unique_sessions
    FROM analytics_events
    WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
    GROUP BY event_name
    ORDER BY count DESC
  `);
  return result.rows;
}

async function getPageViewCounts({ days = 7 }) {
  const result = await pool.query(`
    SELECT
      properties->>'path' as path,
      COUNT(*) as views,
      COUNT(DISTINCT session_id) as unique_views
    FROM analytics_events
    WHERE event_name = 'page_view'
      AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
    GROUP BY properties->>'path'
    ORDER BY views DESC
  `);
  return result.rows;
}

module.exports = { recordEvent, queryEvents, getEventCounts, getPageViewCounts };