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

const PLATFORM_BADGE = {
  meta:      { label: 'Meta',      badgeClass: 'badge-meta' },
  google:    { label: 'Google',    badgeClass: 'badge-google' },
  pinterest: { label: 'Pinterest', badgeClass: 'badge-pinterest' },
};

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

// Zelfde periode vorig jaar: kalenderjaar -1, zelfde maand/dag. Randgeval 29 feb
// in een niet-schrikkeljaar bestaat simpelweg niet en levert dan geen data op.
function shiftIsoDateYears(iso, years) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function previousYearDateRange(dateRange) {
  if (!dateRange?.start || !dateRange?.end) return null;
  return { preset: 'custom', start: shiftIsoDateYears(dateRange.start, -1), end: shiftIsoDateYears(dateRange.end, -1) };
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

function applyAccountOverrides(client, overrides, analyticsLink) {
  const c = JSON.parse(JSON.stringify(client));
  if (overrides?.meta      && c.meta)      c.meta.account_id      = overrides.meta;
  if (overrides?.google    && c.google)    c.google.account_id    = overrides.google;
  if (overrides?.pinterest && c.pinterest) c.pinterest.account_id = overrides.pinterest;
  // Analytics (GA4) staat niet in clients.js — die koppeling leeft volledig in
  // de instellingen (per klant een Reporting Ninja connection + property-ID).
  c.analytics = analyticsLink ? { connection_key: analyticsLink.connectionKey, account_id: analyticsLink.accountId } : null;
  return c;
}

function updateSidebarForClient(client, platformSettings) {
  ['meta', 'google', 'pinterest', 'analytics'].forEach(platform => {
    const btn = document.querySelector(`.nav-item[data-platform="${platform}"]`);
    if (!btn) return;
    const hasAccount = !!client[platform];
    const enabled    = platformSettings ? platformSettings[platform] !== false : true;
    const promo      = currentClientSettings?.promotions?.[platform];
    const promoted   = !hasAccount && !!promo?.enabled && !!promo?.headline;
    btn.style.display = (hasAccount && enabled) || promoted ? '' : 'none';

    let badge = btn.querySelector('.nav-badge');
    if (promoted) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        badge.textContent = 'Nieuw';
        btn.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  });

  // Also show/hide the "Platformen" section header based on any visible platform
  const anyVisible = ['meta','google','pinterest','analytics'].some(p => {
    const btn = document.querySelector(`.nav-item[data-platform="${p}"]`);
    return btn && btn.style.display !== 'none';
  });
  const header = document.querySelector('.nav-section-platforms');
  if (header) header.style.display = anyVisible ? '' : 'none';
}

// ─── Promotiepagina's voor ontbrekende kanalen ────────────────────────────────
const PROMO_PLATFORM_META = {
  meta:      { label: 'Meta Ads',      badge: 'badge-meta' },
  google:    { label: 'Google Ads',    badge: 'badge-google' },
  pinterest: { label: 'Pinterest Ads', badge: 'badge-pinterest' },
};

function renderPromoPages() {
  ['meta', 'google', 'pinterest'].forEach(platform => {
    const hasAccount = !!(currentClient && currentClient[platform]);
    const promo       = currentClientSettings?.promotions?.[platform];
    const showPromo   = !hasAccount && !!promo?.enabled && !!promo?.headline;
    const promoEl     = document.getElementById('promo-' + platform);
    const toolbarEl   = document.getElementById('toolbar-' + platform);
    const widgetsEl   = document.getElementById('widgets-' + platform);
    if (!promoEl) return;

    if (showPromo) {
      promoEl.innerHTML = renderPromoPageHtml(platform, promo);
      promoEl.classList.remove('hidden');
      if (toolbarEl) toolbarEl.style.display = 'none';
      if (widgetsEl) widgetsEl.style.display = 'none';
    } else {
      promoEl.classList.add('hidden');
      promoEl.innerHTML = '';
      if (toolbarEl) toolbarEl.style.display = '';
      if (widgetsEl) widgetsEl.style.display = '';
    }
  });
}

function renderPromoPageHtml(platform, promo) {
  const meta = PROMO_PLATFORM_META[platform] || { label: platform, badge: '' };
  const benefits = (promo.benefits || []).map(b => `
    <li class="promo-benefit">
      <span class="promo-benefit-icon">${ICON_CHECK}</span>
      <span>${escapeHtml(b)}</span>
    </li>`).join('');

  return `
    <div class="promo-page-inner">
      <div class="promo-hero">
        <span class="badge ${meta.badge}">${meta.label}</span>
        <h2>${escapeHtml(promo.headline || '')}</h2>
        ${promo.subheadline ? `<p class="promo-sub">${escapeHtml(promo.subheadline)}</p>` : ''}
      </div>
      ${benefits ? `<ul class="promo-benefits">${benefits}</ul>` : ''}
      ${promo.cta ? `<div class="promo-cta-banner">${escapeHtml(promo.cta)}</div>` : ''}
    </div>`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  initPeriodPicker();

  if (CLIENT_MODE) {
    // Hide client selector, settings link, edit-mode toggle
    document.getElementById('main-layout')?.classList.remove('hidden');
    document.getElementById('header-controls')?.classList.remove('hidden');
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
    // Normal mode: populate client dropdown (snel wisselen) + tegel-landingsscherm
    const sel = document.getElementById('client-select');
    (CLIENTS || []).forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { if (sel.value) selectClient(sel.value); });

    renderClientPickerGrid();
    showClientPicker();
  }
})();

// ─── Klantkeuzescherm (marketeer-landingspagina) ──────────────────────────────
function renderClientPickerGrid() {
  const grid = document.getElementById('client-picker-grid');
  if (!grid) return;
  if (!CLIENTS || !CLIENTS.length) {
    grid.innerHTML = '<div style="color:var(--text-muted)">Geen klanten gevonden.</div>';
    return;
  }
  grid.innerHTML = CLIENTS.map(c => {
    const platforms = ['meta', 'google', 'pinterest'].filter(p => !!c[p]);
    const initial   = (c.name || '?').trim().charAt(0).toUpperCase();
    const badges    = platforms.map(p =>
      `<span class="badge ${PLATFORM_BADGE[p]?.badgeClass || ''}">${PLATFORM_BADGE[p]?.label || p}</span>`
    ).join('');
    return `
      <button class="client-tile" onclick="selectClient('${c.id}')">
        <div class="client-tile-avatar">${initial}</div>
        <div class="client-tile-name">${escapeHtml(c.name)}</div>
        <div class="client-tile-badges">${badges}</div>
      </button>`;
  }).join('');
}

function showClientPicker() {
  document.getElementById('client-picker-screen')?.classList.remove('hidden');
  document.getElementById('main-layout')?.classList.add('hidden');
  document.getElementById('header-controls')?.classList.add('hidden');
  document.getElementById('switch-client-btn')?.classList.add('hidden');
  const sep = document.getElementById('header-client-sep');
  if (sep) sep.style.display = 'none';
  const headerClient = document.getElementById('header-client');
  if (headerClient) headerClient.textContent = '';
  setEditMode(false);
}

function selectClient(clientId) {
  document.getElementById('client-picker-screen')?.classList.add('hidden');
  document.getElementById('main-layout')?.classList.remove('hidden');
  document.getElementById('header-controls')?.classList.remove('hidden');
  document.getElementById('switch-client-btn')?.classList.remove('hidden');
  const sel = document.getElementById('client-select');
  if (sel) sel.value = clientId;
  loadReport(clientId);
}

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
  if (type === 'ratio') return v.toFixed(2).replace('.', ',') + 'x';
  if (type === 'duration') {
    const s = Math.round(v);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }
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
    fields: ['day', 'campaign_name', 'impressions', 'clicks', 'spend', 'cpc', 'reach',
      'actions:omni_purchase', 'action_values:omni_purchase', 'actions:link_click', 'actions:post_engagement'],
    date_range: dateRange, limit: 500,
  });
  return d.data?.rows || [];
}

