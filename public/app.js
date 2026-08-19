// ─── State ───────────────────────────────────────────────────────────────────
const charts = {};
let currentClientId      = null;
let currentClient        = null;  // resolved client object (with overrides applied)
let currentNoteKey       = null;
let currentClientSettings = null;  // settings from /api/client-config
let currentReportCtx     = null;  // computed data context used by the widget engine
let currentLayout        = null;  // working (possibly unsaved) widget layout for this client
let editMode             = false;

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
  if (value === 'custom') return { preset: 'custom', start: customStartDate, end: customEndDate };
  const d = computePeriodDates(value);
  const r = d || computePeriodDates('last30days');
  return { preset: 'custom', start: r.start, end: r.end };
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
    // Hide client selector, settings link, edit-mode toggle
    const clientCtrl = document.getElementById('client-ctrl');
    if (clientCtrl) clientCtrl.style.display = 'none';
    const settingsLink = document.getElementById('settings-nav-link');
    const settingsDivider = document.getElementById('settings-nav-divider');
    if (settingsLink) settingsLink.style.display = 'none';
    if (settingsDivider) settingsDivider.style.display = 'none';
    const editBtn = document.getElementById('edit-mode-btn');
    if (editBtn) editBtn.style.display = 'none';

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

async function doLogout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

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

function fmtByUnit(v, unit) { return fmt(v, unit === 'count' ? undefined : unit); }

function micros(v) { return v != null ? parseFloat(v) : 0; }

function monthKey(dateStr)  { return dateStr ? dateStr.substring(0, 7) : null; }
function monthLabel(yyyymm) {
  if (!yyyymm) return '—';
  const [y, m] = yyyymm.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' });
}

function showError(msg) { const el = document.getElementById('error-banner'); el.textContent = msg; el.classList.remove('hidden'); }
function clearError()   { document.getElementById('error-banner').classList.add('hidden'); }

let toastTimer = null;
function showToast(msg) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}
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

const CHART_TEXT_MUTED = '#918e88';
const CHART_GRID = 'rgba(30, 25, 20, 0.06)';

const CHART_DEFAULTS = {
  responsive: true, maintainAspectRatio: true,
  interaction: { mode: 'index', intersect: false },
  elements: {
    line: { borderWidth: 2.25, tension: 0.35 },
    point: { radius: 0, hoverRadius: 4.5, hoverBorderWidth: 2, hoverBackgroundColor: '#fff' },
  },
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        usePointStyle: true, pointStyle: 'circle', boxWidth: 7, boxHeight: 7,
        font: { size: 11.5, family: "'Inter', sans-serif", weight: '500' },
        color: '#1c1b1a', padding: 18,
      },
    },
    tooltip: {
      backgroundColor: '#1c1b1a',
      titleFont: { size: 12, family: "'Inter', sans-serif", weight: '600' },
      bodyFont: { size: 12, family: "'Inter', sans-serif" },
      padding: 10,
      cornerRadius: 8,
      boxPadding: 4,
      usePointStyle: true,
      displayColors: true,
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
    },
  },
  scales: {
    x: {
      ticks: { maxTicksLimit: 10, font: { size: 11, family: "'Inter', sans-serif" }, color: CHART_TEXT_MUTED },
      grid: { display: false },
      border: { display: false },
    },
    y: {
      ticks: { font: { size: 11, family: "'Inter', sans-serif" }, color: CHART_TEXT_MUTED, padding: 6 },
      grid: { color: CHART_GRID },
      border: { display: false },
      beginAtZero: true,
    },
    y1: {
      position: 'right',
      ticks: { font: { size: 11, family: "'Inter', sans-serif" }, color: CHART_TEXT_MUTED, padding: 6 },
      grid: { display: false },
      border: { display: false },
      beginAtZero: true,
    },
  },
};

function makeChart(id, labels, datasets, type = 'line') {
  destroyChart(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  charts[id] = new Chart(ctx, { type, data: { labels, datasets }, options: JSON.parse(JSON.stringify(CHART_DEFAULTS)) });
}

const CHART_PALETTE = ['#f97316', '#6366f1', '#14b8a6', '#f43f5e', '#8b5cf6', '#0ea5e9', '#eab308', '#71717a'];

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
  const clipped = dateRange?.start && dateRange?.end
    ? clipToPinterestWindow(dateRange.start, dateRange.end)
    : dateRange;
  if (!clipped) return [];
  const d = await apiPost('/api/query', {
    integration_id: 'pinterest_ads', connection_key: client.pinterest.connection_key,
    account_id: client.pinterest.account_id, data_view: client.pinterest.data_view || 'campaign',
    settings: { click_window: '30', view_window: '1', engagement_window: '30', conversion_report_time: 'TIME_OF_AD_ACTION' },
    fields: ['DAY', 'CAMPAIGN_NAME', 'IMPRESSION_1', 'OUTBOUND_CLICK_1', 'SPEND_IN_DOLLAR', 'ECPC_IN_DOLLAR'],
    date_range: { preset: 'custom', ...clipped }, limit: 2000,
  });
  return d.data?.rows || [];
}

