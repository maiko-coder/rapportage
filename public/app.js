// ─── State ───────────────────────────────────────────────────────────────────
const charts = {};
let currentClientId      = null;
let currentNoteKey       = null;
let currentClientSettings = null;  // settings from /api/client-config

// CLIENT_MODE: set by server when accessing /r/:clientId
const CLIENT_MODE = window.CLIENT_MODE || null;

// ─── Period State ─────────────────────────────────────────────────────────────
const PERIODS = [
  { value: 'last7days',   label: 'Laatste 7 dagen' },
  { value: 'last14days',  label: 'Laatste 14 dagen' },
  { value: 'last30days',  label: 'Laatste 30 dagen' },
  { value: 'last90days',  label: 'Laatste 90 dagen' },
  { value: 'thismonth',   label: 'Deze maand' },
  { value: 'lastmonth',   label: 'Vorige maand' },
  { value: 'thisquarter', label: 'Dit kwartaal' },
  { value: 'lastquarter', label: 'Vorig kwartaal' },
  { value: 'thisyear',    label: 'Dit jaar' },
  { value: 'lastyear',    label: 'Vorig jaar' },
];


let selectedPeriod     = 'last30days';
let customStartDate    = '';
let customEndDate      = '';
let periodDropdownOpen = false;
let customPickerOpen   = false;

function fmtDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function computePeriodDates(value) {
  const today     = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const y = today.getFullYear(), m = today.getMonth();
  switch (value) {
    case 'last7days':   { const s = new Date(yesterday); s.setDate(yesterday.getDate()-6);  return { start: fmtDateISO(s), end: fmtDateISO(yesterday), days: 7  }; }
    case 'last14days':  { const s = new Date(yesterday); s.setDate(yesterday.getDate()-13); return { start: fmtDateISO(s), end: fmtDateISO(yesterday), days: 14 }; }
    case 'last30days':  { const s = new Date(yesterday); s.setDate(yesterday.getDate()-29); return { start: fmtDateISO(s), end: fmtDateISO(yesterday), days: 30 }; }
    case 'last90days':  { const s = new Date(yesterday); s.setDate(yesterday.getDate()-89); return { start: fmtDateISO(s), end: fmtDateISO(yesterday), days: 90 }; }
    case 'thismonth':   { const s = new Date(y,m,1); return { start: fmtDateISO(s), end: fmtDateISO(yesterday), days: Math.ceil((yesterday-s)/86400000)+1 }; }
    case 'lastmonth':   { const s = new Date(y,m-1,1), e = new Date(y,m,0); return { start: fmtDateISO(s), end: fmtDateISO(e), days: e.getDate() }; }
    case 'thisquarter': { const qs=Math.floor(m/3)*3, s=new Date(y,qs,1); return { start: fmtDateISO(s), end: fmtDateISO(yesterday), days: Math.ceil((yesterday-s)/86400000)+1 }; }
    case 'lastquarter': { const qs=Math.floor(m/3)*3-3, s=qs<0?new Date(y-1,9,1):new Date(y,qs,1), e=qs<0?new Date(y-1,12,0):new Date(y,qs+3,0); return { start: fmtDateISO(s), end: fmtDateISO(e), days: Math.ceil((e-s)/86400000)+1 }; }
    case 'thisyear':    { const s = new Date(y,0,1); return { start: fmtDateISO(s), end: fmtDateISO(yesterday), days: Math.ceil((yesterday-s)/86400000)+1 }; }
    case 'lastyear':    { const s = new Date(y-1,0,1), e = new Date(y-1,11,31); return { start: fmtDateISO(s), end: fmtDateISO(e), days: Math.ceil((e-s)/86400000)+1 }; }
    case 'custom': return (customStartDate && customEndDate) ? { start: customStartDate, end: customEndDate, days: Math.ceil((new Date(customEndDate)-new Date(customStartDate))/86400000)+1 } : null;
    default: return null;
  }
}

function getPeriodApiDateRange(value) {
  if (value === undefined) value = selectedPeriod;
  if (value === 'custom') return { preset: 'custom', start_date: customStartDate, end_date: customEndDate };
  const d = computePeriodDates(value);
  const r = d || computePeriodDates('last30days');
  return { preset: 'custom', start_date: r.start, end_date: r.end };
}

function fmtDisplayDate(iso) {
  if (!iso) return '';
  const [,m,d] = iso.split('-');
  return `${parseInt(d)} ${['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'][parseInt(m)-1]}`;
}

