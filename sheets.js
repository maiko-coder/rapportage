// ─── Google Sheets integratie ──────────────────────────────────────────────────
// Leest data uit klant-sheets via een gedeeld service-account (geen OAuth per klant nodig).
// De klant deelt zijn Google Sheet met het e-mailadres van dit service-account
// (als "Kijker"), en de tool haalt daarna live de waarden op.
//
// Config: twee manieren om het service-account te configureren (env vars):
//   1) GOOGLE_SHEETS_CLIENT_EMAIL + GOOGLE_SHEETS_PRIVATE_KEY (zelfde patroon
//      als in het Google-Ads-project — meestal het handigst omdat dat account
//      vaak al hergebruikt kan worden).
//   2) GOOGLE_SERVICE_ACCOUNT_JSON — de volledige service-account JSON-sleutel
//      als één regel, als alternatief.
// Nooit in git committen — zet dit alleen in .env (lokaal) of je hosting
// provider's secret/env instellingen (bv. Vercel project settings).

const { google } = require('googleapis');

let authClient          = null;
let sheetsClient        = null;
let serviceAccountEmail = null;
let credentialsError    = null;

function loadCredentials() {
  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const key   = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (email && key) {
    return { client_email: email, private_key: key.replace(/\\n/g, '\n') };
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    credentialsError = 'Google Sheets service-account is niet geconfigureerd op de server (GOOGLE_SHEETS_CLIENT_EMAIL/GOOGLE_SHEETS_PRIVATE_KEY of GOOGLE_SERVICE_ACCOUNT_JSON ontbreken).';
    return null;
  }
  try {
    const creds = JSON.parse(raw);
    return { client_email: creds.client_email, private_key: creds.private_key };
  } catch (e) {
    credentialsError = 'GOOGLE_SERVICE_ACCOUNT_JSON bevat geen geldige JSON: ' + e.message;
    return null;
  }
}

function getAuth() {
  if (authClient) return authClient;
  const creds = loadCredentials();
  if (!creds) return null;
  serviceAccountEmail = creds.client_email || null;
  authClient = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return authClient;
}

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const auth = getAuth();
  if (!auth) return null;
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function isConfigured() {
  return !!getSheetsClient();
}

function getServiceAccountEmail() {
  getAuth();
  return serviceAccountEmail;
}

function getConfigError() {
  return credentialsError;
}

// Haalt het sheet-ID uit een volledige Google Sheets-URL, of accepteert een kaal ID.
function extractSheetId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

function isPermissionError(err) {
  const status = err?.code || err?.response?.status;
  return status === 403 || status === 404 || /permission|not found/i.test(err?.message || '');
}

async function fetchSpreadsheetMeta(sheetId) {
  const client = getSheetsClient();
  if (!client) throw new Error(credentialsError || 'Google service-account is niet geconfigureerd op de server.');
  const res = await client.spreadsheets.get({ spreadsheetId: sheetId });
  return {
    title: res.data.properties?.title || 'Naamloos sheet',
    tabs: (res.data.sheets || []).map(s => s.properties?.title).filter(Boolean),
  };
}

async function fetchSheetValues(sheetId, tabName) {
  const client = getSheetsClient();
  if (!client) throw new Error(credentialsError || 'Google service-account is niet geconfigureerd op de server.');
  const range = tabName ? `'${tabName}'` : undefined;
  const res = await client.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: range || 'A1:ZZ2000',
  });
  return res.data.values || [];
}

module.exports = {
  isConfigured,
  getServiceAccountEmail,
  getConfigError,
  extractSheetId,
  isPermissionError,
  fetchSpreadsheetMeta,
  fetchSheetValues,
};