// Pinterest's own Ads API only allows querying data from at most 90 days before
// today, and rejects any request that reaches further back — regardless of range
// length. So clip the requested range to that rolling 90-day window before querying;
// anything older simply isn't available and is silently omitted (no error).
const PINTEREST_MAX_LOOKBACK_DAYS = 90;

function clipToPinterestWindow(start, end) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const floor = new Date(today); floor.setDate(floor.getDate() - (PINTEREST_MAX_LOOKBACK_DAYS - 1));
  const s = new Date(start), e = new Date(end);
  if (e < floor) return null; // entire range is older than the allowed window
  return { start: fmtDateISO(s < floor ? floor : s), end: fmtDateISO(e) };
}

// Separate yearly Pinterest query: account-level (1 row/day instead of per campaign),
// so a full year stays well within limits.
async function loadPinterestYearly(client, dateRange) {
  if (!client.pinterest) return [];
  const clipped = dateRange?.start && dateRange?.end
    ? clipToPinterestWindow(dateRange.start, dateRange.end)
    : dateRange;
  if (!clipped) return [];
  const d = await apiPost('/api/query', {
    integration_id: 'pinterest_ads', connection_key: client.pinterest.connection_key,
    account_id: client.pinterest.account_id, data_view: 'account',
    settings: { click_window: '30', view_window: '1', engagement_window: '30', conversion_report_time: 'TIME_OF_AD_ACTION' },
    fields: ['DAY', 'IMPRESSION_1', 'OUTBOUND_CLICK_1', 'SPEND_IN_DOLLAR'],
    date_range: { preset: 'custom', ...clipped }, limit: 1000,
  });
  return d.data?.rows || [];
}

// ─── Metrics catalog ──────────────────────────────────────────────────────────
// Normalizes the very different row shapes per platform into one {meta,google,pinterest,total}
// structure (both per-day and as totals over the whole period), so widgets can freely combine
// metrics from any platform without knowing about the underlying API field names.
const PLATFORM_META = {
  meta:      { label: 'Meta' },
  google:    { label: 'Google' },
  pinterest: { label: 'Pinterest' },
  total:     { label: 'Totaal' },
};

function emptyPlatformTotals() { return { spend: 0, clicks: 0, impressions: 0 }; }

function addMetaRow(t, r)      { t.spend += parseFloat(r.spend || 0); t.clicks += parseFloat(r.clicks || 0); t.impressions += parseFloat(r.impressions || 0); }
function addGoogleRow(t, r)    { t.spend += micros(r['metrics.cost_micros']); t.clicks += parseFloat(r['metrics.clicks'] || 0); t.impressions += parseFloat(r['metrics.impressions'] || 0); }
function addPinterestRow(t, r) { t.spend += parseFloat(r.SPEND_IN_DOLLAR || 0); t.clicks += parseFloat(r.OUTBOUND_CLICK_1 || 0); t.impressions += parseFloat(r.IMPRESSION_1 || 0); }

function aggregateTotals(metaRows, googleRows, pintRows) {
  const meta = emptyPlatformTotals(), google = emptyPlatformTotals(), pinterest = emptyPlatformTotals();
  metaRows.forEach(r => addMetaRow(meta, r));
  googleRows.forEach(r => addGoogleRow(google, r));
  pintRows.forEach(r => addPinterestRow(pinterest, r));
  const total = { spend: meta.spend + google.spend + pinterest.spend, clicks: meta.clicks + google.clicks + pinterest.clicks, impressions: meta.impressions + google.impressions + pinterest.impressions };
  return { meta, google, pinterest, total };
}

function buildDailySeries(metaRows, googleRows, pintRows) {
  const byDay = {};
  const ensure = d => byDay[d] || (byDay[d] = { meta: emptyPlatformTotals(), google: emptyPlatformTotals(), pinterest: emptyPlatformTotals() });
  metaRows.forEach(r   => { const d = r.day || '';               if (d) addMetaRow(ensure(d).meta, r); });
  googleRows.forEach(r => { const d = r['segments.date'] || '';  if (d) addGoogleRow(ensure(d).google, r); });
  pintRows.forEach(r   => { const d = r.DAY || '';                if (d) addPinterestRow(ensure(d).pinterest, r); });
  const days = Object.keys(byDay).sort();
  days.forEach(d => {
    const e = byDay[d];
    e.total = { spend: e.meta.spend + e.google.spend + e.pinterest.spend, clicks: e.meta.clicks + e.google.clicks + e.pinterest.clicks, impressions: e.meta.impressions + e.google.impressions + e.pinterest.impressions };
  });
  return { days, byDay };
}

