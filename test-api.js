/**
 * Snel test-script: roept Reporting Ninja API aan en toont connections.
 * Gebruik: node test-api.js
 * Of met een tijdelijke key: REPORTING_NINJA_API_KEY=xxx node test-api.js
 */
require('dotenv').config();
const fetch = require('node-fetch');

const KEY = process.env.REPORTING_NINJA_API_KEY;
const BASE = 'https://api.reportingninja.com/v1';

if (!KEY) {
  console.error('❌  Geen API-sleutel. Maak een .env aan met REPORTING_NINJA_API_KEY=xxx');
  console.error('    Of start met: REPORTING_NINJA_API_KEY=xxx node test-api.js');
  process.exit(1);
}

async function post(endpoint, body = {}) {
  const res = await fetch(BASE + endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  console.log('── Integrations ─────────────────────────────────');
  const intRes = await post('/integrations');
  if (intRes.status !== 'ok') {
    console.error('Fout:', intRes.message || JSON.stringify(intRes));
    return;
  }
  console.log('Beschikbare platformen:', intRes.data.integrations.map(i => i.id).join(', '));

  const platforms = ['facebook_ads', 'google_ads', 'pinterest_ads'];
  for (const p of platforms) {
    console.log(`\n── Connections: ${p} ──────────────────────────────`);
    const r = await post('/connections', { integration_id: p });
    if (r.status !== 'ok') {
      console.log('  Fout:', r.message || r.error_code);
      continue;
    }
    const conns = r.data?.connections || [];
    if (!conns.length) {
      console.log('  (geen verbonden accounts)');
    } else {
      conns.forEach(c => {
        console.log(`  Connectie: ${c.connection_name} [${c.status}]`);
        (c.accounts || []).forEach(a => console.log(`    → ${a.account_name} (id: ${a.account_id})`));
      });
    }
  }
}

main().catch(e => console.error('Onverwachte fout:', e.message));