async function loadGoogle(client, dateRange) {
  if (!client.google) return [];
  const d = await apiPost('/api/query', {
    integration_id: 'google_ads', connection_key: client.google.connection_key,
    account_id: client.google.account_id, data_view: client.google.data_view || 'campaign',
    fields: ['segments.date', 'campaign.name', 'metrics.impressions', 'metrics.clicks', 'metrics.cost_micros',
      'metrics.conversions', 'metrics.conversions_value', 'metrics.all_conversions', 'metrics.interactions'],
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
    fields: ['DAY', 'CAMPAIGN_NAME', 'IMPRESSION_1', 'OUTBOUND_CLICK_1', 'SPEND_IN_DOLLAR', 'ECPC_IN_DOLLAR',
      'TOTAL_CONVERSIONS', 'SAVES_CM', 'ENGAGEMENTS_CM', 'TOTAL_IMPRESSION_USER', 'TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR'],
    date_range: { preset: 'custom', ...clipped }, limit: 2000,
  });
  return d.data?.rows || [];
}

async function loadAnalytics(client, dateRange) {
  if (!client.analytics) return [];
  const d = await apiPost('/api/query', {
    integration_id: 'ga4', connection_key: client.analytics.connection_key, account_id: client.analytics.account_id,
    fields: ['date', 'sessions', 'activeUsers', 'newUsers', 'engagedSessions', 'screenPageViews', 'keyEvents', 'totalRevenue', 'userEngagementDuration'],
    date_range: dateRange, limit: 500,
  });
  return d.data?.rows || [];
}

// Losse (niet per dag opgesplitste) query voor de best verkochte producten in de
// geselecteerde periode — gebaseerd op GA4's e-commerce item-dimensies. Alleen
// relevant voor klanten met een webshop; levert gewoon een lege lijst op als er
// geen item-data in het GA4-property staat.
async function loadAnalyticsProducts(client, dateRange) {
  if (!client.analytics) return [];
  const d = await apiPost('/api/query', {
    integration_id: 'ga4', connection_key: client.analytics.connection_key, account_id: client.analytics.account_id,
    fields: ['itemName', 'itemsPurchased', 'itemRevenue'],
    date_range: dateRange, limit: 100,
  });
  return d.data?.rows || [];
}

// GA4-datums komen bij Google standaard binnen als "YYYYMMDD"; normaliseer naar
// YYYY-MM-DD zodat ze aansluiten bij de dagsleutels van de andere platformen.
function normalizeGa4Date(v) {
  const s = String(v || '');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
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
  analytics: { label: 'Analytics' },
};

// Alle velden die per platform worden opgeteld. "total" wordt hier automatisch
// van afgeleid (som over meta+google+pinterest) — een nieuw veld toevoegen aan
// een platform-som telt dus vanzelf ook mee in het "Totaal"-platform.
function emptyPlatformTotals() {
  return {
    spend: 0, clicks: 0, impressions: 0,
    conversions: 0, conversionsValue: 0, engagements: 0, reach: 0,
    linkClicks: 0, allConversions: 0, saves: 0,
  };
}

function combinePlatformTotals(...parts) {
  const total = emptyPlatformTotals();
  Object.keys(total).forEach(k => { total[k] = parts.reduce((sum, p) => sum + (p?.[k] || 0), 0); });
  return total;
}

function addMetaRow(t, r) {
  t.spend += parseFloat(r.spend || 0);
  t.clicks += parseFloat(r.clicks || 0);
  t.impressions += parseFloat(r.impressions || 0);
  t.reach += parseFloat(r.reach || 0);
  t.conversions += parseFloat(r['actions:omni_purchase'] || 0);
  t.conversionsValue += parseFloat(r['action_values:omni_purchase'] || 0);
  t.linkClicks += parseFloat(r['actions:link_click'] || 0);
  t.engagements += parseFloat(r['actions:post_engagement'] || 0);
}
function addGoogleRow(t, r) {
  t.spend += micros(r['metrics.cost_micros']);
  t.clicks += parseFloat(r['metrics.clicks'] || 0);
  t.impressions += parseFloat(r['metrics.impressions'] || 0);
  t.conversions += parseFloat(r['metrics.conversions'] || 0);
  t.conversionsValue += parseFloat(r['metrics.conversions_value'] || 0);
  t.allConversions += parseFloat(r['metrics.all_conversions'] || 0);
  t.engagements += parseFloat(r['metrics.interactions'] || 0);
}
function addPinterestRow(t, r) {
  t.spend += parseFloat(r.SPEND_IN_DOLLAR || 0);
  t.clicks += parseFloat(r.OUTBOUND_CLICK_1 || 0);
  t.impressions += parseFloat(r.IMPRESSION_1 || 0);
  t.reach += parseFloat(r.TOTAL_IMPRESSION_USER || 0);
  t.conversions += parseFloat(r.TOTAL_CONVERSIONS || 0);
  t.conversionsValue += parseFloat(r.TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR || 0) / 1e6;
  t.saves += parseFloat(r.SAVES_CM || 0);
  t.engagements += parseFloat(r.ENGAGEMENTS_CM || 0);
}

// Analytics (GA4) is geen advertentieplatform — spend/clicks/CTR slaan er niet
// op — dus die krijgt een eigen totals-vorm i.p.v. de ad-platform-shape hierboven.
// Hij telt niet mee in "Totaal" (dat blijft puur de 3 advertentieplatformen).
function emptyAnalyticsTotals() {
  return { sessions: 0, activeUsers: 0, newUsers: 0, engagedSessions: 0, screenPageViews: 0, keyEvents: 0, totalRevenue: 0, engagementDuration: 0 };
}
function addAnalyticsRow(t, r) {
  t.sessions += parseFloat(r.sessions || 0);
  t.activeUsers += parseFloat(r.activeUsers || 0);
  t.newUsers += parseFloat(r.newUsers || 0);
  t.engagedSessions += parseFloat(r.engagedSessions || 0);
  t.screenPageViews += parseFloat(r.screenPageViews || 0);
  t.keyEvents += parseFloat(r.keyEvents || 0);
  t.totalRevenue += parseFloat(r.totalRevenue || 0);
  t.engagementDuration += parseFloat(r.userEngagementDuration || 0);
}

function aggregateTotals(metaRows, googleRows, pintRows, analyticsRows = []) {
  const meta = emptyPlatformTotals(), google = emptyPlatformTotals(), pinterest = emptyPlatformTotals();
  const analytics = emptyAnalyticsTotals();
  metaRows.forEach(r => addMetaRow(meta, r));
  googleRows.forEach(r => addGoogleRow(google, r));
  pintRows.forEach(r => addPinterestRow(pinterest, r));
  analyticsRows.forEach(r => addAnalyticsRow(analytics, r));
  const total = combinePlatformTotals(meta, google, pinterest);
  return { meta, google, pinterest, total, analytics };
}

function buildDailySeries(metaRows, googleRows, pintRows, analyticsRows = []) {
  const byDay = {};
  const ensure = d => byDay[d] || (byDay[d] = { meta: emptyPlatformTotals(), google: emptyPlatformTotals(), pinterest: emptyPlatformTotals(), analytics: emptyAnalyticsTotals() });
  metaRows.forEach(r   => { const d = r.day || '';                  if (d) addMetaRow(ensure(d).meta, r); });
  googleRows.forEach(r => { const d = r['segments.date'] || '';     if (d) addGoogleRow(ensure(d).google, r); });
  pintRows.forEach(r   => { const d = r.DAY || '';                   if (d) addPinterestRow(ensure(d).pinterest, r); });
  analyticsRows.forEach(r => { const d = normalizeGa4Date(r.date);  if (d) addAnalyticsRow(ensure(d).analytics, r); });
  const days = Object.keys(byDay).sort();
  days.forEach(d => {
    const e = byDay[d];
    e.total = combinePlatformTotals(e.meta, e.google, e.pinterest);
  });
  return { days, byDay };
}

