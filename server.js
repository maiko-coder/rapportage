require('dotenv').config();

const express  = require('express');
const fetch    = require('node-fetch');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const session  = require('express-session');
const sheetsApi = require('./sheets');
const promotionApi = require('./promotion');

const app      = express();
const PORT     = 3000;
const API_KEY  = 'x8mgquMubZtKRsmOQyaW';
const API_BASE = 'https://api.reportingninja.com/v1';

// ─── Auth DB (ook gebruikt voor klantinstellingen-opslag) ────────────────────
const authDb = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
}) : null;

// ─── Settings store ───────────────────────────────────────────────────────────
// Op Vercel is het lokale bestandssysteem (/tmp) niet blijvend tussen requests —
// elke serverless-invocatie kan een andere instantie raken. Daarom slaan we
// klantinstellingen op in Postgres (dezelfde DB als de login-tabel) zodra die
// beschikbaar is. Zonder DATABASE_URL (puur lokale dev zonder DB) valt dit
// terug op een lokaal JSON-bestand.
const DATA_DIR      = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const settingsTableReady = authDb
  ? authDb.query(`
      CREATE TABLE IF NOT EXISTS rapportage_client_settings (
        client_id  TEXT PRIMARY KEY,
        data       JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `).catch(e => console.error('Kon rapportage_client_settings niet aanmaken:', e.message))
  : Promise.resolve();

if (!authDb) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SETTINGS_FILE)) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ clients: {} }, null, 2));
    }
  } catch (e) {
    console.error('Settings init error (non-fatal):', e.message);
  }
}

async function readSettings() {
  if (authDb) {
    await settingsTableReady;
    try {
      const { rows } = await authDb.query('SELECT client_id, data FROM rapportage_client_settings');
      const clients = {};
      for (const row of rows) clients[row.client_id] = row.data;
      return { clients };
    } catch (e) {
      console.error('readSettings DB error:', e.message);
      return { clients: {} };
    }
  }
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return { clients: {} }; }
}

async function writeSettings(data) {
  if (authDb) {
    await settingsTableReady;
    try {
      const entries = Object.entries(data.clients || {});
      for (const [clientId, cfg] of entries) {
        await authDb.query(
          `INSERT INTO rapportage_client_settings (client_id, data, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (client_id) DO UPDATE SET data = $2::jsonb, updated_at = now()`,
          [clientId, JSON.stringify(cfg)]
        );
      }
    } catch (e) {
      console.error('writeSettings DB error:', e.message);
    }
    return;
  }
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('writeSettings error:', e.message); }
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + ':woeler-rapportage').digest('hex');
}

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
app.get('/api/settings', requireAuth, async (req, res) => {
  const settings = await readSettings();
  const safe = { clients: {} };
  for (const [id, cfg] of Object.entries(settings.clients || {})) {
    safe.clients[id] = { ...cfg, password: cfg.password ? '••••••••' : '' };
  }
  res.json(safe);
});

// ─── API: save settings ───────────────────────────────────────────────────────
app.post('/api/settings', requireAuth, async (req, res) => {
  const incoming = req.body;
  const current  = await readSettings();

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
    if (cfg.website          !== undefined) entry.website          = cfg.website;

    current.clients[id] = entry;
  }

  await writeSettings(current);
  res.json({ ok: true });
});

// ─── API: authenticate a client link (public) ─────────────────────────────────
app.post('/api/auth/:clientId', async (req, res) => {
  const { clientId }  = req.params;
  const { password }  = req.body;
  const settings      = await readSettings();
  const cfg           = settings.clients[clientId];

  if (!cfg?.password) return res.json({ valid: true });
  res.json({ valid: hashPassword(password) === cfg.password });
});

// ─── API: client config (public — used by /r/:clientId pages) ─────────────────
app.get('/api/client-config/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const cfg          = (await readSettings()).clients[clientId] || {};
  res.json({
    hasPassword:      !!cfg.password,
    platforms:        cfg.platforms        || null,
    accountOverrides: cfg.accountOverrides || {},
    reportLayout:     cfg.reportLayout     || null,
    sheets:           (cfg.sheets || []).map(s => ({ id: s.id, label: s.label })),
    promotions:       cfg.promotions       || {},
  });
});

// ─── API: save report layout (marketeer-only — drag-and-drop widget config) ──
app.post('/api/client-config/:clientId/layout', requireAuth, async (req, res) => {
  const clientId     = req.params.clientId.replace(/[^a-z0-9\-]/gi, '');
  const { reportLayout } = req.body;
  if (!reportLayout || typeof reportLayout !== 'object') {
    return res.status(400).json({ error: 'reportLayout ontbreekt of is ongeldig.' });
  }
  const current = await readSettings();
  current.clients[clientId] = { ...(current.clients[clientId] || {}), reportLayout };
  await writeSettings(current);
  res.json({ ok: true });
});

// ─── API: resolve & test a Google Sheet link (marketer-only) ─────────────────
app.post('/api/sheets/resolve', requireAuth, async (req, res) => {
  const { url } = req.body || {};
  const sheetId = sheetsApi.extractSheetId(url || '');
  if (!sheetId) {
    return res.status(400).json({ error: 'Kon geen geldige Google Sheets-link of ID herkennen.' });
  }
  try {
    const meta = await sheetsApi.fetchSpreadsheetMeta(sheetId);
    res.json({ ok: true, sheetId, title: meta.title, tabs: meta.tabs });
  } catch (err) {
    const email  = sheetsApi.getServiceAccountEmail();
    const denied = sheetsApi.isPermissionError(err);
    res.status(denied ? 403 : 500).json({
      error: denied
        ? `Geen toegang tot dit sheet. Voeg ${email || 'het service-account'} toe als Kijker (Delen-knop in Google Sheets).`
        : (err.message || 'Kon sheet niet ophalen.'),
      serviceAccountEmail: email,
    });
  }
});

