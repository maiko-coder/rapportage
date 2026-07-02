const express  = require('express');
const fetch    = require('node-fetch');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const app      = express();
const PORT     = 3000;
const API_KEY  = 'x8mgquMubZtKRsmOQyaW';
const API_BASE = 'https://api.reportingninja.com/v1';

// ─── Settings store ───────────────────────────────────────────────────────────
const DATA_DIR      = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ clients: {} }, null, 2));
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return { clients: {} }; }
}

function writeSettings(data) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + ':woeler-rapportage').digest('hex');
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Client view (shareable link) ────────────────────────────────────────────
app.get('/r/:clientId', (req, res) => {
  const clientId = req.params.clientId.replace(/[^a-z0-9\-]/gi, '');
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  const injected = html.replace(
    '</head>',
    `<script>window.CLIENT_MODE="${clientId}";</script>\n</head>`
  );
  res.send(injected);
});

// ─── Settings page ────────────────────────────────────────────────────────────
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/settings.html'));
});

// ─── API: get settings (passwords masked) ────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const settings = readSettings();
  const safe = { clients: {} };
  for (const [id, cfg] of Object.entries(settings.clients || {})) {
    safe.clients[id] = { ...cfg, password: cfg.password ? '••••••••' : '' };
  }
  res.json(safe);
});

// ─── API: save settings ───────────────────────────────────────────────────────
app.post('/api/settings', (req, res) => {
  const incoming = req.body;
  const current  = readSettings();

  for (const [id, cfg] of Object.entries(incoming.clients || {})) {
    const existing = current.clients[id] || {};
    const entry    = { ...existing };

    // Password: only hash & store if a real new value was sent
    if (cfg.password && cfg.password !== '••••••••') {
      entry.password = hashPassword(cfg.password);
    } else if (cfg.password === '') {
      entry.password = '';   // explicit reset / remove password
    }
    // (undefined / masked = keep existing)

    if (cfg.platforms        !== undefined) entry.platforms        = cfg.platforms;
    if (cfg.accountOverrides !== undefined) entry.accountOverrides = cfg.accountOverrides;

    current.clients[id] = entry;
  }

  writeSettings(current);
  res.json({ ok: true });
});

// ─── API: authenticate a client link ─────────────────────────────────────────
app.post('/api/auth/:clientId', (req, res) => {
  const { clientId }  = req.params;
  const { password }  = req.body;
  const settings      = readSettings();
  const cfg           = settings.clients[clientId];

  if (!cfg?.password) return res.json({ valid: true }); // no password set
  res.json({ valid: hashPassword(password) === cfg.password });
});

// ─── API: client config (used by app.js on load) ─────────────────────────────
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

app.get('/api/overview', async (req, res) => {
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