// Extra metrics naast de basisset (spend/clicks/impressions/ctr/cpc/cpm). Deze
// staan in de widget-editor achter een "+ Meer metrics toevoegen" dropdown per
// platform, zodat de basislijst overzichtelijk blijft. `platforms` bepaalt voor
// welke platformen (incl. eventueel "total") deze metric zinvol/beschikbaar is.
const EXTRA_METRIC_DEFS = [
  { key: 'conversions',      shortLabel: 'Conversies',        unit: 'count', platforms: ['meta', 'google', 'pinterest', 'total'] },
  { key: 'conversionsValue', shortLabel: 'Conversiewaarde',   unit: 'eur',   platforms: ['meta', 'google', 'pinterest', 'total'] },
  { key: 'engagements',      shortLabel: 'Interacties',       unit: 'count', platforms: ['meta', 'google', 'pinterest', 'total'] },
  { key: 'reach',            shortLabel: 'Bereik',            unit: 'count', platforms: ['meta', 'pinterest', 'total'] },
  { key: 'linkClicks',       shortLabel: 'Linkclicks',        unit: 'count', platforms: ['meta'] },
  { key: 'allConversions',   shortLabel: 'Alle conversies (incl. view-through)', unit: 'count', platforms: ['google'] },
  { key: 'saves',            shortLabel: 'Saves',             unit: 'count', platforms: ['pinterest'] },
];

// Analytics (GA4) basis-metrics — direct sommeerbare velden. Engagement rate,
// bouncepercentage en gem. sessieduur zijn verhoudingen en worden daarom apart
// afgeleid (net als CTR/CPC bij de advertentieplatformen).
const ANALYTICS_METRIC_DEFS = [
  { key: 'sessions',        shortLabel: 'Sessies' },
  { key: 'activeUsers',     shortLabel: 'Gebruikers' },
  { key: 'newUsers',        shortLabel: 'Nieuwe gebruikers' },
  { key: 'engagedSessions', shortLabel: 'Geëngageerde sessies' },
  { key: 'screenPageViews', shortLabel: 'Paginaweergaven' },
  { key: 'keyEvents',       shortLabel: 'Conversies' },
  { key: 'totalRevenue',    shortLabel: 'Omzet', unit: 'eur' },
].map(m => ({ unit: 'count', ...m }));

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
  EXTRA_METRIC_DEFS.forEach(def => {
    def.platforms.forEach(p => {
      const pl = PLATFORM_META[p].label;
      metrics.push({ id: `${p}.${def.key}`, platform: p, shortLabel: def.shortLabel, label: `${pl} — ${def.shortLabel}`, unit: def.unit, extra: true,
        daily: d => d[p][def.key], total: t => t[p][def.key] });
    });
  });
  ['meta', 'google', 'pinterest', 'total'].forEach(p => {
    const pl = PLATFORM_META[p].label;
    metrics.push({ id: `${p}.roas`, platform: p, shortLabel: 'ROAS', label: `${pl} — ROAS`, unit: 'ratio', extra: true,
      daily: d => d[p].spend > 0 ? d[p].conversionsValue / d[p].spend : null,
      total: t => t[p].spend > 0 ? t[p].conversionsValue / t[p].spend : 0 });
  });
  // Analytics (GA4) — geen advertentieplatform, dus los van de meta/google/
  // pinterest/total-lus hierboven. Alleen zichtbaar in de widget-editor als de
  // klant een property gekoppeld heeft (zie hasAnalytics()).
  ANALYTICS_METRIC_DEFS.forEach(def => {
    metrics.push({ id: `analytics.${def.key}`, platform: 'analytics', shortLabel: def.shortLabel, label: `Analytics — ${def.shortLabel}`, unit: def.unit,
      daily: d => d.analytics[def.key], total: t => t.analytics[def.key] });
  });
  metrics.push({ id: 'analytics.engagementRate', platform: 'analytics', shortLabel: 'Engagement rate', label: 'Analytics — Engagement rate', unit: 'pct', extra: true,
    daily: d => d.analytics.sessions > 0 ? d.analytics.engagedSessions / d.analytics.sessions * 100 : null,
    total: t => t.analytics.sessions > 0 ? t.analytics.engagedSessions / t.analytics.sessions * 100 : 0 });
  metrics.push({ id: 'analytics.bounceRate', platform: 'analytics', shortLabel: 'Bouncepercentage', label: 'Analytics — Bouncepercentage', unit: 'pct', extra: true,
    daily: d => d.analytics.sessions > 0 ? (d.analytics.sessions - d.analytics.engagedSessions) / d.analytics.sessions * 100 : null,
    total: t => t.analytics.sessions > 0 ? (t.analytics.sessions - t.analytics.engagedSessions) / t.analytics.sessions * 100 : 0 });
  metrics.push({ id: 'analytics.avgSessionDuration', platform: 'analytics', shortLabel: 'Gem. sessieduur', label: 'Analytics — Gem. sessieduur', unit: 'duration', extra: true,
    daily: d => d.analytics.sessions > 0 ? d.analytics.engagementDuration / d.analytics.sessions : null,
    total: t => t.analytics.sessions > 0 ? t.analytics.engagementDuration / t.analytics.sessions : 0 });
  return metrics;
}
const METRICS = buildMetricCatalog();
function getMetric(id) { return METRICS.find(m => m.id === id); }

function unitFamily(unit) { return (unit === 'eur' || unit === 'eur2') ? 'money' : 'other'; }

// ─── Campaign breakdown (per platform, for table widgets) ────────────────────
// Hergebruikt dezelfde addMetaRow/addGoogleRow/addPinterestRow-optellers als de
// KPI/grafiek-totalen, zodat elke campagne dezelfde velden krijgt (spend, clicks,
// conversies, bereik, ...) — dat maakt het mogelijk om in de tabelwidget vrij te
// kiezen welke kolommen getoond worden (zie TABLE_COLUMN_DEFS hieronder).
function buildCampaignBreakdown(platform, rows) {
  const addRow  = platform === 'meta' ? addMetaRow : platform === 'google' ? addGoogleRow : addPinterestRow;
  const nameOf  = r => {
    if (platform === 'meta')   return r.campaign_name || '(onbekend)';
    if (platform === 'google') return r['campaign.name'] || '(onbekend)';
    return r.CAMPAIGN_NAME || '(onbekend)';
  };
  const byCamp = {};
  rows.forEach(r => {
    const name = nameOf(r);
    if (!byCamp[name]) byCamp[name] = { name, ...emptyPlatformTotals() };
    addRow(byCamp[name], r);
  });
  return Object.values(byCamp)
    .map(v => ({
      ...v,
      ctr: v.impressions > 0 ? v.clicks / v.impressions * 100 : null,
      cpc: v.clicks > 0 ? v.spend / v.clicks : null,
      cpm: v.impressions > 0 ? v.spend / v.impressions * 1000 : null,
      roas: v.spend > 0 ? v.conversionsValue / v.spend : null,
      cpa: v.conversions > 0 ? v.spend / v.conversions : null,
    }))
    .sort((a, b) => b.spend - a.spend);
}

// Kolomcatalogus voor campagnetabellen: de eerste 5 staan standaard aan (het
// oude, vaste gedrag), de rest kan de marketeer per widget aanzetten via de
// widget-editor. "spend" heet bij Google "Kosten" i.p.v. "Uitgaven".
function tableColumnDefsFor(platform) {
  const spendLabel = platform === 'google' ? 'Kosten' : 'Uitgaven';
  const defs = [
    { key: 'impressions',      label: 'Impressies',      unit: 'count' },
    { key: 'clicks',           label: 'Clicks',          unit: 'count' },
    { key: 'ctr',              label: 'CTR',             unit: 'pct' },
    { key: 'spend',            label: spendLabel,        unit: 'eur' },
    { key: 'cpc',              label: 'CPC',             unit: 'eur2' },
    { key: 'cpm',              label: 'CPM',             unit: 'eur2' },
    { key: 'conversions',      label: 'Conversies',      unit: 'count' },
    { key: 'conversionsValue', label: 'Conversiewaarde', unit: 'eur' },
    { key: 'roas',             label: 'ROAS',            unit: 'ratio' },
    { key: 'cpa',              label: 'CPA',             unit: 'eur2' },
    { key: 'engagements',      label: 'Interacties',     unit: 'count' },
  ];
  if (platform === 'meta')      defs.push({ key: 'reach', label: 'Bereik', unit: 'count' }, { key: 'linkClicks', label: 'Linkclicks', unit: 'count' });
  if (platform === 'pinterest') defs.push({ key: 'reach', label: 'Bereik', unit: 'count' }, { key: 'saves', label: 'Saves', unit: 'count' });
  if (platform === 'google')    defs.push({ key: 'allConversions', label: 'Alle conversies (incl. view-through)', unit: 'count' });
  return defs;
}
const DEFAULT_TABLE_COLUMNS = ['impressions', 'clicks', 'ctr', 'spend', 'cpc'];