function buildMetricCatalog() {
  const metrics = [];
  ['meta', 'google', 'pinterest', 'total'].forEach(p => {
    const pl = PLATFORM_META[p].label;
    metrics.push({ id: `${p}.spend`,       platform: p, shortLabel: 'Uitgaven',   label: `${pl} — Uitgaven`,   unit: 'eur',
      daily: d => d[p].spend, total: t => t[p].spend });
    metrics.push({ id: `${p}.clicks`,      platform: p, shortLabel: 'Clicks',     label: `${pl} — Clicks`,     unit: 'count',
      daily: d => d[p].clicks, total: t => t[p].clicks });
    metrics.push({ id: `${p}.impressions`, platform: p, shortLabel: 'Impressies', label: `${pl} — Impressies`, unit: 'count',
      daily: d => d[p].impressions, total: t => t[p].impressions });
    metrics.push({ id: `${p}.ctr`,         platform: p, shortLabel: 'CTR',        label: `${pl} — CTR`,        unit: 'pct',
      daily: d => d[p].impressions > 0 ? d[p].clicks / d[p].impressions * 100 : null,
      total: t => t[p].impressions > 0 ? t[p].clicks / t[p].impressions * 100 : 0 });
    metrics.push({ id: `${p}.cpc`,         platform: p, shortLabel: 'CPC',        label: `${pl} — CPC`,        unit: 'eur2',
      daily: d => d[p].clicks > 0 ? d[p].spend / d[p].clicks : null,
      total: t => t[p].clicks > 0 ? t[p].spend / t[p].clicks : 0 });
    metrics.push({ id: `${p}.cpm`,         platform: p, shortLabel: 'CPM',        label: `${pl} — CPM`,        unit: 'eur2',
      daily: d => d[p].impressions > 0 ? d[p].spend / d[p].impressions * 1000 : null,
      total: t => t[p].impressions > 0 ? t[p].spend / t[p].impressions * 1000 : 0 });
  });
  return metrics;
}
const METRICS = buildMetricCatalog();
function getMetric(id) { return METRICS.find(m => m.id === id); }

function unitFamily(unit) { return (unit === 'eur' || unit === 'eur2') ? 'money' : 'other'; }

// ─── Campaign breakdown (per platform, for table widgets) ────────────────────
function buildCampaignBreakdown(platform, rows) {
  const byCamp = {};
  const add = (name, impressions, clicks, spend) => {
    if (!byCamp[name]) byCamp[name] = { name, impressions: 0, clicks: 0, spend: 0 };
    byCamp[name].impressions += impressions; byCamp[name].clicks += clicks; byCamp[name].spend += spend;
  };
  if (platform === 'meta')      rows.forEach(r => add(r.campaign_name || '(onbekend)', parseFloat(r.impressions || 0), parseFloat(r.clicks || 0), parseFloat(r.spend || 0)));
  if (platform === 'google')    rows.forEach(r => add(r['campaign.name'] || '(onbekend)', parseFloat(r['metrics.impressions'] || 0), parseFloat(r['metrics.clicks'] || 0), micros(r['metrics.cost_micros'])));
  if (platform === 'pinterest') rows.forEach(r => add(r.CAMPAIGN_NAME || '(onbekend)', parseFloat(r.IMPRESSION_1 || 0), parseFloat(r.OUTBOUND_CLICK_1 || 0), parseFloat(r.SPEND_IN_DOLLAR || 0)));
  return Object.values(byCamp)
    .map(v => ({ ...v, ctr: v.impressions > 0 ? v.clicks / v.impressions * 100 : 0, cpc: v.clicks > 0 ? v.spend / v.clicks : 0 }))
    .sort((a, b) => b.spend - a.spend);
}

function tableColumnsFor(platform) {
  const spendLabel = platform === 'google' ? 'Kosten' : 'Uitgaven';
  return [
    { key: 'name', label: 'Campagne' },
    { label: 'Impressies', cls: 'num', render: r => fmt(r.impressions) },
    { label: 'Clicks',     cls: 'num', render: r => fmt(r.clicks) },
    { label: 'CTR',        cls: 'num', render: r => fmt(r.ctr, 'pct') },
    { label: spendLabel,   cls: 'num', render: r => fmt(r.spend, 'eur') },
    { label: 'CPC',        cls: 'num', render: r => r.clicks > 0 ? fmt(r.cpc, 'eur2') : '—' },
  ];
}

// ─── Yearly table (monthly totals + notes) ────────────────────────────────────
function buildYearlyTable(metaRows, googleRows, pintRows) {
  const months = {};
  const ensure = mk => { if (!months[mk]) months[mk] = { meta: 0, google: 0, pinterest: 0, clicks: 0 }; };
  metaRows.forEach(r   => { const mk = monthKey(r.day);              if (!mk) return; ensure(mk); months[mk].meta      += parseFloat(r.spend || 0); months[mk].clicks += parseFloat(r.clicks || 0); });
  googleRows.forEach(r => { const mk = monthKey(r['segments.date']); if (!mk) return; ensure(mk); months[mk].google    += micros(r['metrics.cost_micros']); months[mk].clicks += parseFloat(r['metrics.clicks'] || 0); });
  pintRows.forEach(r   => { const mk = monthKey(r.DAY);              if (!mk) return; ensure(mk); months[mk].pinterest += parseFloat(r.SPEND_IN_DOLLAR || 0); months[mk].clicks += parseFloat(r.OUTBOUND_CLICK_1 || 0); });
  return Object.entries(months).sort(([a], [b]) => b.localeCompare(a)).map(([mk, v]) => ({ mk, ...v, total: v.meta + v.google + v.pinterest }));
}

function escapeHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── Notes (per month, on the yearly widget) ──────────────────────────────────
let _yearlyCaches = {};          // widgetId -> rows
let currentYearlyWidgetId = null;

function notesStorageKey() { return `rapportage_notes_${currentClientId||'default'}`; }
function getAllNotes()      { try { return JSON.parse(localStorage.getItem(notesStorageKey())||'{}'); } catch { return {}; } }
function getNoteForMonth(mk) { return getAllNotes()[mk] || ''; }

function openNoteModal(widgetId, mk, label) {
  currentYearlyWidgetId = widgetId;
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
  closeNoteModal();
  renderYearlyBody(currentYearlyWidgetId, _yearlyCaches[currentYearlyWidgetId] || []);
}

function deleteNote() {
  if (!currentNoteKey) return;
  const notes = getAllNotes(); delete notes[currentNoteKey];
  localStorage.setItem(notesStorageKey(), JSON.stringify(notes));
  closeNoteModal();
  renderYearlyBody(currentYearlyWidgetId, _yearlyCaches[currentYearlyWidgetId] || []);
}

function renderYearlyBody(widgetId, rows) {
  _yearlyCaches[widgetId] = rows;
  const tbody = document.getElementById('yearly-tbody-' + widgetId);
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
      <td class="note-col"><button class="note-btn${hasNote?' has-note':''}" title="${hasNote?'Notitie bewerken':'Notitie toevoegen'}" onclick="openNoteModal('${widgetId}','${r.mk}','${monthLabel(r.mk)}')">${hasNote?'📌':'+'}</button></td>
    </tr>`;
    if (hasNote) html += `<tr class="note-row"><td colspan="7"><span class="note-dot"></span><span class="note-text">${escapeHtml(note)}</span></td></tr>`;
    return html;
  }).join('');
}

// ═══ Widget engine ═════════════════════════════════════════════════════════
const PAGE_KEYS = ['samenvatting', 'meta', 'google', 'pinterest'];

const ICON_GRIP = `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="3" r="1.15"/><circle cx="10" cy="3" r="1.15"/><circle cx="4" cy="7" r="1.15"/><circle cx="10" cy="7" r="1.15"/><circle cx="4" cy="11" r="1.15"/><circle cx="10" cy="11" r="1.15"/></svg>`;
const ICON_PENCIL = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5a1.5 1.5 0 012.12 2.12L5 13.25 2 14l.75-3L11.5 2.5z"/></svg>`;
const ICON_TRASH = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5M12.5 4.5l-.6 8.4a1.5 1.5 0 01-1.5 1.4h-4.8a1.5 1.5 0 01-1.5-1.4l-.6-8.4"/></svg>`;
const ICON_PLUS = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M7 1.5v11M1.5 7h11"/></svg>`;

function widgetTypeLabel(type) { return { kpi: 'KPI-balk', chart: 'Grafiek', table: 'Campagnetabel', yearly: 'Maandoverzicht', sheet: 'Gekoppeld sheet' }[type] || type; }

function availableSheets() { return (currentClientSettings?.sheets || []); }

function defaultWidgetTitle(widget) {
  if (widget.type === 'yearly') return 'Maandoverzicht dit jaar';
  if (widget.type === 'table')  return `Campagnes — ${PLATFORM_META[widget.platform]?.label || widget.platform}`;
  if (widget.type === 'sheet') {
    const sheet = availableSheets().find(s => s.id === widget.sheetLinkId);
    return sheet?.label || widgetTypeLabel('sheet');
  }
  const metrics = (widget.metrics || []).map(getMetric).filter(Boolean);
  if (!metrics.length) return widgetTypeLabel(widget.type);
  if (widget.type === 'kpi' && metrics.length > 3) return 'KPI-overzicht';
  return metrics.map(m => m.label).join(' · ');
}

function renderWidgetKpiHtml(widget, ctx) {
  const metrics = (widget.metrics || []).map(getMetric).filter(Boolean);
  if (!metrics.length) return `<p class="widget-empty">Geen metrics gekozen. Klik op ✎ om deze widget te bewerken.</p>`;
  return `<div class="kpi-strip">${metrics.map(m => `<div class="kpi-card"><div class="kpi-label">${m.label}</div><div class="kpi-value">${fmtByUnit(m.total(ctx.totals), m.unit)}</div></div>`).join('')}</div>`;
}

function renderWidgetTableHtml(widget, ctx) {
  const platform = widget.platform || 'meta';
  const rows = ctx.campaignBreakdown[platform] || [];
  const cols = tableColumnsFor(platform);
  if (!rows.length) return `<p class="widget-empty">Geen data voor ${PLATFORM_META[platform]?.label || platform} in de geselecteerde periode.</p>`;
  return `<div class="table-wrapper"><table>
    <thead><tr>${cols.map(c => `<th class="${c.cls||''}">${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => '<tr>' + cols.map(c => `<td class="${c.cls||''}">${c.render ? c.render(r) : (r[c.key] ?? '—')}</td>`).join('') + '</tr>').join('')}</tbody>
  </table></div>`;
}

function renderWidgetYearlyHtml(widget) {
  return `<div class="table-wrapper"><table>
    <thead><tr><th>Maand</th><th class="num">Meta</th><th class="num">Google</th><th class="num">Pinterest</th><th class="num">Totaal uitgaven</th><th class="num">Totaal clicks</th><th class="note-col"></th></tr></thead>
    <tbody id="yearly-tbody-${widget.id}"></tbody>
  </table></div>`;
}

function renderWidgetChart(widget, ctx) {
  const canvasId = `w-chart-${widget.id}`;
  if (!document.getElementById(canvasId)) return;
  const metrics = (widget.metrics || []).map(getMetric).filter(Boolean);
  if (!metrics.length) return;
  const families = [...new Set(metrics.map(m => unitFamily(m.unit)))];
  const datasets = metrics.map((m, i) => {
    const axis = families.length > 1 ? (unitFamily(m.unit) === families[0] ? 'y' : 'y1') : 'y';
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    return {
      label: m.label,
      data: ctx.seriesData.days.map(d => { const v = m.daily(ctx.seriesData.byDay[d]); return v == null ? null : (unitFamily(m.unit) === 'money' ? v.toFixed(2) : v); }),
      borderColor: color, backgroundColor: color + '20', fill: metrics.length === 1, tension: 0.3, yAxisID: axis,
    };
  });
  makeChart(canvasId, ctx.seriesData.days, datasets);
}

async function renderWidgetSheet(widget) {
  const el = document.getElementById(`w-sheet-${widget.id}`);
  if (!el) return;
  if (!widget.sheetLinkId) {
    el.innerHTML = `<p class="widget-empty">Geen sheet gekoppeld. Klik op het potlood-icoon hierboven om deze widget te bewerken.</p>`;
    return;
  }
  try {
    const r = await fetch(`/api/client-config/${currentClientId}/sheet-data/${widget.sheetLinkId}`);
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || 'Kon sheetdata niet laden.');
    el.innerHTML = renderSheetTableHtml(d.headers, d.rows);
  } catch (err) {
    el.innerHTML = `<p class="widget-empty">${escapeHtml(err.message)}</p>`;
  }
}

function renderSheetTableHtml(headers, rows) {
  if (!headers || !headers.length) return '<p class="widget-empty">Dit sheet bevat nog geen data.</p>';
  const thead = `<tr>${headers.map(h => `<th>${escapeHtml(h || '')}</th>`).join('')}</tr>`;
  const tbody = (rows || []).map(row =>
    `<tr>${headers.map((_, i) => `<td>${escapeHtml(row[i] != null ? String(row[i]) : '')}</td>`).join('')}</tr>`
  ).join('');
  return `<div class="table-wrapper"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

function buildWidgetElement(widget, ctx, pageKey) {
  const wrap = document.createElement('div');
  wrap.className = `widget-block widget-${widget.type}`;
  wrap.dataset.widgetId = widget.id;

  let bodyHtml;
  if (widget.type === 'kpi')         bodyHtml = renderWidgetKpiHtml(widget, ctx);
  else if (widget.type === 'chart')  bodyHtml = `<canvas id="w-chart-${widget.id}"></canvas>`;
  else if (widget.type === 'table')  bodyHtml = renderWidgetTableHtml(widget, ctx);
  else if (widget.type === 'yearly') bodyHtml = renderWidgetYearlyHtml(widget);
  else if (widget.type === 'sheet')  bodyHtml = `<div id="w-sheet-${widget.id}" class="widget-sheet-loading">Laden…</div>`;
  else bodyHtml = '';

  const showEditBtn = widget.type !== 'yearly';
  wrap.innerHTML = `
    <div class="widget-header">
      <span class="widget-drag-handle edit-only" title="Verplaatsen">${ICON_GRIP}</span>
      <span class="widget-title">${escapeHtml(widget.title || defaultWidgetTitle(widget))}</span>
      <span class="widget-toolbar-actions edit-only">
        ${showEditBtn ? `<button class="widget-icon-btn" onclick="openWidgetEditor('${pageKey}','${widget.id}')" title="Bewerken">${ICON_PENCIL}</button>` : ''}
        <button class="widget-icon-btn widget-icon-danger" onclick="removeWidget('${pageKey}','${widget.id}')" title="Verwijderen">${ICON_TRASH}</button>
      </span>
    </div>
    <div class="widget-body">${bodyHtml}</div>
  `;
  return wrap;
}

function renderPageWidgets(pageKey) {
  const container = document.getElementById('widgets-' + pageKey);
  if (!container) return;
  container.innerHTML = '';
  const widgets = (currentLayout && currentLayout[pageKey]) || [];

  if (!widgets.length) {
    container.innerHTML = editMode
      ? '<p class="widgets-empty">Nog geen widgets op deze pagina. Klik hierboven op "Widget toevoegen".</p>'
      : '<p class="widgets-empty">Nog geen widgets geconfigureerd voor deze pagina.</p>';
    return;
  }

  if (!currentReportCtx) return;

  const chartWidgets = [];
  const sheetWidgets = [];
  widgets.forEach(w => {
    const el = buildWidgetElement(w, currentReportCtx, pageKey);
    container.appendChild(el);
    if (w.type === 'chart') chartWidgets.push(w);
    if (w.type === 'sheet') sheetWidgets.push(w);
  });
  chartWidgets.forEach(w => renderWidgetChart(w, currentReportCtx));
  sheetWidgets.forEach(renderWidgetSheet);
  widgets.filter(w => w.type === 'yearly').forEach(w => renderYearlyBody(w.id, currentReportCtx.yearlyRows));

  container.classList.toggle('edit-on', editMode);
  if (editMode) initSortable(container);
}

function renderAllPages() { PAGE_KEYS.forEach(renderPageWidgets); }

// ─── Widget editor (add / edit) ───────────────────────────────────────────────
let editingWidgetCtx = null; // { pageKey, widgetId }

function availablePlatforms() {
  return ['meta', 'google', 'pinterest'].filter(p => currentClient && currentClient[p]);
}

function availableMetricGroups() {
  const platforms = ['total', ...availablePlatforms()];
  return platforms.map(p => ({ platform: p, label: PLATFORM_META[p].label, metrics: METRICS.filter(m => m.platform === p) }));
}

function addWidget(pageKey) { openWidgetEditor(pageKey, null); }

function removeWidget(pageKey, widgetId) {
  currentLayout[pageKey] = (currentLayout[pageKey] || []).filter(w => w.id !== widgetId);
  renderPageWidgets(pageKey);
}

function openWidgetEditor(pageKey, widgetId) {
  editingWidgetCtx = { pageKey, widgetId };
  const widget = widgetId ? (currentLayout[pageKey] || []).find(w => w.id === widgetId) : null;
  const type = widget?.type || 'kpi';
  document.getElementById('widget-editor-title').textContent = widgetId ? 'Widget bewerken' : 'Widget toevoegen';
  document.getElementById('widget-type-select').value = type;
  document.getElementById('widget-title-input').value = widget?.title || '';
  renderWidgetEditorFields(type, widget);
  document.getElementById('widget-editor-overlay').classList.remove('hidden');
}

function closeWidgetEditor() { document.getElementById('widget-editor-overlay').classList.add('hidden'); editingWidgetCtx = null; }

function onWidgetTypeChange() {
  const type = document.getElementById('widget-type-select').value;
  renderWidgetEditorFields(type, null);
}

function renderWidgetEditorFields(type, widget) {
  const el = document.getElementById('widget-editor-fields');
  if (type === 'yearly') {
    el.innerHTML = `<p class="widget-editor-hint">Toont automatisch het maandoverzicht (uitgaven &amp; clicks per platform) met ruimte voor notities per maand. Geen extra instellingen nodig.</p>`;
    return;
  }
  if (type === 'sheet') {
    const sheets = availableSheets();
    if (!sheets.length) {
      el.innerHTML = `<p class="widget-editor-hint">Deze klant heeft nog geen gekoppelde Google Sheets. Voeg er eerst één toe via Instellingen → Gekoppelde sheets.</p>`;
      return;
    }
    el.innerHTML = `<label class="settings-row"><span class="settings-label">Sheet</span>
      <select id="widget-sheet-select">${sheets.map(s => `<option value="${s.id}" ${widget?.sheetLinkId===s.id?'selected':''}>${escapeHtml(s.label || 'Sheet')}</option>`).join('')}</select>
    </label>
    <p class="widget-editor-hint">Toont de eerste rij van het gekoppelde tabblad als kolomkoppen, en de rest als tabelgegevens — precies zoals het in het sheet staat.</p>`;
    return;
  }
  if (type === 'table') {
    const platforms = availablePlatforms();
    if (!platforms.length) { el.innerHTML = `<p class="widget-editor-hint">Deze klant heeft nog geen gekoppelde platformen.</p>`; return; }
    el.innerHTML = `<label class="settings-row"><span class="settings-label">Platform</span>
      <select id="widget-platform-select">${platforms.map(p => `<option value="${p}" ${widget?.platform===p?'selected':''}>${PLATFORM_META[p].label}</option>`).join('')}</select>
    </label>`;
    return;
  }
  // kpi / chart: metric checklist grouped by platform
  const selected = new Set(widget?.metrics || []);
  const groups = availableMetricGroups();
  el.innerHTML = `<div class="settings-label" style="margin-bottom:6px;">Metrics</div>` + groups.map(g => `
    <div class="metric-group">
      <div class="metric-group-title">${g.label}</div>
      <div class="metric-checklist">
        ${g.metrics.map(m => `<label class="metric-check"><input type="checkbox" value="${m.id}" ${selected.has(m.id)?'checked':''}/> ${m.shortLabel}</label>`).join('')}
      </div>
    </div>`).join('');
}

function saveWidgetFromEditor() {
  if (!editingWidgetCtx) return;
  const { pageKey, widgetId } = editingWidgetCtx;
  const type  = document.getElementById('widget-type-select').value;
  const title = document.getElementById('widget-title-input').value.trim();

  let widget = widgetId ? (currentLayout[pageKey] || []).find(w => w.id === widgetId) : null;
  if (!widget) {
    widget = { id: 'w_' + Math.random().toString(36).slice(2, 10) };
    currentLayout[pageKey] = [...(currentLayout[pageKey] || []), widget];
  }
  widget.type = type;
  if (title) widget.title = title; else delete widget.title;

  if (type === 'table') {
    widget.platform = document.getElementById('widget-platform-select')?.value || availablePlatforms()[0] || 'meta';
    delete widget.metrics; delete widget.sheetLinkId;
  } else if (type === 'yearly') {
    delete widget.metrics; delete widget.platform; delete widget.sheetLinkId;
  } else if (type === 'sheet') {
    widget.sheetLinkId = document.getElementById('widget-sheet-select')?.value || null;
    delete widget.metrics; delete widget.platform;
  } else {
    const checked = [...document.querySelectorAll('#widget-editor-fields input[type=checkbox]:checked')].map(c => c.value);
    widget.metrics = checked;
    delete widget.platform; delete widget.sheetLinkId;
  }

  closeWidgetEditor();
  renderPageWidgets(pageKey);
}

// ─── Edit mode (drag-and-drop + save) ─────────────────────────────────────────
function setEditMode(on) {
  editMode = on;
  document.querySelectorAll('.widgets-container').forEach(el => {
    el.classList.toggle('edit-on', on);
    if (on) initSortable(el); else destroySortable(el);
  });
  document.querySelectorAll('.page-toolbar').forEach(el => el.classList.toggle('hidden', !on));
  document.getElementById('edit-mode-btn')?.classList.toggle('active', on);
  document.getElementById('layout-save-bar')?.classList.toggle('hidden', !on);
  document.querySelector('.main-content')?.classList.toggle('edit-mode-padding', on);
  // Keep the fixed save bar from covering whatever is being scrolled into view (e.g. via keyboard nav).
  document.documentElement.style.scrollPaddingBottom = on ? '110px' : '';
}

function toggleEditMode() { setEditMode(!editMode); }

function initSortable(el) {
  if (el._sortable || typeof Sortable === 'undefined') return;
  const pageKey = el.dataset.page;
  el._sortable = new Sortable(el, {
    handle: '.widget-drag-handle',
    animation: 150,
    onEnd: () => {
      const ids = [...el.children].map(c => c.dataset.widgetId).filter(Boolean);
      if (!ids.length) return;
      currentLayout[pageKey] = ids.map(id => currentLayout[pageKey].find(w => w.id === id)).filter(Boolean);
    },
  });
}

function destroySortable(el) { if (el._sortable) { el._sortable.destroy(); el._sortable = null; } }

function cloneLayout(layout) { return JSON.parse(JSON.stringify(layout)); }

function resolveLayout(saved) {
  const base = cloneLayout(DEFAULT_LAYOUT);
  if (!saved) return base;
  const merged = {};
  PAGE_KEYS.forEach(k => { merged[k] = Array.isArray(saved[k]) ? saved[k] : base[k]; });
  return merged;
}

function resetLayoutToDefault() {
  if (!confirm('Layout terugzetten naar de standaardopzet? Niet-opgeslagen wijzigingen gaan verloren.')) return;
  currentLayout = cloneLayout(DEFAULT_LAYOUT);
  renderAllPages();
}

async function saveLayout() {
  if (!currentClientId) return;
  const btn = document.getElementById('layout-save-btn');
  const status = document.getElementById('layout-save-status');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/api/client-config/${currentClientId}/layout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportLayout: currentLayout }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Opslaan mislukt');
    if (currentClientSettings) currentClientSettings.reportLayout = currentLayout;
    if (status) { status.textContent = ''; status.className = 'settings-save-status'; }
    if (btn) btn.disabled = false;
    setEditMode(false);
    showToast('Layout opgeslagen ✓');
    return;
  } catch (err) {
    if (status) { status.textContent = 'Fout: ' + err.message; status.className = 'settings-save-status error'; }
  }
  if (btn) btn.disabled = false;
}