// ─── API: save linked sheets for a client (marketer-only) ────────────────────
app.post('/api/client-config/:clientId/sheets', requireAuth, async (req, res) => {
  const clientId = req.params.clientId.replace(/[^a-z0-9\-]/gi, '');
  const { sheets } = req.body;
  if (!Array.isArray(sheets)) {
    return res.status(400).json({ error: 'sheets moet een array zijn.' });
  }
  const current = await readSettings();
  current.clients[clientId] = { ...(current.clients[clientId] || {}), sheets };
  await writeSettings(current);
  res.json({ ok: true });
});

// ─── API: live sheet data for a linked sheet (public — used by report widgets) ─
const sheetDataCache = new Map(); // `${sheetId}::${tabName}` -> { at, data }
const SHEET_CACHE_MS = 3 * 60 * 1000;

app.get('/api/client-config/:clientId/sheet-data/:linkId', async (req, res) => {
  const clientId = req.params.clientId.replace(/[^a-z0-9\-]/gi, '');
  const { linkId } = req.params;
  const cfg  = (await readSettings()).clients[clientId] || {};
  const link = (cfg.sheets || []).find(s => s.id === linkId);
  if (!link) return res.status(404).json({ error: 'Sheet-koppeling niet gevonden.' });

  const cacheKey = `${link.sheetId}::${link.tabName || ''}`;
  const cached   = sheetDataCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SHEET_CACHE_MS) {
    return res.json({ ok: true, ...cached.data });
  }
  try {
    const values         = await sheetsApi.fetchSheetValues(link.sheetId, link.tabName);
    const [headers, ...rows] = values;
    const data = { headers: headers || [], rows: rows || [] };
    sheetDataCache.set(cacheKey, { at: Date.now(), data });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Kon sheetdata niet ophalen.' });
  }
});

// ─── API: promotie voor ontbrekende kanalen aan/uit zetten (marketer-only) ───
const PROMO_PLATFORMS = ['meta', 'google', 'pinterest'];

app.post('/api/client-config/:clientId/promotion', requireAuth, async (req, res) => {
  const clientId = req.params.clientId.replace(/[^a-z0-9\-]/gi, '');
  const { platform, enabled, clientName } = req.body || {};
  if (!PROMO_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: 'Ongeldig platform.' });
  }

  const current    = await readSettings();
  const cfg        = current.clients[clientId] || {};
  const promotions = { ...(cfg.promotions || {}) };
  const existing   = promotions[platform] || {};

  if (enabled) {
    if (!cfg.website) {
      return res.status(400).json({ error: 'Vul eerst een website in bij deze klant voordat je promotie aanzet.' });
    }
    if (existing.headline) {
      promotions[platform] = { ...existing, enabled: true };
    } else {
      if (!promotionApi.isConfigured()) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY is niet geconfigureerd op de server.' });
      }
      try {
        const content = await promotionApi.generatePromoContent({
          clientName: clientName || clientId,
          website: cfg.website,
          platform,
        });
        promotions[platform] = { ...content, enabled: true, generatedAt: new Date().toISOString() };
      } catch (err) {
        return res.status(500).json({ error: err.message || 'Kon promotietekst niet genereren.' });
      }
    }
  } else {
    promotions[platform] = { ...existing, enabled: false };
  }

  current.clients[clientId] = { ...cfg, promotions };
  await writeSettings(current);
  res.json({ ok: true, promotion: promotions[platform] });
});

// ─── API: promotietekst opnieuw laten genereren door de AI (marketer-only) ───
app.post('/api/client-config/:clientId/promotion/regenerate', requireAuth, async (req, res) => {
  const clientId = req.params.clientId.replace(/[^a-z0-9\-]/gi, '');
  const { platform, clientName } = req.body || {};
  if (!PROMO_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: 'Ongeldig platform.' });
  }
  const current = await readSettings();
  const cfg     = current.clients[clientId] || {};
  if (!cfg.website) {
    return res.status(400).json({ error: 'Vul eerst een website in bij deze klant.' });
  }
  if (!promotionApi.isConfigured()) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is niet geconfigureerd op de server.' });
  }
  try {
    const content    = await promotionApi.generatePromoContent({
      clientName: clientName || clientId,
      website: cfg.website,
      platform,
    });
    const promotions = { ...(cfg.promotions || {}) };
    promotions[platform] = { ...content, enabled: true, generatedAt: new Date().toISOString() };
    current.clients[clientId] = { ...cfg, promotions };
    await writeSettings(current);
    res.json({ ok: true, promotion: promotions[platform] });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Kon promotietekst niet genereren.' });
  }
});

// ─── API: promotietekst handmatig aanpassen door de marketeer ────────────────
app.post('/api/client-config/:clientId/promotion/edit', requireAuth, async (req, res) => {
  const clientId = req.params.clientId.replace(/[^a-z0-9\-]/gi, '');
  const { platform, headline, subheadline, benefits, cta } = req.body || {};
  if (!PROMO_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: 'Ongeldig platform.' });
  }
  const current    = await readSettings();
  const cfg        = current.clients[clientId] || {};
  const promotions = { ...(cfg.promotions || {}) };
  const existing   = promotions[platform] || {};
  promotions[platform] = {
    ...existing,
    headline:     String(headline || existing.headline || ''),
    subheadline:  String(subheadline || ''),
    benefits:     Array.isArray(benefits) ? benefits.map(String).slice(0, 6) : (existing.benefits || []),
    cta:          String(cta || ''),
  };
  current.clients[clientId] = { ...cfg, promotions };
  await writeSettings(current);
  res.json({ ok: true, promotion: promotions[platform] });
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