function updatePeriodUI() {
  const info    = computePeriodDates(selectedPeriod);
  const btnInfo = document.getElementById('period-btn-info');
  const label   = document.getElementById('period-btn-label');
  if (info && btnInfo) btnInfo.textContent = `${fmtDisplayDate(info.start)} – ${fmtDisplayDate(info.end)} · ${info.days} dagen`;
  const p = selectedPeriod === 'custom' ? { label: `${fmtDisplayDate(customStartDate)} – ${fmtDisplayDate(customEndDate)}` } : PERIODS.find(x => x.value === selectedPeriod);
  if (p && label) label.textContent = p.label;
  document.querySelectorAll('.period-opt').forEach(btn => {
    const active = btn.dataset.period === selectedPeriod;
    btn.classList.toggle('active', active);
    const check = btn.querySelector('.period-check');
    if (check) check.style.display = active ? 'inline-flex' : 'none';
  });
  const ct = document.getElementById('custom-toggle');
  if (ct) ct.classList.toggle('active', selectedPeriod === 'custom');
}

function initPeriodPicker() {
  const opts = document.getElementById('period-options');
  if (!opts) return;
  opts.innerHTML = PERIODS.map(p => `
    <button class="period-opt${selectedPeriod === p.value ? ' active' : ''}" data-period="${p.value}" type="button" onclick="selectPeriod('${p.value}')">
      ${p.label}
      <svg class="period-check" style="display:${selectedPeriod===p.value?'inline-flex':'none'}" width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <path fill-rule="evenodd" d="M12.207 3.793a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-3-3a1 1 0 011.414-1.414L5.5 9.086l5.293-5.293a1 1 0 011.414 0z"/>
      </svg>
    </button>`).join('');
  const d = computePeriodDates('last30days');
  const si = document.getElementById('custom-start'), ei = document.getElementById('custom-end');
  if (si) si.value = d.start;
  if (ei) ei.value = d.end;
  updatePeriodUI();
  document.addEventListener('click', e => { if (!document.getElementById('period-picker')?.contains(e.target)) closePeriodDropdown(); });
}

function togglePeriodDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('period-dropdown'), ch = document.getElementById('period-chevron');
  periodDropdownOpen = !periodDropdownOpen;
  dd.classList.toggle('hidden', !periodDropdownOpen);
  ch.classList.toggle('open', periodDropdownOpen);
}

function closePeriodDropdown() {
  const dd = document.getElementById('period-dropdown'), ch = document.getElementById('period-chevron');
  if (dd) dd.classList.add('hidden');
  if (ch) ch.classList.remove('open');
  periodDropdownOpen = false;
}

function selectPeriod(value) {
  selectedPeriod = value;
  closePeriodDropdown();
  updatePeriodUI();
  if (currentClientId) loadReport();
}

function toggleCustomPicker() {
  customPickerOpen = !customPickerOpen;
  const form = document.getElementById('custom-form'), ch = document.getElementById('custom-chevron');
  if (form) form.classList.toggle('hidden', !customPickerOpen);
  if (ch) ch.style.transform = customPickerOpen ? 'rotate(180deg)' : '';
}

function applyCustomPeriod() {
  const s = document.getElementById('custom-start')?.value, e = document.getElementById('custom-end')?.value;
  if (!s || !e) return;
  customStartDate = s; customEndDate = e; selectedPeriod = 'custom';
  closePeriodDropdown(); updatePeriodUI();
  if (currentClientId) loadReport();
}

// ─── Password gate (CLIENT_MODE) ──────────────────────────────────────────────
function showGate(clientName) {
  const gate = document.getElementById('password-gate');
  const nameEl = document.getElementById('gate-client-name');
  if (nameEl) nameEl.textContent = clientName || '';
  gate.classList.remove('hidden');
}

function hideGate() {
  document.getElementById('password-gate').classList.add('hidden');
}

