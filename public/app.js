// Chartinstanties bijhouden voor hergebruik
const charts = {};

const PERIOD_LABELS = {
  lastmonth: 'Vorige maand',
  thismonth: 'Deze maand',
  last7days: 'Laatste 7 dagen',
  last30days: 'Laatste 30 dagen',
  last90days: 'Laatste 90 dagen',
};

// Klantdropdown vullen vanuit clients.js
(function initClients() {
  const sel = document.getElementById('client-select');
  (CLIENTS || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
})();

function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  document.getElementById('error-banner').classList.add('hidden');
}

function setLoading(on) {
  document.getElementById('loading').classList.toggle('hidden', !on);
}

function show(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hide(id) {
  document.getElementById(id).classList.add('hidden');
}

function fmt(n, type = 'number') {
  if (n == null || n === '') return '—';
  const num = parseFloat(n);
  if (isNaN(num)) return n;
  if (type === 'currency') return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(num);
  if (type === 'pct') return (num * 100).toFixed(2) + '%';
  return new Intl.NumberFormat('nl-NL').format(Math.round(num));
}

// micros → euro (Google Ads)
function micros(v) { return v != null ? parseFloat(v) / 1e6 : null; }

async function apiPost(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.status === 'error') throw new Error(data.message || 'API fout');
  if (data.error) throw new Error(data.error);
  return data;
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function makeLineChart(canvasId, labels, datasets) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext('2d');
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { font: { size: 11 } }, grid: { color: '#f0f0f0' } },
        y1: { position: 'right', ticks: { font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function fillTable(tableId, columns, rows) {
  const table = document.getElementById(tableId);
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '<tr>' + columns.map(c => `<th class="${c.cls || ''}">${c.label}</th>`).join('') + '</tr>';
  tbody.innerHTML = rows.map(row =>
    '<tr>' + columns.map(c => `<td class="${c.cls || ''}">${c.render ? c.render(row) : (row[c.key] ?? '—')}</td>`).join('') + '</tr>'
  ).join('');
}

function buildKPIs(metaRows, googleRows, pinterestRows) {
  let metaSpend = 0, metaClicks = 0, metaImpressions = 0;
  let googleSpend = 0, googleClicks = 0, googleImpressions = 0;
  let pintSpend = 0, pintClicks = 0, pintImpressions = 0;

  (metaRows || []).forEach(r => {
    metaSpend += parseFloat(r.spend || 0);
    metaClicks += parseFloat(r.clicks || 0);
    metaImpressions += parseFloat(r.impressions || 0);
  });
  (googleRows || []).forEach(r => {
    googleSpend += micros(r['metrics.cost_micros']) || 0;
    googleClicks += parseFloat(r['metrics.clicks'] || 0);
    googleImpressions += parseFloat(r['metrics.impressions'] || 0);
  });
  (pinterestRows || []).forEach(r => {
    pintSpend += parseFloat(r.SPEND_IN_DOLLAR || 0);
    pintClicks += parseFloat(r.OUTBOUND_CLICK || 0);
    pintImpressions += parseFloat(r.IMPRESSION || 0);
  });

  const totalSpend = metaSpend + googleSpend + pintSpend;
  const totalClicks = metaClicks + googleClicks + pintClicks;
  const totalImpressions = metaImpressions + googleImpressions + pintImpressions;
  const avgCPC = totalClicks > 0 ? totalSpend / totalClicks : 0;

  return [
    { label: 'Totaal uitgaven', value: fmt(totalSpend, 'currency'), sub: 'Alle platformen' },
    { label: 'Totaal clicks', value: fmt(totalClicks), sub: 'Alle platformen' },
    { label: 'Totaal impressies', value: fmt(totalImpressions), sub: 'Alle platformen' },
    { label: 'Gem. CPC', value: totalClicks > 0 ? fmt(avgCPC, 'currency') : '—', sub: 'Kosten per klik' },
    { label: 'Meta uitgaven', value: fmt(metaSpend, 'currency'), sub: 'facebook_ads' },
    { label: 'Google uitgaven', value: fmt(googleSpend, 'currency'), sub: 'google_ads' },
    { label: 'Pinterest uitgaven', value: fmt(pintSpend, 'currency'), sub: 'pinterest_ads' },
  ];
}

// ---- META ----
async function loadMeta(client, dateRange) {
  const body = {
    integration_id: 'facebook_ads',
    connection_key: client.meta.connection_key,
    account_id: client.meta.account_id,
    fields: ['day', 'campaign_name', 'impressions', 'clicks', 'spend', 'cpm', 'cpc'],
    date_range: dateRange,
    limit: 500,
  };
  const data = await apiPost('/api/query', body);
  return data.data?.rows || [];
}

function renderMeta(rows) {
  if (!rows.length) { hide('meta-section'); return; }
  show('meta-section');

  // Aggregeer per dag voor grafiek
  const byDay = {};
  rows.forEach(r => {
    const d = r.day || '';
    if (!byDay[d]) byDay[d] = { spend: 0, clicks: 0, impressions: 0 };
    byDay[d].spend += parseFloat(r.spend || 0);
    byDay[d].clicks += parseFloat(r.clicks || 0);
    byDay[d].impressions += parseFloat(r.impressions || 0);
  });
  const days = Object.keys(byDay).sort();

  makeLineChart('meta-spend-chart', days, [
    { label: 'Uitgaven (€)', data: days.map(d => byDay[d].spend.toFixed(2)), borderColor: '#1877f2', backgroundColor: '#1877f220', fill: true, tension: 0.3, yAxisID: 'y' },
  ]);
  makeLineChart('meta-engagement-chart', days, [
    { label: 'Clicks', data: days.map(d => byDay[d].clicks), borderColor: '#1877f2', tension: 0.3, yAxisID: 'y' },
    { label: 'Impressies', data: days.map(d => byDay[d].impressions), borderColor: '#93c5fd', tension: 0.3, yAxisID: 'y1' },
  ]);

  // Aggregeer per campagne voor tabel
  const byCampaign = {};
  rows.forEach(r => {
    const name = r.campaign_name || '(onbekend)';
    if (!byCampaign[name]) byCampaign[name] = { impressions: 0, clicks: 0, spend: 0 };
    byCampaign[name].impressions += parseFloat(r.impressions || 0);
    byCampaign[name].clicks += parseFloat(r.clicks || 0);
    byCampaign[name].spend += parseFloat(r.spend || 0);
  });
  const campRows = Object.entries(byCampaign)
    .map(([name, v]) => ({ name, ...v, ctr: v.impressions > 0 ? v.clicks / v.impressions : 0, cpc: v.clicks > 0 ? v.spend / v.clicks : 0 }))
    .sort((a, b) => b.spend - a.spend);

  fillTable('meta-table',
    [
      { key: 'name', label: 'Campagne' },
      { key: 'impressions', label: 'Impressies', cls: 'num', render: r => fmt(r.impressions) },
      { key: 'clicks', label: 'Clicks', cls: 'num', render: r => fmt(r.clicks) },
      { key: 'ctr', label: 'CTR', cls: 'num', render: r => (r.ctr * 100).toFixed(2) + '%' },
      { key: 'spend', label: 'Uitgaven', cls: 'num', render: r => fmt(r.spend, 'currency') },
      { key: 'cpc', label: 'CPC', cls: 'num', render: r => r.clicks > 0 ? fmt(r.cpc, 'currency') : '—' },
    ],
    campRows
  );
}

// ---- GOOGLE ADS ----
async function loadGoogle(client, dateRange) {
  const body = {
    integration_id: 'google_ads',
    connection_key: client.google.connection_key,
    account_id: client.google.account_id,
    data_view: client.google.data_view || 'campaign',
    fields: ['segments.date', 'campaign.name', 'metrics.impressions', 'metrics.clicks', 'metrics.cost_micros', 'metrics.ctr'],
    date_range: dateRange,
    limit: 500,
  };
  const data = await apiPost('/api/query', body);
  return data.data?.rows || [];
}

function renderGoogle(rows) {
  if (!rows.length) { hide('google-section'); return; }
  show('google-section');

  const byDay = {};
  rows.forEach(r => {
    const d = r['segments.date'] || '';
    if (!byDay[d]) byDay[d] = { cost: 0, clicks: 0, impressions: 0 };
    byDay[d].cost += micros(r['metrics.cost_micros']) || 0;
    byDay[d].clicks += parseFloat(r['metrics.clicks'] || 0);
    byDay[d].impressions += parseFloat(r['metrics.impressions'] || 0);
  });
  const days = Object.keys(byDay).sort();

  makeLineChart('google-spend-chart', days, [
    { label: 'Kosten (€)', data: days.map(d => byDay[d].cost.toFixed(2)), borderColor: '#4285f4', backgroundColor: '#4285f420', fill: true, tension: 0.3, yAxisID: 'y' },
  ]);
  makeLineChart('google-engagement-chart', days, [
    { label: 'Clicks', data: days.map(d => byDay[d].clicks), borderColor: '#4285f4', tension: 0.3, yAxisID: 'y' },
    { label: 'Impressies', data: days.map(d => byDay[d].impressions), borderColor: '#93c5fd', tension: 0.3, yAxisID: 'y1' },
  ]);

  const byCampaign = {};
  rows.forEach(r => {
    const name = r['campaign.name'] || '(onbekend)';
    if (!byCampaign[name]) byCampaign[name] = { impressions: 0, clicks: 0, cost: 0 };
    byCampaign[name].impressions += parseFloat(r['metrics.impressions'] || 0);
    byCampaign[name].clicks += parseFloat(r['metrics.clicks'] || 0);
    byCampaign[name].cost += micros(r['metrics.cost_micros']) || 0;
  });
  const campRows = Object.entries(byCampaign)
    .map(([name, v]) => ({ name, ...v, ctr: v.impressions > 0 ? v.clicks / v.impressions : 0, cpc: v.clicks > 0 ? v.cost / v.clicks : 0 }))
    .sort((a, b) => b.cost - a.cost);

  fillTable('google-table',
    [
      { key: 'name', label: 'Campagne' },
      { key: 'impressions', label: 'Impressies', cls: 'num', render: r => fmt(r.impressions) },
      { key: 'clicks', label: 'Clicks', cls: 'num', render: r => fmt(r.clicks) },
      { key: 'ctr', label: 'CTR', cls: 'num', render: r => (r.ctr * 100).toFixed(2) + '%' },
      { key: 'cost', label: 'Kosten', cls: 'num', render: r => fmt(r.cost, 'currency') },
      { key: 'cpc', label: 'CPC', cls: 'num', render: r => r.clicks > 0 ? fmt(r.cpc, 'currency') : '—' },
    ],
    campRows
  );
}

// ---- PINTEREST ----
async function loadPinterest(client, dateRange) {
  const body = {
    integration_id: 'pinterest_ads',
    connection_key: client.pinterest.connection_key,
    account_id: client.pinterest.account_id,
    fields: ['DATE', 'CAMPAIGN_NAME', 'IMPRESSION', 'OUTBOUND_CLICK', 'SPEND_IN_DOLLAR', 'CPM_IN_DOLLAR', 'CPC_IN_DOLLAR'],
    date_range: dateRange,
    limit: 500,
  };
  const data = await apiPost('/api/query', body);
  return data.data?.rows || [];
}

function renderPinterest(rows) {
  if (!rows.length) { hide('pinterest-section'); return; }
  show('pinterest-section');

  const byDay = {};
  rows.forEach(r => {
    const d = r.DATE || '';
    if (!byDay[d]) byDay[d] = { spend: 0, clicks: 0, impressions: 0 };
    byDay[d].spend += parseFloat(r.SPEND_IN_DOLLAR || 0);
    byDay[d].clicks += parseFloat(r.OUTBOUND_CLICK || 0);
    byDay[d].impressions += parseFloat(r.IMPRESSION || 0);
  });
  const days = Object.keys(byDay).sort();

  makeLineChart('pinterest-spend-chart', days, [
    { label: 'Uitgaven ($)', data: days.map(d => byDay[d].spend.toFixed(2)), borderColor: '#e60023', backgroundColor: '#e6002320', fill: true, tension: 0.3, yAxisID: 'y' },
  ]);
  makeLineChart('pinterest-engagement-chart', days, [
    { label: 'Clicks', data: days.map(d => byDay[d].clicks), borderColor: '#e60023', tension: 0.3, yAxisID: 'y' },
    { label: 'Impressies', data: days.map(d => byDay[d].impressions), borderColor: '#fca5a5', tension: 0.3, yAxisID: 'y1' },
  ]);

  const byCampaign = {};
  rows.forEach(r => {
    const name = r.CAMPAIGN_NAME || '(onbekend)';
    if (!byCampaign[name]) byCampaign[name] = { impressions: 0, clicks: 0, spend: 0 };
    byCampaign[name].impressions += parseFloat(r.IMPRESSION || 0);
    byCampaign[name].clicks += parseFloat(r.OUTBOUND_CLICK || 0);
    byCampaign[name].spend += parseFloat(r.SPEND_IN_DOLLAR || 0);
  });
  const campRows = Object.entries(byCampaign)
    .map(([name, v]) => ({ name, ...v, ctr: v.impressions > 0 ? v.clicks / v.impressions : 0 }))
    .sort((a, b) => b.spend - a.spend);

  fillTable('pinterest-table',
    [
      { key: 'name', label: 'Campagne' },
      { key: 'impressions', label: 'Impressies', cls: 'num', render: r => fmt(r.impressions) },
      { key: 'clicks', label: 'Clicks', cls: 'num', render: r => fmt(r.clicks) },
      { key: 'ctr', label: 'CTR', cls: 'num', render: r => (r.ctr * 100).toFixed(2) + '%' },
      { key: 'spend', label: 'Uitgaven', cls: 'num', render: r => fmt(r.spend, 'currency') },
    ],
    campRows
  );
}

// ---- MAIN LOAD ----
async function loadReport() {
  clearError();
  const clientId = document.getElementById('client-select').value;
  const period = document.getElementById('period-select').value;

  if (!clientId) { showError('Selecteer een klant.'); return; }

  const client = CLIENTS.find(c => c.id === clientId);
  if (!client) { showError('Klant niet gevonden.'); return; }

  document.getElementById('period-label').textContent = PERIOD_LABELS[period] || period;
  document.getElementById('setup-notice').classList.add('hidden');

  hide('kpi-section');
  hide('meta-section');
  hide('google-section');
  hide('pinterest-section');
  setLoading(true);

  const dateRange = { preset: period };

  try {
    const results = await Promise.allSettled([
      client.meta ? loadMeta(client, dateRange) : Promise.resolve([]),
      client.google ? loadGoogle(client, dateRange) : Promise.resolve([]),
      client.pinterest ? loadPinterest(client, dateRange) : Promise.resolve([]),
    ]);

    const metaRows = results[0].status === 'fulfilled' ? results[0].value : [];
    const googleRows = results[1].status === 'fulfilled' ? results[1].value : [];
    const pintRows = results[2].status === 'fulfilled' ? results[2].value : [];

    const errors = [];
    if (results[0].status === 'rejected') errors.push('Meta: ' + results[0].reason?.message);
    if (results[1].status === 'rejected') errors.push('Google: ' + results[1].reason?.message);
    if (results[2].status === 'rejected') errors.push('Pinterest: ' + results[2].reason?.message);
    if (errors.length) showError('Sommige platforms konden niet geladen worden: ' + errors.join(' | '));

    // KPIs
    const kpis = buildKPIs(metaRows, googleRows, pintRows);
    const grid = document.getElementById('kpi-grid');
    grid.innerHTML = kpis.map(k => `
      <div class="kpi-card">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    `).join('');
    show('kpi-section');

    renderMeta(metaRows);
    renderGoogle(googleRows);
    renderPinterest(pintRows);

  } catch (err) {
    showError('Fout bij laden: ' + err.message);
  } finally {
    setLoading(false);
  }
}