// ─── Default layout (matches the original fixed report design) ───────────────
const DEFAULT_LAYOUT = {
  samenvatting: [
    { id: 'def-kpi',          type: 'kpi', title: 'KPI-overzicht', metrics: ['total.spend', 'total.clicks', 'total.impressions', 'total.cpc', 'meta.spend', 'google.spend', 'pinterest.spend'] },
    { id: 'def-chart-spend',  type: 'chart', title: 'Uitgaven per dag', metrics: ['meta.spend', 'google.spend', 'pinterest.spend'] },
    { id: 'def-chart-clicks', type: 'chart', title: 'Clicks per dag',   metrics: ['meta.clicks', 'google.clicks', 'pinterest.clicks'] },
    { id: 'def-yearly',       type: 'yearly' },
  ],
  meta: [
    { id: 'def-meta-kpi',   type: 'kpi', title: 'KPI-overzicht', metrics: ['meta.impressions', 'meta.clicks', 'meta.ctr', 'meta.spend', 'meta.cpc', 'meta.cpm'] },
    { id: 'def-meta-spend', type: 'chart', title: 'Uitgaven per dag (€)', metrics: ['meta.spend'] },
    { id: 'def-meta-eng',   type: 'chart', title: 'Clicks en impressies per dag', metrics: ['meta.clicks', 'meta.impressions'] },
    { id: 'def-meta-table', type: 'table', platform: 'meta' },
  ],
  google: [
    { id: 'def-google-kpi',   type: 'kpi', title: 'KPI-overzicht', metrics: ['google.impressions', 'google.clicks', 'google.ctr', 'google.spend', 'google.cpc', 'google.cpm'] },
    { id: 'def-google-spend', type: 'chart', title: 'Kosten per dag (€)', metrics: ['google.spend'] },
    { id: 'def-google-eng',   type: 'chart', title: 'Clicks en impressies per dag', metrics: ['google.clicks', 'google.impressions'] },
    { id: 'def-google-table', type: 'table', platform: 'google' },
  ],
  pinterest: [
    { id: 'def-pin-kpi',   type: 'kpi', title: 'KPI-overzicht', metrics: ['pinterest.impressions', 'pinterest.clicks', 'pinterest.ctr', 'pinterest.spend', 'pinterest.cpc'] },
    { id: 'def-pin-spend', type: 'chart', title: 'Uitgaven per dag (€)', metrics: ['pinterest.spend'] },
    { id: 'def-pin-eng',   type: 'chart', title: 'Clicks en impressies per dag', metrics: ['pinterest.clicks', 'pinterest.impressions'] },
    { id: 'def-pin-table', type: 'table', platform: 'pinterest' },
  ],
};