async function submitGate() {
  const pw  = document.getElementById('gate-pw').value;
  const err = document.getElementById('gate-error');
  err.classList.add('hidden');
  if (!pw) return;

  try {
    const r = await fetch(`/api/auth/${CLIENT_MODE}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const data = await r.json();
    if (data.valid) {
      sessionStorage.setItem(`auth_${CLIENT_MODE}`, '1');
      hideGate();
      loadReport();
    } else {
      err.classList.remove('hidden');
      document.getElementById('gate-pw').value = '';
      document.getElementById('gate-pw').focus();
    }
  } catch {
    err.textContent = 'Verbindingsfout. Probeer opnieuw.';
    err.classList.remove('hidden');
  }
}

// ─── Client settings & sidebar ───────────────────────────────────────────────
async function fetchClientConfig(clientId) {
  try {
    const r = await fetch(`/api/client-config/${clientId}`);
    return await r.json();
  } catch { return null; }
}

function applyAccountOverrides(client, overrides) {
  if (!overrides || !Object.keys(overrides).length) return client;
  const c = JSON.parse(JSON.stringify(client));
  if (overrides.meta      && c.meta)      c.meta.account_id      = overrides.meta;
  if (overrides.google    && c.google)    c.google.account_id    = overrides.google;
  if (overrides.pinterest && c.pinterest) c.pinterest.account_id = overrides.pinterest;
  return c;
}

function updateSidebarForClient(client, platformSettings) {
  ['meta', 'google', 'pinterest'].forEach(platform => {
    const btn = document.querySelector(`.nav-item[data-platform="${platform}"]`);
    if (!btn) return;
    const hasAccount = !!client[platform];
    const enabled    = platformSettings ? platformSettings[platform] !== false : true;
    btn.style.display = (hasAccount && enabled) ? '' : 'none';
  });

  // Also show/hide the "Platformen" section header based on any visible platform
  const anyVisible = ['meta','google','pinterest'].some(p => {
    const btn = document.querySelector(`.nav-item[data-platform="${p}"]`);
    return btn && btn.style.display !== 'none';
  });
  const header = document.querySelector('.nav-section-platforms');
  if (header) header.style.display = anyVisible ? '' : 'none';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  initPeriodPicker();

  if (CLIENT_MODE) {
    // Hide client selector, settings link
    const clientCtrl = document.getElementById('client-ctrl');
    if (clientCtrl) clientCtrl.style.display = 'none';
    const settingsLink = document.getElementById('settings-nav-link');
    const settingsDivider = document.getElementById('settings-nav-divider');
    if (settingsLink) settingsLink.style.display = 'none';
    if (settingsDivider) settingsDivider.style.display = 'none';

    // Auto-load client
    const client = (CLIENTS || []).find(c => c.id === CLIENT_MODE);
    if (!client) {
      showError('Klant niet gevonden: ' + CLIENT_MODE);
      return;
    }

    fetchClientConfig(CLIENT_MODE).then(cfg => {
      currentClientSettings = cfg;
      if (cfg?.hasPassword && !sessionStorage.getItem(`auth_${CLIENT_MODE}`)) {
        showGate(client.name);
      } else {
        loadReport(CLIENT_MODE);
      }
    });
  } else {
    // Normal mode: populate client dropdown
    const sel = document.getElementById('client-select');
    (CLIENTS || []).forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { if (sel.value) loadReport(); });
  }
})();

// ─── Navigation ───────────────────────────────────────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  page.classList.remove('hidden');
  page.classList.add('active');
  if (btn) btn.classList.add('active');
  requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize()));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n, type) {
  if (n == null || n === '' || isNaN(parseFloat(n))) return '—';
  const v = parseFloat(n);
  if (type === 'eur')  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  if (type === 'eur2') return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  if (type === 'pct')  return v.toFixed(2) + '%';
  return new Intl.NumberFormat('nl-NL').format(Math.round(v));
}

function micros(v) { return v != null ? parseFloat(v) : 0; }

function monthKey(dateStr)  { return dateStr ? dateStr.substring(0, 7) : null; }
function monthLabel(yyyymm) {
  if (!yyyymm) return '—';
  const [y, m] = yyyymm.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' });
}

function showError(msg) { const el = document.getElementById('error-banner'); el.textContent = msg; el.classList.remove('hidden'); }
function clearError()   { document.getElementById('error-banner').classList.add('hidden'); }
function setLoading(on) { document.getElementById('loading').classList.toggle('hidden', !on); }
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

async function apiPost(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.status === 'error') throw new Error(d.message || 'API fout');
  if (d.error) throw new Error(d.error);
  return d;
}

// ─── Chart helpers ────────────────────────────────────────────────────────────
function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

const CHART_DEFAULTS = {
  responsive: true, maintainAspectRatio: true,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 12 } } },
  scales: {
    x:  { ticks: { maxTicksLimit: 10, font: { size: 11 } }, grid: { display: false } },
    y:  { ticks: { font: { size: 11 } }, grid: { color: '#f0f0f0' }, beginAtZero: true },
    y1: { position: 'right', ticks: { font: { size: 11 } }, grid: { display: false }, beginAtZero: true },
  },
};

function makeChart(id, labels, datasets, type = 'line') {
  destroyChart(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  charts[id] = new Chart(ctx, { type, data: { labels, datasets }, options: JSON.parse(JSON.stringify(CHART_DEFAULTS)) });
}

const ORANGE    = '#f97316';
const ORANGE_BG = '#f9731620';

function renderPlatformKPIs(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map(i => `<div class="pkpi-item"><div class="pkpi-label">${i.label}</div><div class="pkpi-value">${i.value}</div></div>`).join('');
}

function fillTable(tableId, cols, rows) {
  const table = document.getElementById(tableId);
  if (!table) return;
  table.querySelector('thead').innerHTML = '<tr>' + cols.map(c => `<th class="${c.cls||''}">${c.label}</th>`).join('') + '</tr>';
  table.querySelector('tbody').innerHTML = rows.map(r => '<tr>' + cols.map(c => `<td class="${c.cls||''}">${c.render ? c.render(r) : (r[c.key] ?? '—')}</td>`).join('') + '</tr>').join('');
}

// ─── Data queries ─────────────────────────────────────────────────────────────
async function loadMeta(client, dateRange) {
  if (!client.meta) return [];
  const d = await apiPost('/api/query', {
    integration_id: 'facebook_ads', connection_key: client.meta.connection_key,
    account_id: client.meta.account_id,
    settings: { attribution_window: 'ATTRIBUTION_MODEL_VIEW_CLICK###VIEW_ATTRIBUTION_WINDOW_1D###CLICK_ATTRIBUTION_WINDOW_7D' },
    fields: ['day', 'campaign_name', 'impressions', 'clicks', 'spend', 'cpc'],
    date_range: dateRange, limit: 500,
  });
  return d.data?.rows || [];
}

async function loadGoogle(client, dateRange) {
  if (!client.google) return [];
  const d = await apiPost('/api/query', {
    integration_id: 'google_ads', connection_key: client.google.connection_key,
    account_id: client.google.account_id, data_view: client.google.data_view || 'campaign',
    fields: ['segments.date', 'campaign.name', 'metrics.impressions', 'metrics.clicks', 'metrics.cost_micros'],
    date_range: dateRange, limit: 500,
  });
  return d.data?.rows || [];
}

async function loadPinterest(client, dateRange) {
  if (!client.pinterest) return [];
  const d = await apiPost('/api/query', {
    integration_id: 'pinterest_ads', connection_key: client.pinterest.connection_key,
    account_id: client.pinterest.account_id, data_view: client.pinterest.data_view || 'campaign',
    settings: { click_window: '30', view_window: '1', engagement_window: '30', conversion_report_time: 'TIME_OF_AD_ACTION' },
    fields: ['DAY', 'CAMPAIGN_NAME', 'IMPRESSION_1', 'OUTBOUND_CLICK_1', 'SPEND_IN_DOLLAR', 'ECPC_IN_DOLLAR'],
    date_range: dateRange, limit: 2000,
  });
  return d.data?.rows || [];
}

// Separate yearly Pinterest query: advertiser-level (1 row/day instead of per campaign),
// so a full year stays well within limits.
async function loadPinterestYearly(client, dateRange) {
  if (!client.pinterest) return [];
  const d = await apiPost('/api/query', {
    integration_id: 'pinterest_ads', connection_key: client.pinterest.connection_key,
    account_id: client.pinterest.account_id, data_view: 'advertiser',
    settings: { click_window: '30', view_window: '1', engagement_window: '30', conversion_report_time: 'TIME_OF_AD_ACTION' },
    fields: ['DAY', 'IMPRESSION_1', 'OUTBOUND_CLICK_1', 'SPEND_IN_DOLLAR'],
    date_range: dateRange, limit: 1000,
  });
  return d.data?.rows || [];
}

// ─── Render: Meta ─────────────────────────────────────────────────────────────
function renderMeta(rows) {
  if (!rows.length) { hide('meta-content'); return; }
  show('meta-content');
  const byDay = {};
  rows.forEach(r => { const d=r.day||''; if(!byDay[d]) byDay[d]={spend:0,clicks:0,impressions:0}; byDay[d].spend+=parseFloat(r.spend||0); byDay[d].clicks+=parseFloat(r.clicks||0); byDay[d].impressions+=parseFloat(r.impressions||0); });
  const days = Object.keys(byDay).sort();
  const totSpend=rows.reduce((s,r)=>s+parseFloat(r.spend||0),0), totClicks=rows.reduce((s,r)=>s+parseFloat(r.clicks||0),0), totImpr=rows.reduce((s,r)=>s+parseFloat(r.impressions||0),0);
  renderPlatformKPIs('meta-kpis', [
    { label:'Weergaven', value:fmt(totImpr) }, { label:'Clicks', value:fmt(totClicks) },
    { label:'CTR', value:fmt(totImpr>0?totClicks/totImpr*100:0,'pct') }, { label:'Uitgaven', value:fmt(totSpend,'eur') },
    { label:'CPC', value:fmt(totClicks>0?totSpend/totClicks:0,'eur2') }, { label:'CPM', value:fmt(totImpr>0?totSpend/totImpr*1000:0,'eur2') },
  ]);
  makeChart('meta-spend-chart', days, [{ label:'Uitgaven (€)', data:days.map(d=>byDay[d].spend.toFixed(2)), borderColor:ORANGE, backgroundColor:ORANGE_BG, fill:true, tension:0.3, yAxisID:'y' }]);
  makeChart('meta-engagement-chart', days, [
    { label:'Clicks', data:days.map(d=>byDay[d].clicks), borderColor:ORANGE, tension:0.3, yAxisID:'y' },
    { label:'Impressies', data:days.map(d=>byDay[d].impressions), borderColor:'#94a3b8', tension:0.3, yAxisID:'y1' },
  ]);
  const byCamp = {};
  rows.forEach(r => { const n=r.campaign_name||'(onbekend)'; if(!byCamp[n]) byCamp[n]={impressions:0,clicks:0,spend:0}; byCamp[n].impressions+=parseFloat(r.impressions||0); byCamp[n].clicks+=parseFloat(r.clicks||0); byCamp[n].spend+=parseFloat(r.spend||0); });
  fillTable('meta-table',
    [{ key:'name', label:'Campagne' }, { label:'Impressies',cls:'num',render:r=>fmt(r.impressions) }, { label:'Clicks',cls:'num',render:r=>fmt(r.clicks) }, { label:'CTR',cls:'num',render:r=>fmt(r.ctr,'pct') }, { label:'Uitgaven',cls:'num',render:r=>fmt(r.spend,'eur') }, { label:'CPC',cls:'num',render:r=>r.clicks>0?fmt(r.cpc,'eur2'):'—' }],
    Object.entries(byCamp).map(([name,v])=>({ name,...v, ctr:v.impressions>0?v.clicks/v.impressions*100:0, cpc:v.clicks>0?v.spend/v.clicks:0 })).sort((a,b)=>b.spend-a.spend)
  );
}

// ─── Render: Google ───────────────────────────────────────────────────────────
function renderGoogle(rows) {
  if (!rows.length) { hide('google-content'); return; }
  show('google-content');
  const byDay = {};
  rows.forEach(r => { const d=r['segments.date']||''; if(!byDay[d]) byDay[d]={cost:0,clicks:0,impressions:0}; byDay[d].cost+=micros(r['metrics.cost_micros']); byDay[d].clicks+=parseFloat(r['metrics.clicks']||0); byDay[d].impressions+=parseFloat(r['metrics.impressions']||0); });
  const days = Object.keys(byDay).sort();
  const totCost=rows.reduce((s,r)=>s+micros(r['metrics.cost_micros']),0), totClicks=rows.reduce((s,r)=>s+parseFloat(r['metrics.clicks']||0),0), totImpr=rows.reduce((s,r)=>s+parseFloat(r['metrics.impressions']||0),0);
  renderPlatformKPIs('google-kpis', [
    { label:'Weergaven', value:fmt(totImpr) }, { label:'Clicks', value:fmt(totClicks) },
    { label:'CTR', value:fmt(totImpr>0?totClicks/totImpr*100:0,'pct') }, { label:'Kosten', value:fmt(totCost,'eur') },
    { label:'CPC', value:fmt(totClicks>0?totCost/totClicks:0,'eur2') }, { label:'CPM', value:fmt(totImpr>0?totCost/totImpr*1000:0,'eur2') },
  ]);
  makeChart('google-spend-chart', days, [{ label:'Kosten (€)', data:days.map(d=>byDay[d].cost.toFixed(2)), borderColor:ORANGE, backgroundColor:ORANGE_BG, fill:true, tension:0.3, yAxisID:'y' }]);
  makeChart('google-engagement-chart', days, [
    { label:'Clicks', data:days.map(d=>byDay[d].clicks), borderColor:ORANGE, tension:0.3, yAxisID:'y' },
    { label:'Impressies', data:days.map(d=>byDay[d].impressions), borderColor:'#94a3b8', tension:0.3, yAxisID:'y1' },
  ]);
  const byCamp = {};
  rows.forEach(r => { const n=r['campaign.name']||'(onbekend)'; if(!byCamp[n]) byCamp[n]={impressions:0,clicks:0,cost:0}; byCamp[n].impressions+=parseFloat(r['metrics.impressions']||0); byCamp[n].clicks+=parseFloat(r['metrics.clicks']||0); byCamp[n].cost+=micros(r['metrics.cost_micros']); });
  fillTable('google-table',
    [{ key:'name', label:'Campagne' }, { label:'Impressies',cls:'num',render:r=>fmt(r.impressions) }, { label:'Clicks',cls:'num',render:r=>fmt(r.clicks) }, { label:'CTR',cls:'num',render:r=>fmt(r.ctr,'pct') }, { label:'Kosten',cls:'num',render:r=>fmt(r.cost,'eur') }, { label:'CPC',cls:'num',render:r=>r.clicks>0?fmt(r.cpc,'eur2'):'—' }],
    Object.entries(byCamp).map(([name,v])=>({ name,...v, ctr:v.impressions>0?v.clicks/v.impressions*100:0, cpc:v.clicks>0?v.cost/v.clicks:0 })).sort((a,b)=>b.cost-a.cost)
  );
}

// ─── Render: Pinterest ────────────────────────────────────────────────────────
function renderPinterest(rows) {
  if (!rows.length) { hide('pinterest-content'); return; }
  show('pinterest-content');
  const byDay = {};
  rows.forEach(r => { const d=r.DAY||''; if(!byDay[d]) byDay[d]={spend:0,clicks:0,impressions:0}; byDay[d].spend+=parseFloat(r.SPEND_IN_DOLLAR||0); byDay[d].clicks+=parseFloat(r.OUTBOUND_CLICK_1||0); byDay[d].impressions+=parseFloat(r.IMPRESSION_1||0); });
  const days = Object.keys(byDay).sort();
  const totSpend=rows.reduce((s,r)=>s+parseFloat(r.SPEND_IN_DOLLAR||0),0), totClicks=rows.reduce((s,r)=>s+parseFloat(r.OUTBOUND_CLICK_1||0),0), totImpr=rows.reduce((s,r)=>s+parseFloat(r.IMPRESSION_1||0),0);
  renderPlatformKPIs('pinterest-kpis', [
    { label:'Weergaven', value:fmt(totImpr) }, { label:'Clicks', value:fmt(totClicks) },
    { label:'CTR', value:fmt(totImpr>0?totClicks/totImpr*100:0,'pct') }, { label:'Uitgaven', value:fmt(totSpend,'eur') },
    { label:'CPC', value:fmt(totClicks>0?totSpend/totClicks:0,'eur2') },
  ]);
  makeChart('pinterest-spend-chart', days, [{ label:'Uitgaven (€)', data:days.map(d=>byDay[d].spend.toFixed(2)), borderColor:ORANGE, backgroundColor:ORANGE_BG, fill:true, tension:0.3, yAxisID:'y' }]);
  makeChart('pinterest-engagement-chart', days, [
    { label:'Clicks', data:days.map(d=>byDay[d].clicks), borderColor:ORANGE, tension:0.3, yAxisID:'y' },
    { label:'Impressies', data:days.map(d=>byDay[d].impressions), borderColor:'#94a3b8', tension:0.3, yAxisID:'y1' },
  ]);
  const byCamp = {};
  rows.forEach(r => { const n=r.CAMPAIGN_NAME||'(onbekend)'; if(!byCamp[n]) byCamp[n]={impressions:0,clicks:0,spend:0}; byCamp[n].impressions+=parseFloat(r.IMPRESSION_1||0); byCamp[n].clicks+=parseFloat(r.OUTBOUND_CLICK_1||0); byCamp[n].spend+=parseFloat(r.SPEND_IN_DOLLAR||0); });
  fillTable('pinterest-table',
    [{ key:'name', label:'Campagne' }, { label:'Impressies',cls:'num',render:r=>fmt(r.impressions) }, { label:'Clicks',cls:'num',render:r=>fmt(r.clicks) }, { label:'CTR',cls:'num',render:r=>fmt(r.ctr,'pct') }, { label:'Uitgaven',cls:'num',render:r=>fmt(r.spend,'eur') }],
    Object.entries(byCamp).map(([name,v])=>({ name,...v, ctr:v.impressions>0?v.clicks/v.impressions*100:0 })).sort((a,b)=>b.spend-a.spend)
  );
}

// ─── Render: Summary charts ───────────────────────────────────────────────────
function renderSummaryCharts(metaRows, googleRows, pintRows) {
  const allDays = new Set([...metaRows.map(r=>r.day||''), ...googleRows.map(r=>r['segments.date']||''), ...pintRows.map(r=>r.DAY||'')]);
  const days = [...allDays].filter(Boolean).sort();
  if (!days.length) return;
  const mSpend={}, gSpend={}, pSpend={}, mClicks={}, gClicks={}, pClicks={};
  metaRows.forEach(r=>{  const d=r.day||'';   mSpend[d]=(mSpend[d]||0)+parseFloat(r.spend||0);           mClicks[d]=(mClicks[d]||0)+parseFloat(r.clicks||0); });
  googleRows.forEach(r=>{ const d=r['segments.date']||''; gSpend[d]=(gSpend[d]||0)+micros(r['metrics.cost_micros']); gClicks[d]=(gClicks[d]||0)+parseFloat(r['metrics.clicks']||0); });
  pintRows.forEach(r=>{   const d=r.DAY||'';   pSpend[d]=(pSpend[d]||0)+parseFloat(r.SPEND_IN_DOLLAR||0);  pClicks[d]=(pClicks[d]||0)+parseFloat(r.OUTBOUND_CLICK_1||0); });
  show('summary-charts');
  makeChart('summary-spend-chart', days, [
    { label:'Meta',      data:days.map(d=>(mSpend[d]||0).toFixed(2)), borderColor:'#f97316', tension:0.3, fill:false, yAxisID:'y' },
    { label:'Google',    data:days.map(d=>(gSpend[d]||0).toFixed(2)), borderColor:'#3b82f6', tension:0.3, fill:false, yAxisID:'y' },
    { label:'Pinterest', data:days.map(d=>(pSpend[d]||0).toFixed(2)), borderColor:'#94a3b8', tension:0.3, fill:false, yAxisID:'y' },
  ]);
  makeChart('summary-clicks-chart', days, [
    { label:'Meta',      data:days.map(d=>mClicks[d]||0), borderColor:'#f97316', tension:0.3, fill:false, yAxisID:'y' },
    { label:'Google',    data:days.map(d=>gClicks[d]||0), borderColor:'#3b82f6', tension:0.3, fill:false, yAxisID:'y' },
    { label:'Pinterest', data:days.map(d=>pClicks[d]||0), borderColor:'#94a3b8', tension:0.3, fill:false, yAxisID:'y' },
  ]);
}

// ─── Yearly table ─────────────────────────────────────────────────────────────
function buildYearlyTable(metaRows, googleRows, pintRows) {
  const months = {};
  const ensure = mk => { if (!months[mk]) months[mk] = { meta:0, google:0, pinterest:0, clicks:0 }; };
  metaRows.forEach(r   => { const mk=monthKey(r.day);               if(!mk) return; ensure(mk); months[mk].meta      +=parseFloat(r.spend||0); months[mk].clicks+=parseFloat(r.clicks||0); });
  googleRows.forEach(r => { const mk=monthKey(r['segments.date']);  if(!mk) return; ensure(mk); months[mk].google    +=micros(r['metrics.cost_micros']); months[mk].clicks+=parseFloat(r['metrics.clicks']||0); });
  pintRows.forEach(r   => { const mk=monthKey(r.DAY);               if(!mk) return; ensure(mk); months[mk].pinterest +=parseFloat(r.SPEND_IN_DOLLAR||0); months[mk].clicks+=parseFloat(r.OUTBOUND_CLICK_1||0); });
  return Object.entries(months).sort(([a],[b])=>b.localeCompare(a)).map(([mk,v])=>({ mk,...v, total:v.meta+v.google+v.pinterest }));
}

let _yearlyRowCache = [];

function renderYearlyTable(rows) {
  const tbody = document.getElementById('yearly-tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(r => {
    const note = getNoteForMonth(r.mk), hasNote = !!note;
    let html = `<tr class="data-row${hasNote?' has-note':''}" data-mk="${r.mk}">
      <td>${monthLabel(r.mk)}</td>
      <td class="num">${r.meta>0?fmt(r.meta,'eur'):'—'}</td>
      <td class="num">${r.google>0?fmt(r.google,'eur'):'—'}</td>
      <td class="num">${r.pinterest>0?fmt(r.pinterest,'eur'):'—'}</td>
      <td class="num"><strong>${fmt(r.total,'eur')}</strong></td>
      <td class="num">${fmt(r.clicks)}</td>
      <td class="note-col"><button class="note-btn${hasNote?' has-note':''}" title="${hasNote?'Notitie bewerken':'Notitie toevoegen'}" onclick="openNoteModal('${r.mk}','${monthLabel(r.mk)}')">${hasNote?'📌':'+'}</button></td>
    </tr>`;
    if (hasNote) html += `<tr class="note-row"><td colspan="7"><span class="note-dot"></span><span class="note-text">${escapeHtml(note)}</span></td></tr>`;
    return html;
  }).join('');
}

function escapeHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── Notes ────────────────────────────────────────────────────────────────────
function notesStorageKey() { return `rapportage_notes_${currentClientId||'default'}`; }
function getAllNotes()      { try { return JSON.parse(localStorage.getItem(notesStorageKey())||'{}'); } catch { return {}; } }
function getNoteForMonth(mk) { return getAllNotes()[mk] || ''; }

function openNoteModal(mk, label) {
  currentNoteKey = mk;
  document.getElementById('note-modal-title').textContent = 'Notitie — ' + label;
  document.getElementById('note-input').value = getNoteForMonth(mk);
  document.getElementById('note-overlay').classList.remove('hidden');
  document.getElementById('note-input').focus();
}

function closeNoteModal() { document.getElementById('note-overlay').classList.add('hidden'); currentNoteKey = null; }

function saveNote() {
  if (!currentNoteKey) return;
  const notes = getAllNotes(), val = document.getElementById('note-input').value.trim();
  if (val) notes[currentNoteKey] = val; else delete notes[currentNoteKey];
  localStorage.setItem(notesStorageKey(), JSON.stringify(notes));
  closeNoteModal(); renderYearlyTable(_yearlyRowCache);
}

function deleteNote() {
  if (!currentNoteKey) return;
  const notes = getAllNotes(); delete notes[currentNoteKey];
  localStorage.setItem(notesStorageKey(), JSON.stringify(notes));
  closeNoteModal(); renderYearlyTable(_yearlyRowCache);
}

// ─── Main load ────────────────────────────────────────────────────────────────
async function loadReport(forcedClientId) {
  clearError();

  const clientId = forcedClientId || document.getElementById('client-select')?.value;
  if (!clientId) { showError('Selecteer een klant.'); return; }

  const baseClient = (CLIENTS || []).find(c => c.id === clientId);
  if (!baseClient) { showError('Klant niet gevonden.'); return; }

  // Fetch client config (settings / overrides) if not already loaded
  if (!currentClientSettings || currentClientId !== clientId) {
    currentClientSettings = await fetchClientConfig(clientId);
  }

  // Apply account overrides from settings
  const client = applyAccountOverrides(baseClient, currentClientSettings?.accountOverrides);

  currentClientId = clientId;

  document.getElementById('header-client').textContent = client.name;
  const sep = document.getElementById('header-client-sep');
  if (sep) sep.style.display = '';
  document.getElementById('setup-notice').classList.add('hidden');

  // Update sidebar based on client platforms + settings
  updateSidebarForClient(client, currentClientSettings?.platforms);

  hide('kpi-section'); hide('summary-charts'); hide('yearly-section');
  hide('meta-content'); hide('google-content'); hide('pinterest-content');
  setLoading(true);

  const dateRange     = getPeriodApiDateRange();
  const yd            = computePeriodDates('thisyear');
  const yearDateRange = yd ? { preset: 'custom', start_date: yd.start, end_date: yd.end } : dateRange;

  try {
    const [metaRes, googleRes, pintRes, metaYear, googleYear, pintYear] = await Promise.allSettled([
      loadMeta(client, dateRange), loadGoogle(client, dateRange), loadPinterest(client, dateRange),
      loadMeta(client, yearDateRange), loadGoogle(client, yearDateRange), loadPinterestYearly(client, yearDateRange),
    ]);

    const ok = r => r.status === 'fulfilled' ? r.value : [];
    const metaRows = ok(metaRes), googleRows = ok(googleRes), pintRows = ok(pintRes);

    const allResults = [metaRes, googleRes, pintRes, metaYear, googleYear, pintYear];
    const allLabels  = ['Meta', 'Google', 'Pinterest', 'Meta (jaar)', 'Google (jaar)', 'Pinterest (jaar)'];
    const errs = allResults.filter(r=>r.status==='rejected').map((r,i)=>allLabels[i]+': '+r.reason?.message);
    if (errs.length) showError(errs.join(' | '));

    const totalSpend  = metaRows.reduce((s,r)=>s+parseFloat(r.spend||0),0) + googleRows.reduce((s,r)=>s+micros(r['metrics.cost_micros']),0) + pintRows.reduce((s,r)=>s+parseFloat(r.SPEND_IN_DOLLAR||0),0);
    const totalClicks = metaRows.reduce((s,r)=>s+parseFloat(r.clicks||0),0) + googleRows.reduce((s,r)=>s+parseFloat(r['metrics.clicks']||0),0) + pintRows.reduce((s,r)=>s+parseFloat(r.OUTBOUND_CLICK_1||0),0);
    const totalImpr   = metaRows.reduce((s,r)=>s+parseFloat(r.impressions||0),0) + googleRows.reduce((s,r)=>s+parseFloat(r['metrics.impressions']||0),0) + pintRows.reduce((s,r)=>s+parseFloat(r.IMPRESSION_1||0),0);

    const periodInfo  = computePeriodDates(selectedPeriod);
    const periodLabel = selectedPeriod==='custom' ? `${fmtDisplayDate(customStartDate)} – ${fmtDisplayDate(customEndDate)}` : (PERIODS.find(p=>p.value===selectedPeriod)?.label||selectedPeriod);

    document.getElementById('kpi-heading').textContent = 'Samenvatting — ' + client.name;
    document.getElementById('kpi-sub').textContent     = 'Periode: ' + periodLabel + (periodInfo?` (${periodInfo.days} dagen)`:'')+' · alle gekoppelde platformen';

    document.getElementById('kpi-grid').innerHTML = [
      { label:'Totaal uitgaven',   value:fmt(totalSpend,'eur'),  sub:'Alle platformen' },
      { label:'Totaal clicks',     value:fmt(totalClicks),        sub:'Alle platformen' },
      { label:'Totaal impressies', value:fmt(totalImpr),          sub:'Alle platformen' },
      { label:'Gem. CPC',          value:totalClicks>0?fmt(totalSpend/totalClicks,'eur2'):'—', sub:'Kosten per klik' },
      { label:'Meta uitgaven',     value:fmt(metaRows.reduce((s,r)=>s+parseFloat(r.spend||0),0),'eur'), sub:'Meta Ads' },
      { label:'Google kosten',     value:fmt(googleRows.reduce((s,r)=>s+micros(r['metrics.cost_micros']),0),'eur'), sub:'Google Ads' },
      { label:'Pinterest uitg.',   value:fmt(pintRows.reduce((s,r)=>s+parseFloat(r.SPEND_IN_DOLLAR||0),0),'eur'), sub:'Pinterest Ads' },
    ].map(k=>`<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.sub}</div></div>`).join('');
    show('kpi-section');

    renderSummaryCharts(metaRows, googleRows, pintRows);
    renderMeta(metaRows);
    renderGoogle(googleRows);
    renderPinterest(pintRows);

    const yearlyRows = buildYearlyTable(ok(metaYear), ok(googleYear), ok(pintYear));
    _yearlyRowCache = yearlyRows;
    if (yearlyRows.length) { renderYearlyTable(yearlyRows); show('yearly-section'); }

  } catch (err) {
    showError('Fout: ' + err.message);
  } finally {
    setLoading(false);
  }
}