// Best verkochte producten (GA4 e-commerce items), voor de tabelwidget op de
// Analytics-pagina. Sorteert op aantal verkocht — dat is wat "meest verkocht"
// betekent voor de meeste marketeers, los van de omzet die het opleverde.
function buildAnalyticsProductBreakdown(rows) {
  const byItem = {};
  rows.forEach(r => {
    const name = r.itemName || '(onbekend)';
    if (!byItem[name]) byItem[name] = { name, itemsPurchased: 0, itemRevenue: 0 };
    byItem[name].itemsPurchased += parseFloat(r.itemsPurchased || 0);
    byItem[name].itemRevenue    += parseFloat(r.itemRevenue || 0);
  });
  return Object.values(byItem).sort((a, b) => b.itemsPurchased - a.itemsPurchased);
}

function tableColumnsFor(platform, widget) {
  if (platform === 'analytics') {
    return [
      { key: 'name', label: 'Product' },
      { label: 'Aantal verkocht', cls: 'num', render: r => fmt(r.itemsPurchased) },
      { label: 'Omzet',           cls: 'num', render: r => fmt(r.itemRevenue, 'eur') },
    ];
  }
  const defs   = tableColumnDefsFor(platform);
  const chosen = (widget?.tableColumns && widget.tableColumns.length) ? widget.tableColumns : DEFAULT_TABLE_COLUMNS;
  const cols   = [{ key: 'name', label: 'Campagne' }];
  chosen.forEach(key => {
    const def = defs.find(d => d.key === key);
    if (!def) return;
    cols.push({ label: def.label, cls: 'num', render: r => fmt(r[key], def.unit === 'count' ? undefined : def.unit) });
  });
  return cols;
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
const PAGE_KEYS = ['samenvatting', 'meta', 'google', 'pinterest', 'analytics'];

const ICON_GRIP = `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="3" r="1.15"/><circle cx="10" cy="3" r="1.15"/><circle cx="4" cy="7" r="1.15"/><circle cx="10" cy="7" r="1.15"/><circle cx="4" cy="11" r="1.15"/><circle cx="10" cy="11" r="1.15"/></svg>`;
const ICON_PENCIL = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5a1.5 1.5 0 012.12 2.12L5 13.25 2 14l.75-3L11.5 2.5z"/></svg>`;
const ICON_TRASH = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5M12.5 4.5l-.6 8.4a1.5 1.5 0 01-1.5 1.4h-4.8a1.5 1.5 0 01-1.5-1.4l-.6-8.4"/></svg>`;
const ICON_COPY = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.3"/><path d="M10.5 5.5V3.8a1.3 1.3 0 00-1.3-1.3H3.8a1.3 1.3 0 00-1.3 1.3v5.4a1.3 1.3 0 001.3 1.3h1.7"/></svg>`;
const ICON_PLUS = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M7 1.5v11M1.5 7h11"/></svg>`;
const ICON_CHECK = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 4.7"/></svg>`;

function widgetTypeLabel(type) { return { kpi: 'KPI-balk', chart: 'Grafiek', table: 'Tabel', yearly: 'Maandoverzicht', sheet: 'Gekoppeld sheet', demographics: 'Demografie' }[type] || type; }

// ─── Demografie & plaatsing (Meta) ────────────────────────────────────────────
// Elke uitsplitsing wordt via een eigen, losse query opgehaald (zie
// renderWidgetDemographics) — Meta's Insights API staat namelijk niet toe om
// demografie (leeftijd/geslacht) te combineren met platform/plaatsing/apparaat
// in dezelfde aanvraag. Los opvragen werkt voor elke combinatie en levert per
// aangevinkte optie een eigen taartdiagram op, naast elkaar in de widget.
const DEMO_DIM_DEFS = [
  { key: 'age',               label: 'Leeftijd',            fields: ['age'] },
  { key: 'gender',             label: 'Geslacht',            fields: ['gender'] },
  { key: 'age_gender',         label: 'Leeftijd + geslacht', fields: ['age', 'gender'] },
  { key: 'publisher_platform', label: 'Platform',            fields: ['publisher_platform'] },
  { key: 'platform_position',  label: 'Plaatsing',           fields: ['platform_position'] },
  { key: 'device_platform',    label: 'Apparaat',            fields: ['device_platform'] },
];
const DEMO_METRIC_DEFS = [
  { key: 'spend',       label: 'Uitgaven',   unit: 'eur' },
  { key: 'clicks',      label: 'Clicks',     unit: 'count' },
  { key: 'impressions', label: 'Impressies', unit: 'count' },
];
function translateGender(g) {
  const s = String(g || '').toLowerCase();
  if (s === 'female') return 'Vrouw';
  if (s === 'male')   return 'Man';
  if (!s || s === 'unknown') return 'Onbekend';
  return g;
}
// Compatibel met widgets van vóór de meerkeuze-uitbreiding, die nog een losse
// `breakdownDim` (string) hadden i.p.v. `breakdownDims` (array).
function widgetDemoDims(widget) {
  if (Array.isArray(widget?.breakdownDims) && widget.breakdownDims.length) return widget.breakdownDims;
  if (widget?.breakdownDim) return [widget.breakdownDim];
  return ['age_gender'];
}

function availableSheets() { return (currentClientSettings?.sheets || []); }

// Cache van sheet headers/rows binnen de widget-editor sessie, zodat we niet
// steeds opnieuw hoeven te fetchen als de marketeer filters aanpast.
const sheetPreviewCache = {};

async function loadSheetPreviewForEditor(linkId) {
  if (sheetPreviewCache[linkId]) return sheetPreviewCache[linkId];
  const r = await fetch(`/api/client-config/${currentClientId}/sheet-data/${linkId}`);
  const d = await r.json();
  if (!r.ok || !d.ok) throw new Error(d.error || 'Kon sheet niet laden.');
  const preview = { headers: d.headers || [], rows: d.rows || [] };
  sheetPreviewCache[linkId] = preview;
  return preview;
}

function onWidgetSheetChange() {
  const linkId = document.getElementById('widget-sheet-select')?.value;
  loadSheetColumnOptions(linkId, null);
}

const SHEET_FILTER_OPS = [
  { value: 'eq',       label: 'is gelijk aan' },
  { value: 'neq',      label: 'is niet gelijk aan' },
  { value: 'gt',       label: 'groter dan' },
  { value: 'gte',      label: 'groter dan of gelijk aan' },
  { value: 'lt',       label: 'kleiner dan' },
  { value: 'lte',      label: 'kleiner dan of gelijk aan' },
  { value: 'contains', label: 'bevat tekst' },
];

async function loadSheetColumnOptions(linkId, widget) {
  const wrap = document.getElementById('widget-sheet-columns-wrap');
  if (!wrap || !linkId) return;
  try {
    const preview = await loadSheetPreviewForEditor(linkId);
    const headers = preview.headers;
    if (!headers.length) {
      wrap.innerHTML = `<p class="widget-editor-hint">Dit sheet bevat nog geen data/kolomkoppen.</p>`;
      return;
    }
    const hidden     = new Set(widget?.sheetHiddenCols || []);
    const filterCol  = widget?.sheetFilterCol || '';
    const filterOp   = widget?.sheetFilterOp || 'eq';
    const filterVal  = widget?.sheetFilterValue || '';
    const hideEmpty  = !!widget?.sheetHideEmptyRows;

    wrap.innerHTML = `
      <div class="settings-row">
        <span class="settings-label">Zichtbare kolommen</span>
        <div class="metric-checklist">
          ${headers.map(h => `<label class="metric-check"><input type="checkbox" class="sheet-col-check" value="${escapeHtml(h)}" ${hidden.has(h) ? '' : 'checked'}/> ${escapeHtml(h || '(naamloos)')}</label>`).join('')}
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-label">Filter op rijen</span>
        <div class="sheet-filter-row">
          <select id="widget-sheet-filtercol">
            <option value="">Geen filter (alle rijen)</option>
            ${headers.map(h => `<option value="${escapeHtml(h)}" ${filterCol===h?'selected':''}>${escapeHtml(h)}</option>`).join('')}
          </select>
          <select id="widget-sheet-filterop">
            ${SHEET_FILTER_OPS.map(o => `<option value="${o.value}" ${filterOp===o.value?'selected':''}>${o.label}</option>`).join('')}
          </select>
          <input type="text" id="widget-sheet-filterval" class="settings-account-input" placeholder="bv. 2026" value="${escapeHtml(filterVal)}" />
        </div>
        <p class="widget-editor-hint">Getallen (zoals jaartallen) worden numeriek vergeleken; tekst wordt alfabetisch vergeleken. Laat de waarde leeg om het filter uit te zetten.</p>
      </div>
      <label class="settings-toggle-label">
        <input type="checkbox" id="widget-sheet-hideempty" ${hideEmpty ? 'checked' : ''}/>
        Verberg rijen zonder data (bv. toekomstige maanden)
      </label>
      <p class="widget-editor-hint">Tip: voor "2026 tm nu" filter je op de jaar/datumkolom met "groter dan of gelijk aan" en waarde 2026, en vink je "verberg rijen zonder data" aan.</p>`;
  } catch (err) {
    wrap.innerHTML = `<p class="widget-editor-hint" style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
  }
}

// ─── Vergelijking met vorig jaar (onder de widget-titel) ─────────────────────
function formatYoyDelta(current, previous) {
  const cur = current || 0, prev = previous || 0;
  if (!prev) {
    if (!cur) return { text: '—', cls: '' };
    return { text: 'nieuw', cls: 'wc-up' };
  }
  const pct = (cur - prev) / Math.abs(prev) * 100;
  if (Math.abs(pct) < 0.05) return { text: '± 0%', cls: '' };
  const arrow = pct > 0 ? '▲' : '▼';
  const cls   = pct > 0 ? 'wc-up' : 'wc-down';
  return { text: `${arrow} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, cls };
}

function defaultWidgetTitle(widget) {
  if (widget.type === 'yearly') return 'Maandoverzicht dit jaar';
  if (widget.type === 'table') {
    if (widget.platform === 'analytics') return 'Best verkochte producten';
    return `Campagnes — ${PLATFORM_META[widget.platform]?.label || widget.platform}`;
  }
  if (widget.type === 'demographics') {
    const dims        = widgetDemoDims(widget);
    const dimLabels   = dims.map(k => DEMO_DIM_DEFS.find(d => d.key === k)?.label || k);
    const metricLabel = DEMO_METRIC_DEFS.find(m => m.key === widget.metric)?.label || 'Uitgaven';
    if (dimLabels.length === 1) return `${metricLabel} per ${dimLabels[0].toLowerCase()} (Meta)`;
    return `${metricLabel} — ${dimLabels.join(', ')} (Meta)`;
  }
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
  const showCompare = !!widget.compareYoy && !!ctx?.previousYearTotals;
  return `<div class="kpi-strip">${metrics.map(m => {
    const compare = showCompare ? formatYoyDelta(m.total(ctx.totals), m.total(ctx.previousYearTotals)) : null;
    return `<div class="kpi-card">
      <div class="kpi-label">${m.label}</div>
      <div class="kpi-value">${fmtByUnit(m.total(ctx.totals), m.unit)}</div>
      ${compare ? `<div class="kpi-compare ${compare.cls}">${compare.text} <span class="kpi-compare-label">t.o.v. vorig jaar</span></div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function renderWidgetTableHtml(widget, ctx) {
  const platform = widget.platform || 'meta';
  const rows = ctx.campaignBreakdown[platform] || [];
  const cols = tableColumnsFor(platform, widget);
  if (!rows.length) {
    const emptyMsg = platform === 'analytics'
      ? 'Geen productverkopen gevonden in de geselecteerde periode (of dit GA4-property registreert geen e-commerce data).'
      : `Geen data voor ${PLATFORM_META[platform]?.label || platform} in de geselecteerde periode.`;
    return `<p class="widget-empty">${emptyMsg}</p>`;
  }
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
  const showCompare = !!widget.compareYoy && !!ctx?.previousYearSeriesData;
  const datasets = [];
  metrics.forEach((m, i) => {
    const axis = families.length > 1 ? (unitFamily(m.unit) === families[0] ? 'y' : 'y1') : 'y';
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    datasets.push({
      label: m.label,
      data: ctx.seriesData.days.map(d => { const v = m.daily(ctx.seriesData.byDay[d]); return v == null ? null : (unitFamily(m.unit) === 'money' ? v.toFixed(2) : v); }),
      borderColor: color, backgroundColor: color + '20', fill: metrics.length === 1, tension: 0.3, yAxisID: axis,
    });
    // Vergelijkingslijn: dezelfde metric, maar dan de waarde van exact één jaar
    // eerder (per kalenderdag uitgelijnd met de huidige x-as), gestippeld i.p.v.
    // als losse balk boven de grafiek.
    if (showCompare) {
      datasets.push({
        label: `${m.label} (vorig jaar)`,
        data: ctx.seriesData.days.map(d => {
          const row = ctx.previousYearSeriesData.byDay[shiftIsoDateYears(d, -1)];
          if (!row) return null;
          const v = m.daily(row);
          return v == null ? null : (unitFamily(m.unit) === 'money' ? v.toFixed(2) : v);
        }),
        borderColor: color, backgroundColor: 'transparent', borderDash: [5, 4], pointRadius: 0, fill: false, tension: 0.3, yAxisID: axis,
      });
    }
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
    const { headers, rows } = applySheetWidgetFilters(widget, d.headers || [], d.rows || []);
    el.innerHTML = renderSheetTableHtml(headers, rows);
  } catch (err) {
    el.innerHTML = `<p class="widget-empty">${escapeHtml(err.message)}</p>`;
  }
}

// Demografie-widget (Meta): net als de sheet-widget wordt de data pas na het
// renderen van de widget-shell opgehaald (los van de hoofd-Promise.allSettled
// in loadReport), want dit is optioneel. Voor elke aangevinkte uitsplitsing
// (leeftijd, platform, plaatsing, ...) komt er een eigen taartdiagram, elk met
// een eigen losse query — dat voorkomt de FB-beperking dat demografie niet
// gecombineerd kan worden met platform/plaatsing/apparaat in dezelfde aanvraag.
async function renderWidgetDemographics(widget) {
  const el = document.getElementById(`w-demo-${widget.id}`);
  if (!el) return;
  if (!currentClient?.meta) {
    el.innerHTML = `<p class="widget-empty">Geen Meta-koppeling voor deze klant.</p>`;
    return;
  }
  const dims   = widgetDemoDims(widget);
  const metric = widget.metric || 'spend';
  const unit   = DEMO_METRIC_DEFS.find(m => m.key === metric)?.unit || 'eur';

  el.innerHTML = `<div class="demo-pie-grid">${dims.map(dim => `
    <div class="demo-pie-item">
      <div class="demo-pie-title">${escapeHtml(DEMO_DIM_DEFS.find(d => d.key === dim)?.label || dim)}</div>
      <div id="w-demo-${widget.id}-${dim}" class="demo-pie-body"><p class="widget-empty">Laden…</p></div>
    </div>`).join('')}</div>`;

  const dateRange = getPeriodApiDateRange();
  await Promise.all(dims.map(async dim => {
    const target = document.getElementById(`w-demo-${widget.id}-${dim}`);
    if (!target) return;
    try {
      const grouped = await fetchDemographicsBreakdown(currentClient, dim, metric, dateRange);
      if (!grouped.length) {
        target.innerHTML = `<p class="widget-empty">Geen data in de geselecteerde periode.</p>`;
        return;
      }
      const canvasId = `w-demo-canvas-${widget.id}-${dim}`;
      target.innerHTML = `<canvas id="${canvasId}"></canvas>`;
      makePieChart(canvasId, grouped, unit);
    } catch (err) {
      target.innerHTML = `<p class="widget-empty">${escapeHtml(err.message)}</p>`;
    }
  }));
}

async function fetchDemographicsBreakdown(client, dim, metric, dateRange) {
  const def = DEMO_DIM_DEFS.find(d => d.key === dim);
  const dimFields = def?.fields || [dim];
  const d = await apiPost('/api/query', {
    integration_id: 'facebook_ads', connection_key: client.meta.connection_key, account_id: client.meta.account_id,
    settings: { attribution_window: 'ATTRIBUTION_MODEL_VIEW_CLICK###VIEW_ATTRIBUTION_WINDOW_1D###CLICK_ATTRIBUTION_WINDOW_7D' },
    fields: [...dimFields, 'impressions', 'clicks', 'spend'],
    date_range: dateRange, limit: 200,
  });
  return groupDemographicsRows(d.data?.rows || [], dim, metric);
}

function groupDemographicsRows(rows, dim, metric) {
  const by = {};
  rows.forEach(r => {
    let label;
    if (dim === 'age')         label = r.age || 'Onbekend';
    else if (dim === 'gender') label = translateGender(r.gender);
    else if (dim === 'age_gender') label = `${r.age || 'Onbekend'} · ${translateGender(r.gender)}`;
    else {
      const def = DEMO_DIM_DEFS.find(d => d.key === dim);
      label = r[def?.fields[0] || dim] || 'Onbekend';
    }
    by[label] = (by[label] || 0) + parseFloat(r[metric] || 0);
  });
  return Object.entries(by)
    .map(([label, value]) => ({ label, value }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value);
}

function makePieChart(canvasId, data, unit) {
  destroyChart(canvasId);
  const ctxEl = document.getElementById(canvasId)?.getContext('2d');
  if (!ctxEl) return;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  charts[canvasId] = new Chart(ctxEl, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.label),
      datasets: [{ data: data.map(d => d.value), backgroundColor: CHART_PALETTE, borderWidth: 0, borderRadius: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: true, aspectRatio: 1.25,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 7, boxHeight: 7, font: { size: 10.5, family: "'Inter', sans-serif", weight: '500' }, color: '#1c1b1a', padding: 8 },
        },
        tooltip: {
          backgroundColor: '#1c1b1a', titleFont: { size: 12, family: "'Inter', sans-serif", weight: '600' }, bodyFont: { size: 12, family: "'Inter', sans-serif" },
          padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true, borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
          callbacks: {
            label: c => {
              const pct = total > 0 ? (c.parsed / total * 100).toFixed(1) : '0';
              return ` ${c.label}: ${fmt(c.parsed, unit)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

// Past kolomselectie ("Zichtbare kolommen"), rijfilter ("Filter op rijen":
// kolom + vergelijking + waarde) en het verbergen van lege rijen toe zoals
// ingesteld in de widget-editor. Werkt op de ruwe headers/rows zoals ze uit
// het sheet komen.
function applySheetWidgetFilters(widget, headers, rows) {
  const hiddenSet   = new Set(widget.sheetHiddenCols || []);
  const visibleIdx  = headers.map((_, i) => i).filter(i => !hiddenSet.has(headers[i]));

  let filteredRows = rows;
  const filterCol = widget.sheetFilterCol;
  const filterOp  = widget.sheetFilterOp || 'eq';
  const filterVal = widget.sheetFilterValue;
  if (filterCol && filterVal !== undefined && filterVal !== '') {
    const colIdx = headers.indexOf(filterCol);
    if (colIdx >= 0) {
      filteredRows = filteredRows.filter(r => compareSheetCell(r[colIdx], filterOp, filterVal));
    }
  }
  if (widget.sheetHideEmptyRows) {
    // Eerste kolom is meestal het label (bv. maandnaam) — die telt niet mee,
    // zo blijven toekomstige maanden zonder ingevulde data automatisch weg.
    filteredRows = filteredRows.filter(r => r.slice(1).some(cell => String(cell ?? '').trim() !== ''));
  }

  return {
    headers: visibleIdx.map(i => headers[i]),
    rows: filteredRows.map(r => visibleIdx.map(i => r[i])),
  };
}

// Vergelijkt een sheet-celwaarde met de ingestelde filterwaarde. Als beide
// er numeriek uitzien (bv. jaartallen "2026", of bedragen met een komma als
// decimaalteken) wordt numeriek vergeleken, anders tekstueel/alfabetisch.
function compareSheetCell(cell, op, filterVal) {
  const cellStr   = String(cell ?? '').trim();
  const filterStr = String(filterVal ?? '').trim();
  const numPattern = /^-?\d+([.,]\d+)?$/;
  const bothNumeric = numPattern.test(cellStr) && numPattern.test(filterStr);
  const cellNum   = bothNumeric ? parseFloat(cellStr.replace(',', '.')) : null;
  const filterNum = bothNumeric ? parseFloat(filterStr.replace(',', '.')) : null;
  const cellCmp   = bothNumeric ? cellNum : cellStr.toLowerCase();
  const filterCmp = bothNumeric ? filterNum : filterStr.toLowerCase();

  switch (op) {
    case 'eq':       return cellCmp === filterCmp;
    case 'neq':      return cellCmp !== filterCmp;
    case 'gt':       return cellCmp > filterCmp;
    case 'gte':      return cellCmp >= filterCmp;
    case 'lt':       return cellCmp < filterCmp;
    case 'lte':      return cellCmp <= filterCmp;
    case 'contains': return cellStr.toLowerCase().includes(filterStr.toLowerCase());
    default:         return true;
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
  else if (widget.type === 'demographics') bodyHtml = `<div id="w-demo-${widget.id}" class="widget-sheet-loading">Laden…</div>`;
  else bodyHtml = '';

  const showEditBtn = widget.type !== 'yearly';
  wrap.innerHTML = `
    <div class="widget-header">
      <span class="widget-drag-handle edit-only" title="Verplaatsen">${ICON_GRIP}</span>
      <span class="widget-title">${escapeHtml(widget.title || defaultWidgetTitle(widget))}</span>
      <span class="widget-toolbar-actions edit-only">
        ${showEditBtn ? `<button class="widget-icon-btn" onclick="openWidgetEditor('${pageKey}','${widget.id}')" title="Bewerken">${ICON_PENCIL}</button>` : ''}
        <button class="widget-icon-btn" onclick="duplicateWidget('${pageKey}','${widget.id}')" title="Dupliceren">${ICON_COPY}</button>
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
  const demoWidgets  = [];
  widgets.forEach(w => {
    const el = buildWidgetElement(w, currentReportCtx, pageKey);
    container.appendChild(el);
    if (w.type === 'chart') chartWidgets.push(w);
    if (w.type === 'sheet') sheetWidgets.push(w);
    if (w.type === 'demographics') demoWidgets.push(w);
  });
  chartWidgets.forEach(w => renderWidgetChart(w, currentReportCtx));
  sheetWidgets.forEach(renderWidgetSheet);
  demoWidgets.forEach(renderWidgetDemographics);
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

function hasAnalytics() { return !!(currentClient && currentClient.analytics); }

function availableMetricGroups() {
  const platforms = ['total', ...availablePlatforms()];
  const groups = platforms.map(p => ({ platform: p, label: PLATFORM_META[p].label, metrics: METRICS.filter(m => m.platform === p) }));
  if (hasAnalytics()) groups.push({ platform: 'analytics', label: PLATFORM_META.analytics.label, metrics: METRICS.filter(m => m.platform === 'analytics') });
  return groups;
}

function addWidget(pageKey) { openWidgetEditor(pageKey, null); }

function removeWidget(pageKey, widgetId) {
  currentLayout[pageKey] = (currentLayout[pageKey] || []).filter(w => w.id !== widgetId);
  renderPageWidgets(pageKey);
}

function duplicateWidget(pageKey, widgetId) {
  const widgets = currentLayout[pageKey] || [];
  const idx = widgets.findIndex(w => w.id === widgetId);
  if (idx === -1) return;
  const copy = JSON.parse(JSON.stringify(widgets[idx]));
  copy.id = 'w_' + Math.random().toString(36).slice(2, 10);
  copy.title = (widgets[idx].title || defaultWidgetTitle(widgets[idx])) + ' (kopie)';
  currentLayout[pageKey] = [...widgets.slice(0, idx + 1), copy, ...widgets.slice(idx + 1)];
  renderPageWidgets(pageKey);
  showToast('Widget gedupliceerd ✓');
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
    const selectedId = widget?.sheetLinkId || sheets[0].id;
    el.innerHTML = `
      <label class="settings-row"><span class="settings-label">Sheet</span>
        <select id="widget-sheet-select" onchange="onWidgetSheetChange()">${sheets.map(s => `<option value="${s.id}" ${selectedId===s.id?'selected':''}>${escapeHtml(s.label || 'Sheet')}</option>`).join('')}</select>
      </label>
      <p class="widget-editor-hint">Live vanuit het sheet — wijzigingen daar komen automatisch in het rapport (binnen enkele minuten).</p>
      <div id="widget-sheet-columns-wrap"><p class="widget-editor-hint">Kolommen laden…</p></div>`;
    loadSheetColumnOptions(selectedId, widget);
    return;
  }
  if (type === 'table') {
    const platforms = [...availablePlatforms(), ...(hasAnalytics() ? ['analytics'] : [])];
    if (!platforms.length) { el.innerHTML = `<p class="widget-editor-hint">Deze klant heeft nog geen gekoppelde platformen.</p>`; return; }
    const selectedPlatform = widget?.platform && platforms.includes(widget.platform) ? widget.platform : platforms[0];
    el.innerHTML = `<label class="settings-row"><span class="settings-label">Platform</span>
      <select id="widget-platform-select" onchange="onTablePlatformChange()">${platforms.map(p => `<option value="${p}" ${selectedPlatform===p?'selected':''}>${PLATFORM_META[p].label}</option>`).join('')}</select>
    </label>
    <div id="widget-table-columns-wrap"></div>`;
    renderTableColumnsFields(selectedPlatform, widget);
    return;
  }
  if (type === 'demographics') {
    if (!currentClient?.meta) { el.innerHTML = `<p class="widget-editor-hint">Deze klant heeft geen Meta-koppeling.</p>`; return; }
    const dims   = new Set(widgetDemoDims(widget || {}));
    const metric = widget?.metric || 'spend';
    el.innerHTML = `
      <div class="settings-label" style="margin-bottom:6px;">Uitsplitsen op (kies er één of meer)</div>
      <div class="metric-checklist">
        ${DEMO_DIM_DEFS.map(d => `<label class="metric-check"><input type="checkbox" class="widget-demo-dim-check" value="${d.key}" ${dims.has(d.key)?'checked':''}/> ${escapeHtml(d.label)}</label>`).join('')}
      </div>
      <label class="settings-row" style="margin-top:12px;"><span class="settings-label">Metric</span>
        <select id="widget-demo-metric-select">${DEMO_METRIC_DEFS.map(m => `<option value="${m.key}" ${metric===m.key?'selected':''}>${m.label}</option>`).join('')}</select>
      </label>
      <p class="widget-editor-hint">Voor elke aangevinkte uitsplitsing komt er een eigen taartdiagram naast elkaar te staan.</p>`;
    return;
  }
  // kpi / chart: metric checklist grouped by platform, plus een dropdown per
  // platform om verder te putten uit alle overige beschikbare metrics.
  const selected = new Set(widget?.metrics || []);
  const groups = availableMetricGroups();
  el.innerHTML = `<div class="settings-label" style="margin-bottom:6px;">Metrics</div>` +
    groups.map(g => renderMetricGroupHtml(g, selected)).join('') +
    `<label class="settings-toggle-label" style="margin-top:12px;">
      <input type="checkbox" id="widget-compare-yoy" ${widget?.compareYoy ? 'checked' : ''}/>
      Vergelijk met dezelfde periode vorig jaar
    </label>
    <p class="widget-editor-hint">De vergelijking wordt onder de widgettitel getoond (bv. "▲ +12,4%"). Let op: Pinterest levert door een limiet van de Pinterest API geen data van meer dan 90 dagen terug, dus die vergelijking blijft daar leeg.</p>`;
}

function renderMetricGroupHtml(g, selectedIds) {
  const baseMetrics    = g.metrics.filter(m => !m.extra);
  const selectedExtra  = g.metrics.filter(m => m.extra && selectedIds.has(m.id));
  const availableExtra = g.metrics.filter(m => m.extra && !selectedIds.has(m.id));
  return `
    <div class="metric-group" data-platform="${g.platform}">
      <div class="metric-group-title">${g.label}</div>
      <div class="metric-checklist">
        ${baseMetrics.map(m => `<label class="metric-check"><input type="checkbox" value="${m.id}" ${selectedIds.has(m.id)?'checked':''}/> ${escapeHtml(m.shortLabel)}</label>`).join('')}
        ${selectedExtra.map(m => `<label class="metric-check metric-check-extra"><input type="checkbox" value="${m.id}" checked/> ${escapeHtml(m.shortLabel)} <button type="button" class="metric-remove-btn" title="Verwijderen" onclick="this.closest('label').remove()">×</button></label>`).join('')}
      </div>
      ${availableExtra.length ? `
      <div class="metric-more-row">
        <select class="metric-more-select" onchange="onAddExtraMetric(this)">
          <option value="">+ Meer metrics toevoegen…</option>
          ${availableExtra.map(m => `<option value="${m.id}">${escapeHtml(m.shortLabel)}</option>`).join('')}
        </select>
      </div>` : ''}
    </div>`;
}

function onAddExtraMetric(selectEl) {
  const id = selectEl.value;
  if (!id) return;
  const m = getMetric(id);
  if (!m) return;
  const checklist = selectEl.closest('.metric-group')?.querySelector('.metric-checklist');
  if (checklist) {
    const label = document.createElement('label');
    label.className = 'metric-check metric-check-extra';
    label.innerHTML = `<input type="checkbox" value="${m.id}" checked/> ${escapeHtml(m.shortLabel)} <button type="button" class="metric-remove-btn" title="Verwijderen">×</button>`;
    label.querySelector('.metric-remove-btn').addEventListener('click', () => label.remove());
    checklist.appendChild(label);
  }
  selectEl.querySelector(`option[value="${CSS.escape(id)}"]`)?.remove();
  selectEl.value = '';
}

// Kolommenkeuze voor de campagnetabel-widget: toont per platform de volledige
// catalogus als checklist. Alleen relevant voor meta/google/pinterest — een
// analytics-tabel toont altijd producten en heeft geen te kiezen kolommen.
function renderTableColumnsFields(platform, widget) {
  const wrap = document.getElementById('widget-table-columns-wrap');
  if (!wrap) return;
  if (platform === 'analytics') {
    wrap.innerHTML = `<p class="widget-editor-hint">Toont automatisch de best verkochte producten (aantal verkocht + omzet). Geen kolommen te kiezen.</p>`;
    return;
  }
  const defs   = tableColumnDefsFor(platform);
  const chosen = new Set((widget?.platform === platform && widget?.tableColumns?.length) ? widget.tableColumns : DEFAULT_TABLE_COLUMNS);
  wrap.innerHTML = `
    <div class="settings-label" style="margin-top:12px; margin-bottom:6px;">Kolommen</div>
    <div class="metric-checklist">
      ${defs.map(d => `<label class="metric-check"><input type="checkbox" class="widget-table-col-check" value="${d.key}" ${chosen.has(d.key)?'checked':''}/> ${escapeHtml(d.label)}</label>`).join('')}
    </div>
    <p class="widget-editor-hint">Bijv. ROAS voor een webshop, of CPA en conversies voor een leadklant.</p>`;
}

function onTablePlatformChange() {
  const platform = document.getElementById('widget-platform-select')?.value;
  const widget = editingWidgetCtx?.widgetId ? (currentLayout[editingWidgetCtx.pageKey] || []).find(w => w.id === editingWidgetCtx.widgetId) : null;
  renderTableColumnsFields(platform, widget);
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

  // Velden die alleen bij één widgettype horen — bij elk type opnieuw opbouwen
  // voorkomt dat oude instellingen van een eerder gekozen type blijven hangen.
  delete widget.metrics; delete widget.platform; delete widget.sheetLinkId; delete widget.compareYoy;
  delete widget.tableColumns; delete widget.breakdownDim; delete widget.breakdownDims; delete widget.metric;

  if (type === 'table') {
    widget.platform = document.getElementById('widget-platform-select')?.value || availablePlatforms()[0] || 'meta';
    const chosenCols = [...document.querySelectorAll('.widget-table-col-check:checked')].map(c => c.value);
    if (widget.platform !== 'analytics' && chosenCols.length) widget.tableColumns = chosenCols;
  } else if (type === 'demographics') {
    const chosenDims = [...document.querySelectorAll('.widget-demo-dim-check:checked')].map(c => c.value);
    widget.breakdownDims = chosenDims.length ? chosenDims : ['age_gender'];
    widget.metric        = document.getElementById('widget-demo-metric-select')?.value || 'spend';
  } else if (type === 'yearly') {
    // geen extra instellingen
  } else if (type === 'sheet') {
    widget.sheetLinkId = document.getElementById('widget-sheet-select')?.value || null;
    const hiddenCols = [...document.querySelectorAll('.sheet-col-check')].filter(c => !c.checked).map(c => c.value);
    widget.sheetHiddenCols    = hiddenCols;
    widget.sheetFilterCol     = document.getElementById('widget-sheet-filtercol')?.value || '';
    widget.sheetFilterOp      = document.getElementById('widget-sheet-filterop')?.value || 'eq';
    widget.sheetFilterValue   = document.getElementById('widget-sheet-filterval')?.value?.trim() || '';
    widget.sheetHideEmptyRows = !!document.getElementById('widget-sheet-hideempty')?.checked;
  } else {
    const checked = [...document.querySelectorAll('#widget-editor-fields .metric-checklist input[type=checkbox]:checked')].map(c => c.value);
    widget.metrics = [...new Set(checked)];
    widget.compareYoy = !!document.getElementById('widget-compare-yoy')?.checked;
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
    { id: 'def-meta-demo',  type: 'demographics', breakdownDims: ['age_gender'], metric: 'spend' },
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
  analytics: [
    { id: 'def-an-kpi',      type: 'kpi', title: 'KPI-overzicht', metrics: ['analytics.sessions', 'analytics.activeUsers', 'analytics.engagementRate', 'analytics.keyEvents'] },
    { id: 'def-an-sessions', type: 'chart', title: 'Sessies en gebruikers per dag', metrics: ['analytics.sessions', 'analytics.activeUsers'] },
    { id: 'def-an-conv',     type: 'chart', title: 'Conversies per dag', metrics: ['analytics.keyEvents'] },
    { id: 'def-an-products', type: 'table', platform: 'analytics' },
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
  const client = applyAccountOverrides(baseClient, currentClientSettings?.accountOverrides, currentClientSettings?.analytics);
  currentClient = client;
  currentClientId = clientId;

  document.getElementById('header-client').textContent = client.name;
  const sep = document.getElementById('header-client-sep');
  if (sep) sep.style.display = '';
  document.getElementById('setup-notice').classList.add('hidden');

  // Update sidebar based on client platforms + settings
  updateSidebarForClient(client, currentClientSettings?.platforms);
  renderPromoPages();

  currentLayout = resolveLayout(currentClientSettings?.reportLayout);
  setEditMode(false);
  setLoading(true);

  const dateRange     = getPeriodApiDateRange();
  const yd            = computePeriodDates('thisyear');
  const yearDateRange = yd ? { preset: 'custom', start: yd.start, end: yd.end } : dateRange;
  const prevYearRange = previousYearDateRange(dateRange);

  try {
    const [metaRes, googleRes, pintRes, analyticsRes, analyticsProductsRes, metaYear, googleYear, pintYear, metaPrev, googlePrev, pintPrev] = await Promise.allSettled([
      loadMeta(client, dateRange), loadGoogle(client, dateRange), loadPinterest(client, dateRange), loadAnalytics(client, dateRange), loadAnalyticsProducts(client, dateRange),
      loadMeta(client, yearDateRange), loadGoogle(client, yearDateRange), loadPinterestYearly(client, yearDateRange),
      loadMeta(client, prevYearRange), loadGoogle(client, prevYearRange), loadPinterest(client, prevYearRange),
    ]);

    const ok = r => r.status === 'fulfilled' ? r.value : [];
    const metaRows = ok(metaRes), googleRows = ok(googleRes), pintRows = ok(pintRes), analyticsRows = ok(analyticsRes);

    const allResults = [metaRes, googleRes, pintRes, metaYear, googleYear, pintYear];
    const allLabels  = ['Meta', 'Google', 'Pinterest', 'Meta (jaar)', 'Google (jaar)', 'Pinterest (jaar)'];
    const errs = allResults.map((r,i)=>r.status==='rejected'?allLabels[i]+': '+r.reason?.message:null).filter(Boolean);
    if (client.analytics && analyticsRes.status === 'rejected') errs.push('Analytics: ' + (analyticsRes.reason?.message || 'onbekende fout'));
    // Alleen los melden als de "gewone" analytics-query wél lukte — anders is het
    // gewoon dezelfde AUTH_EXPIRED-fout die al hierboven getoond wordt.
    if (client.analytics && analyticsRes.status !== 'rejected' && analyticsProductsRes.status === 'rejected') errs.push('Analytics producten: ' + (analyticsProductsRes.reason?.message || 'onbekende fout'));
    if (errs.length) showError(errs.join(' | '));
    // Fouten bij het ophalen van "vorig jaar" (bv. Pinterest, dat > 90 dagen terug
    // toch al niets teruggeeft) tellen niet als harde fout — de vergelijking valt
    // dan simpelweg terug op "n.b." in de widget.

    const periodInfo  = computePeriodDates(selectedPeriod);
    const periodLabel = selectedPeriod==='custom' ? `${fmtDisplayDate(customStartDate)} – ${fmtDisplayDate(customEndDate)}` : (PERIODS.find(p=>p.value===selectedPeriod)?.label||selectedPeriod);

    document.getElementById('kpi-heading').textContent = 'Samenvatting — ' + client.name;
    document.getElementById('kpi-sub').textContent     = 'Periode: ' + periodLabel + (periodInfo?` (${periodInfo.days} dagen)`:'')+' · alle gekoppelde platformen';

    currentReportCtx = {
      seriesData: buildDailySeries(metaRows, googleRows, pintRows, analyticsRows),
      previousYearSeriesData: buildDailySeries(ok(metaPrev), ok(googlePrev), ok(pintPrev)),
      totals: aggregateTotals(metaRows, googleRows, pintRows, analyticsRows),
      previousYearTotals: aggregateTotals(ok(metaPrev), ok(googlePrev), ok(pintPrev)),
      campaignBreakdown: {
        meta: buildCampaignBreakdown('meta', metaRows),
        google: buildCampaignBreakdown('google', googleRows),
        pinterest: buildCampaignBreakdown('pinterest', pintRows),
        analytics: buildAnalyticsProductBreakdown(ok(analyticsProductsRes)),
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
