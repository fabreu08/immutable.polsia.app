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

// --- Page routes ---

app.get('/readings', async (req, res) => {
  try {
    const { pool } = require('./db/index');
    const sensorType = req.query.sensor_type || null;

    let where = '';
    const params = [];
    if (sensorType) {
      where = 'WHERE i.sensor_type = $1';
      params.push(sensorType);
    }

    const result = await pool.query(`
      SELECT 
        r.*,
        i.name as iname,
        i.serial_number as iserial,
        COALESCE(qp.status, null) as qc_status
      FROM readings r
      LEFT JOIN instruments i ON r.instrument_id = i.id
      LEFT JOIN qc_packets qp ON qp.reading_id = r.id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT 100
    `, params);

    const totalRes = await pool.query('SELECT COUNT(*)::int as total FROM readings');
    const total = totalRes.rows[0].total;

    res.render('readings', { 
      readings: result.rows, 
      total, 
      sensorType, 
      currentPath: '/readings' 
    });
  } catch (err) {
    console.error('Error loading readings:', err);
    res.status(500).send('Error loading readings: ' + err.message);
  }
});

app.get('/ledger', async (req, res) => {
  try {
    const { pool } = require('./db/index');

    const entries = await pool.query(`
      SELECT *, created_at as block_timestamp 
      FROM ledger_entries 
      ORDER BY block_number DESC
    `);

    const statsRes = await pool.query(`
      SELECT 
        COUNT(*)::int as c,
        COALESCE(SUM(reading_count), 0)::int as tr,
        COALESCE(MAX(block_number), 0)::int as lb
      FROM ledger_entries
    `);

    const stats = statsRes.rows[0];

    // Provide empty on-chain data for now (the on-chain section can be enhanced later)
    const onChainStats = { count: 0, explorerBase: 'https://sepolia.basescan.org', contract: '' };
    const onChainAttestations = [];

    res.render('ledger', { 
      chain: entries.rows, 
      stats, 
      onChainStats, 
      onChainAttestations,
      currentPath: '/ledger' 
    });
  } catch (err) {
    console.error('Error loading ledger:', err);
    res.status(500).send('Error loading ledger: ' + err.message);
  }
});

app.get('/review', async (req, res) => {
  try {
    const { pool } = require('./db/index');
    const selectedStatus = req.query.status || null;

    let where = '';
    const params = [];
    if (selectedStatus) {
      where = 'WHERE qp.status = $1';
      params.push(selectedStatus);
    }

    let packets;
    try {
      packets = await pool.query(`
        SELECT 
          qp.*,
          rd.value,
          rd.unit,
          rd.sensor_type,
          i.name as iname,
          r.name as reviewer_name
        FROM qc_packets qp
        LEFT JOIN readings rd ON qp.reading_id = rd.id
        LEFT JOIN instruments i ON rd.instrument_id = i.id
        LEFT JOIN reviewers r ON qp.assigned_reviewer_id = r.id
        ${where}
        ORDER BY qp.created_at DESC
      `, params);
    } catch (queryErr) {
      // Fallback if assigned_reviewer_id column doesn't exist yet (schema drift)
      if (queryErr.message.includes('assigned_reviewer_id')) {
        packets = await pool.query(`
          SELECT 
            qp.*,
            rd.value,
            rd.unit,
            rd.sensor_type,
            i.name as iname,
            NULL as reviewer_name
          FROM qc_packets qp
          LEFT JOIN readings rd ON qp.reading_id = rd.id
          LEFT JOIN instruments i ON rd.instrument_id = i.id
          ${where}
          ORDER BY qp.created_at DESC
        `, params);
      } else {
        throw queryErr;
      }
    }

    // Get status counts for the filter tabs
    const qcStats = await pool.query(`
      SELECT status, COUNT(*)::int as c 
      FROM qc_packets 
      GROUP BY status
    `);

    res.render('review', { 
      packets: packets.rows, 
      qcStats: qcStats.rows,
      selectedStatus,
      currentPath: '/review' 
    });
  } catch (err) {
    console.error('Error loading review:', err);
    res.status(500).send('Error loading review: ' + err.message);
  }
});

app.get('/submit', (req, res) => {
  res.render('submit', { currentPath: '/submit' });
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

// Start the server
app.listen(port, () => {
  console.log(`Immutable QC running on port ${port}`);
});

