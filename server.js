const express  = require('express');
const fetch    = require('node-fetch');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const session  = require('express-session');

const app      = express();
const PORT     = 3000;
const API_KEY  = 'x8mgquMubZtKRsmOQyaW';
const API_BASE = 'https://api.reportingninja.com/v1';

// ─── Settings store ───────────────────────────────────────────────────────────
const IS_VERCEL     = !!process.env.VERCEL;
const DATA_DIR      = IS_VERCEL ? '/tmp' : path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ clients: {} }, null, 2));
  }
} catch (e) {
  console.error('Settings init error (non-fatal):', e.message);
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return { clients: {} }; }
}

function writeSettings(data) {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('writeSettings error:', e.message); }
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + ':woeler-rapportage').digest('hex');
}

// ─── Auth DB (read-only, shares Google Ads tool user table) ──────────────────
const authDb = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
}) : null;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'rapportage-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
}));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!authDb) return next(); // no DB configured → open access (local dev)
  if (req.session?.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Niet ingelogd' });
  res.redirect('/login');
}

// ─── Login page ───────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

// ─── API: login ───────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  if (!authDb) return res.json({ ok: true }); // no DB → skip auth
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Vul e-mail en wachtwoord in.' });
  try {
    const result = await authDb.query(
      'SELECT id, name, email, password, role, approved FROM "User" WHERE lower(email) = lower($1) LIMIT 1',
      [email]
    );
    const user = result.rows[0];
    if (!user || !user.password) return res.status(401).json({ error: 'Geen account gevonden.' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Onjuist wachtwoord.' });
    if (!user.approved && user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Account nog niet goedgekeurd.' });
    }
    req.session.userId = user.id;
    req.session.email  = user.email;
    req.session.name   = user.name;
    res.json({ ok: true, name: user.name });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Inloggen mislukt. Probeer opnieuw.' });
  }
});

// ─── API: logout ─────────────────────────────────────────────────────────────
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ─── API: current session ─────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!authDb || req.session?.userId) {
    res.json({ name: req.session?.name || 'Marketeer', email: req.session?.email || '' });
  } else {
    res.status(401).json({ error: 'Niet ingelogd' });
  }
});

// ─── Client view (shareable link) — public, has its own password gate ─────────
app.get('/r/:clientId', (req, res) => {
  const clientId = req.params.clientId.replace(/[^a-z0-9\-]/gi, '');
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
    const injected = html.replace(
      '</head>',
      `<script>window.CLIENT_MODE="${clientId}";</script>\n</head>`
    );
    res.send(injected);
  } catch (e) {
    res.status(500).send('Pagina niet gevonden');
  }
});

// ─── Settings page ────────────────────────────────────────────────────────────
app.get('/settings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/settings.html'));
});

// ─── Main dashboard ───────────────────────────────────────────────────────────
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ─── API: get settings (passwords masked) ─────────────────────────────────────
app.get('/api/settings', requireAuth, (req, res) => {
  const settings = readSettings();
  const safe = { clients: {} };
  for (const [id, cfg] of Object.entries(settings.clients || {})) {
    safe.clients[id] = { ...cfg, password: cfg.password ? '••••••••' : '' };
  }
  res.json(safe);
});

// ─── API: save settings ───────────────────────────────────────────────────────
app.post('/api/settings', requireAuth, (req, res) => {
  const incoming = req.body;
  const current  = readSettings();

  for (const [id, cfg] of Object.entries(incoming.clients || {})) {
    const existing = current.clients[id] || {};
    const entry    = { ...existing };

    if (cfg.password && cfg.password !== '••••••••') {
      entry.password = hashPassword(cfg.password);
    } else if (cfg.password === '') {
      entry.password = '';
    }

    if (cfg.platforms        !== undefined) entry.platforms        = cfg.platforms;
    if (cfg.accountOverrides !== undefined) entry.accountOverrides = cfg.accountOverrides;

    current.clients[id] = entry;
  }

  writeSettings(current);
  res.json({ ok: true });
});

// ─── API: authenticate a client link (public) ─────────────────────────────────
app.post('/api/auth/:clientId', (req, res) => {
  const { clientId }  = req.params;
  const { password }  = req.body;
  const settings      = readSettings();
  const cfg           = settings.clients[clientId];

  if (!cfg?.password) return res.json({ valid: true });
  res.json({ valid: hashPassword(password) === cfg.password });
});

// ─── API: client config (public — used by /r/:clientId pages) ─────────────────
app.get('/api/client-config/:clientId', (req, res) => {
  const { clientId } = req.params;
  const cfg          = readSettings().clients[clientId] || {};
  res.json({
    hasPassword:      !!cfg.password,
    platforms:        cfg.platforms        || null,
    accountOverrides: cfg.accountOverrides || {},
  });
});

// ─── Reporting Ninja proxy ────────────────────────────────────────────────────
function getHeaders() {
  return { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
}

async function rnPost(endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST', headers: getHeaders(), body: JSON.stringify(body),
  });
  return res.json();
}

app.post('/api/connections', async (req, res) => {
  try { res.json(await rnPost('/connections', req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/query', async (req, res) => {
  try { res.json(await rnPost('/query', req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/overview', requireAuth, async (req, res) => {
  try {
    const [meta, google, pinterestAds, pinterestOrganic] = await Promise.all([
      rnPost('/connections', { integration_id: 'facebook_ads' }),
      rnPost('/connections', { integration_id: 'google_ads' }),
      rnPost('/connections', { integration_id: 'pinterest_ads' }),
      rnPost('/connections', { integration_id: 'pinterest_organic' }),
    ]);
    res.json({ meta, google, pinterestAds, pinterestOrganic });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Rapportage server draait op http://localhost:${PORT}`));