// ─── Main load ────────────────────────────────────────────────────────────────
async function loadReport(forcedClientId) {
  clearError();

  const clientId = forcedClientId || document.getElementById('client-select')?.value;
  if (!clientId) { showError('Selecteer een klant.'); return; }

  const baseClient = (CLIENTS || []).find(c => c.id === clientId);
  if (!baseClient) { showError('Klant niet gevonden.'); return; }

  // Fetch client config (settings / overrides / layout) if not already loaded
  if (!currentClientSettings || currentClientId !== clientId) {
    currentClientSettings = await fetchClientConfig(clientId);
  }

  // Apply account overrides from settings
  const client = applyAccountOverrides(baseClient, currentClientSettings?.accountOverrides);
  currentClient = client;
  currentClientId = clientId;

  document.getElementById('header-client').textContent = client.name;
  const sep = document.getElementById('header-client-sep');
  if (sep) sep.style.display = '';
  document.getElementById('setup-notice').classList.add('hidden');

  // Update sidebar based on client platforms + settings
  updateSidebarForClient(client, currentClientSettings?.platforms);

  currentLayout = resolveLayout(currentClientSettings?.reportLayout);
  setEditMode(false);
  setLoading(true);

  const dateRange     = getPeriodApiDateRange();
  const yd            = computePeriodDates('thisyear');
  const yearDateRange = yd ? { preset: 'custom', start: yd.start, end: yd.end } : dateRange;

  try {
    const [metaRes, googleRes, pintRes, metaYear, googleYear, pintYear] = await Promise.allSettled([
      loadMeta(client, dateRange), loadGoogle(client, dateRange), loadPinterest(client, dateRange),
      loadMeta(client, yearDateRange), loadGoogle(client, yearDateRange), loadPinterestYearly(client, yearDateRange),
    ]);

    const ok = r => r.status === 'fulfilled' ? r.value : [];
    const metaRows = ok(metaRes), googleRows = ok(googleRes), pintRows = ok(pintRes);

    const allResults = [metaRes, googleRes, pintRes, metaYear, googleYear, pintYear];
    const allLabels  = ['Meta', 'Google', 'Pinterest', 'Meta (jaar)', 'Google (jaar)', 'Pinterest (jaar)'];
    const errs = allResults.map((r,i)=>r.status==='rejected'?allLabels[i]+': '+r.reason?.message:null).filter(Boolean);
    if (errs.length) showError(errs.join(' | '));

    const periodInfo  = computePeriodDates(selectedPeriod);
    const periodLabel = selectedPeriod==='custom' ? `${fmtDisplayDate(customStartDate)} – ${fmtDisplayDate(customEndDate)}` : (PERIODS.find(p=>p.value===selectedPeriod)?.label||selectedPeriod);

    document.getElementById('kpi-heading').textContent = 'Samenvatting — ' + client.name;
    document.getElementById('kpi-sub').textContent     = 'Periode: ' + periodLabel + (periodInfo?` (${periodInfo.days} dagen)`:'')+' · alle gekoppelde platformen';

    currentReportCtx = {
      seriesData: buildDailySeries(metaRows, googleRows, pintRows),
      totals: aggregateTotals(metaRows, googleRows, pintRows),
      campaignBreakdown: {
        meta: buildCampaignBreakdown('meta', metaRows),
        google: buildCampaignBreakdown('google', googleRows),
        pinterest: buildCampaignBreakdown('pinterest', pintRows),
      },
      yearlyRows: buildYearlyTable(ok(metaYear), ok(googleYear), ok(pintYear)),
    };

    renderAllPages();

  } catch (err) {
    showError('Fout: ' + err.message);
  } finally {
    setLoading(false);
  }
}
