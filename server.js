/**
 * server.js — Immutable QC entry point.
 * Wiring only: middleware, route mounts, app.listen.
 * All business logic lives in routes/, db/, services/.
 */
const express = require('express');
const path = require('path');
const { buildLandingContext } = require('./lib/landing-context');

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

// Defensive table creation for tables that were historically created manually
const { ensureTables } = require('./db/index');
ensureTables().catch(() => { /* non-fatal */ });

app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/health', async (req, res) => {
  try {
    const { pool } = require('./db/index');
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'unhealthy', db: 'disconnected' });
  }
});

  // Root → Dashboard for app.immutableqc.com
app.get('/', (_req, res) => res.redirect('/dashboard'));
app.use(express.static(path.join(__dirname, 'public'), { index: false }))


// API routes
app.use('/api/instruments', require('./routes/instruments'));
app.use('/api/readings',    require('./routes/readings'));
app.use('/api/qc-packets',  require('./routes/qc-packets'));
app.use('/api/reviewers',   require('./routes/reviewers'));
app.use('/api/ledger',      require('./routes/ledger'));
app.use('/api/wallet',      require('./routes/wallet'));
app.use('/api/hplc',        require('./routes/hplc'));
app.use('/api/demo-request', require('./routes/demo-requests'));
app.use('/api/analytics',     require('./routes/analytics'));
app.use('/api/faucet',        require('./routes/faucet'));

// Demo seed endpoint — populates 2 instruments + 3 reviewers
app.post('/api/seed', async (req, res) => {
  try {
    const dbInstruments = require('./db/instruments');
    const dbReviewers = require('./db/reviewers');
    const { getSigningKey } = require('./services/crypto');

    const instrumentData = [
      { name: 'pH Meter Alpha-1',  sensorType: 'ph',         serialNumber: 'PH-2026-001',   location: 'Lab A' },
      { name: 'Temperature Probe T-77', sensorType: 'temperature', serialNumber: 'TEMP-2026-077', location: 'Lab B' },
    ];
    const reviewerData = [
      { name: 'Dr. Sarah Chen',       email: 'sarah.chen@immutable-qc.polsia.app',      role: 'lab_manager', department: 'Quality Assurance' },
      { name: 'Marcus Thompson',     email: 'marcus.thompson@immutable-qc.polsia.app',  role: 'qc_analyst',  department: 'Lab Operations' },
      { name: 'Dr. Elena Rodriguez',  email: 'elena.rodriguez@immutable-qc.polsia.app',  role: 'qa_director', department: 'Quality Assurance' },
    ];

    const instruments = await Promise.all(instrumentData.map(async (d) => {
      const ex = await dbInstruments.getInstrumentBySerial(d.serialNumber);
      if (ex) return ex;
      const { fingerprint } = getSigningKey();
      return dbInstruments.createInstrument({ ...d, keyFingerprint: fingerprint });
    }));

    const reviewers = await Promise.all(reviewerData.map(async (d) => {
      const ex = await dbReviewers.getReviewerByEmail(d.email);
      if (ex) return ex;
      return dbReviewers.createReviewer(d);
    }));

    res.json({ instruments, reviewers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Dashboard pages ---

app.get('/dashboard', async (_req, res) => {
  try {
    const dbWallet = require('./db/wallet_attestations');
    const { pool } = require('./db/index');
    const [r, q, l, i, rv] = await Promise.all([
      pool.query('SELECT COUNT(*) as c FROM readings'),
      pool.query('SELECT status, COUNT(*) as c FROM qc_packets GROUP BY status'),
      pool.query('SELECT COUNT(*) as c, COALESCE(SUM(reading_count),0) as tr, COALESCE(MAX(block_number),0) as lb FROM ledger_entries'),
      pool.query('SELECT COUNT(*) as c FROM instruments'),
      pool.query('SELECT COUNT(*) as c FROM reviewers'),
    ]);
    // Wallet stats — safe fallback if table doesn't exist yet
    let ws = { total: '0', unique_wallets: '0' };
    try { ws = await dbWallet.getWalletAttestationStats(); } catch {}
    const qcS = q.rows;
    const find = (s) => qcS.find(r => r.status === s)?.c || '0';
    res.render('dashboard', {
      readings: r.rows[0].c,
      pendingCount: find('pending'),
      approvedCount: find('approved'),
      rejectedCount: find('rejected'),
      totalBlocks: l.rows[0].c,
      totalReadings: l.rows[0].tr,
      latestBlock: l.rows[0].lb,
      instrumentCount: i.rows[0].c,
      reviewerCount: rv.rows[0].c,
      walletAttestations: ws.total || '0',
      walletUniqueWallets: ws.unique_wallets || '0',
      currentPath: '/dashboard',
    });
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

