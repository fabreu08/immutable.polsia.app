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

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/', (_req, res) => res.render('layout', buildLandingContext()));

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

app.get('/readings', async (req, res) => {
  try {
    const { pool } = require('./db/index');
    const { limit = 50, offset = 0, sensor_type: st = '' } = req.query;
    let q = `SELECT r.*, i.name as iname, i.serial_number as iserial, qp.status as qc_status
             FROM readings r JOIN instruments i ON i.id = r.instrument_id
             LEFT JOIN qc_packets qp ON qp.reading_id = r.id WHERE 1=1`;
    const p = [];
    if (st) { p.push(st); q += ` AND r.sensor_type = $${p.length}`; }
    p.push(limit, offset);
    q += ` ORDER BY r.captured_at DESC LIMIT $${p.length - 1} OFFSET $${p.length}`;
    const [rows, total] = await Promise.all([pool.query(q, p), pool.query('SELECT COUNT(*) as c FROM readings')]);
    res.render('readings', { readings: rows.rows, total: parseInt(total.rows[0].c), sensorType: st, currentPath: '/readings' });
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

app.get('/ledger', async (_req, res) => {
  try {
    const { pool } = require('./db/index');
    const iqcContract = require('./services/iqc-contract');

    const [chain, stats, onChain] = await Promise.all([
      pool.query('SELECT * FROM ledger_entries ORDER BY block_number DESC LIMIT 50'),
      pool.query('SELECT COUNT(*) as c, COALESCE(SUM(reading_count),0) as tr, COALESCE(MAX(block_number),0) as lb FROM ledger_entries'),
      iqcContract.getRecentAttestations(50).catch(() => []),
    ]);

    res.render('ledger', {
      chain: chain.rows,
      stats: stats.rows[0],
      onChainAttestations: onChain,
      onChainStats: {
        count: onChain.length,
        contract: iqcContract.IQC_CONTRACT,
        explorerBase: iqcContract.BASESCAN_BASE,
      },
      currentPath: '/ledger',
    });
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

app.get('/review', async (req, res) => {
  try {
    const { pool } = require('./db/index');
    const status = req.query.status || 'pending';
    const [packets, reviewers, qcStats] = await Promise.all([
      pool.query(
        `SELECT qp.*, r.value, r.unit, r.sensor_type, r.captured_at, r.reading_hash, r.block_number,
                i.name as iname, i.serial_number as iserial, ass_rev.name as assigned_name
         FROM qc_packets qp
         JOIN readings r ON r.id = qp.reading_id
         JOIN instruments i ON i.id = r.instrument_id
         LEFT JOIN reviewers ass_rev ON ass_rev.id = qp.assigned_reviewer_id
         WHERE qp.status = $1
         ORDER BY qp.created_at DESC LIMIT 100`,
        [status]
      ),
      pool.query('SELECT * FROM reviewers WHERE active = true ORDER BY name'),
      pool.query('SELECT status, COUNT(*) as c FROM qc_packets GROUP BY status'),
    ]);
    res.render('review', { packets: packets.rows, reviewers: reviewers.rows, selectedStatus: status, qcStats: qcStats.rows, currentPath: '/review' });
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

app.get('/submit', (_req, res) => res.render('submit', { currentPath: '/submit' }));

app.get('/pricing', (_req, res) => res.render('pricing', { currentPath: '/pricing' }));

app.listen(port, () => console.log(`Immutable QC running on port ${port}`));