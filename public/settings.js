// ─── State ────────────────────────────────────────────────────────────────────
let currentSettings = { clients: {} };

// Track which password fields were explicitly changed
const pwChanged = {};


const PLATFORM_LABELS = { meta: 'Meta Ads', google: 'Google Ads', pinterest: 'Pinterest Ads' };
const PLATFORM_BADGE_CLASS = { meta: 'badge-meta', google: 'badge-google', pinterest: 'badge-pinterest' };

// Lokale (niet-opgeslagen) staat van het "sheet koppelen"-formulier, per klant.
const pendingSheetAdd = {};

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  try {
    const r = await fetch('/api/settings');
    currentSettings = await r.json();
  } catch {
    currentSettings = { clients: {} };
  }
  renderAll();
})();

// ─── Render all clients ───────────────────────────────────────────────────────
function renderAll() {
  const list = document.getElementById('settings-list');
  if (!list) return;
  if (!CLIENTS || !CLIENTS.length) {
    list.innerHTML = '<div style="padding:48px;text-align:center;color:var(--text-muted)">Geen klanten gevonden in clients.js</div>';
    return;
  }
  list.innerHTML = CLIENTS.map(client => renderClientCard(client)).join('');
}

function renderClientCard(client) {
  const saved    = currentSettings.clients?.[client.id] || {};
  const origin   = window.location.origin;
  const shareUrl = `${origin}/r/${client.id}`;

  // Which platforms this client has configured in clients.js
  const clientPlatforms = ['meta', 'google', 'pinterest'].filter(p => !!client[p]);

  // Platform visibility from settings (default: all configured platforms visible)
  const platformVis = saved.platforms || {};
  const accountOverrides = saved.accountOverrides || {};

  const badges = clientPlatforms.map(p =>
    `<span class="badge ${PLATFORM_BADGE_CLASS[p]}">${p}</span>`
  ).join('');

  const platformToggles = clientPlatforms.map(p => {
    const isEnabled = platformVis[p] !== false; // default true
    return `
      <label class="settings-toggle-label">
        <input type="checkbox" id="plt-${p}-${client.id}" ${isEnabled ? 'checked' : ''}
               onchange="onPlatformToggle('${client.id}','${p}',this.checked)" />
        ${PLATFORM_LABELS[p]}
      </label>`;
  }).join('');

  const accountRows = clientPlatforms.map(p => {
    const defaultId = client[p]?.account_id || '';
    const override  = accountOverrides[p] || '';
    return `
      <div class="settings-account-row">
        <label>${p}</label>
        <input class="settings-account-input" id="acc-${p}-${client.id}"
               value="${escHtml(override || defaultId)}"
               placeholder="${escHtml(defaultId)}"
               data-default="${escHtml(defaultId)}" />
      </div>`;
  }).join('');

  const hasPassword = !!saved._hasPassword || saved.password === '••••••••';

  return `
    <div class="settings-card" id="card-${client.id}">
      <div class="settings-card-header">
        <h2>${escHtml(client.name)}</h2>
        <div class="settings-badges">${badges}</div>
      </div>
      <div class="settings-body">

        <!-- Klantlink -->
        <div class="settings-row">
          <div class="settings-label">Klantlink</div>
          <div class="settings-link-row">
            <input class="settings-link-input" readonly value="${escHtml(shareUrl)}" id="link-${client.id}" />
            <button class="settings-copy-btn" onclick="copyLink('${client.id}')">Kopieer link</button>
          </div>
        </div>

        <!-- Wachtwoord -->
        <div class="settings-row">
          <div class="settings-label">Wachtwoord</div>
          <div class="settings-pw-row">
            <input type="text" class="settings-pw-input${hasPassword ? ' has-value' : ''}"
                   id="pw-${client.id}"
                   placeholder="${hasPassword ? '••••••••' : 'Geen wachtwoord (open toegang)'}"
                   autocomplete="off"
                   oninput="onPwInput('${client.id}')" />
            <button class="btn-sm" onclick="generatePw('${client.id}')">Genereer</button>
            <button class="btn-sm btn-sm-danger" onclick="resetPw('${client.id}')">Reset</button>
          </div>
          <div class="settings-pw-hint" id="pw-hint-${client.id}">
            ${hasPassword ? 'Er is een wachtwoord ingesteld. Vul een nieuw wachtwoord in om te wijzigen.' : 'Laat leeg voor vrije toegang.'}
          </div>
        </div>

        <!-- Zichtbare rapporten -->
        ${clientPlatforms.length > 1 ? `
        <div class="settings-row">
          <div class="settings-label">Zichtbare rapporten</div>
          <div class="settings-toggles">
            ${platformToggles}
          </div>
        </div>` : ''}

        <!-- Account IDs -->
        ${clientPlatforms.length ? `
        <details class="settings-accounts">
          <summary>Account IDs aanpassen</summary>
          <div class="settings-accounts-body">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">
              Pas alleen aan als de automatische koppeling niet klopt. Laat leeg om de standaard waarde te gebruiken.
            </div>
            ${accountRows}
          </div>
        </details>` : ''}

        <!-- Gekoppelde sheets -->
        <div class="settings-row">
          <div class="settings-label">Gekoppelde sheets</div>
          ${renderSheetsSection(client.id, saved)}
        </div>

      </div>
    </div>`;
}

// ─── Google Sheets koppelen ────────────────────────────────────────────────────
function renderSheetsSection(clientId, saved) {
  const sheets  = saved.sheets || [];
  const pending = pendingSheetAdd[clientId] || {};

  const rows = sheets.map(s => `
    <div class="sheet-row">
      <div class="sheet-row-info">
        <strong>${escHtml(s.label || 'Sheet')}</strong>
        ${s.tabName ? `<span>${escHtml(s.tabName)}</span>` : ''}
      </div>
      <button class="btn-sm btn-sm-danger" onclick="removeSheet('${clientId}','${s.id}')">Verwijderen</button>
    </div>`).join('');

  let formHtml;
  if (pending.step === 'resolved') {
    formHtml = `
      <div class="sheet-add-form">
        <div class="sheet-resolved-title">Gevonden: <strong>${escHtml(pending.title)}</strong></div>
        <label class="settings-row">
          <span class="settings-label">Tabblad</span>
          <select id="sheet-tab-${clientId}">
            ${pending.tabs.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('')}
          </select>
        </label>
        <label class="settings-row">
          <span class="settings-label">Naam in rapport (optioneel)</span>
          <input type="text" class="settings-account-input" id="sheet-label-${clientId}" placeholder="${escHtml(pending.title)}" />
        </label>
        <div class="sheet-add-actions">
          <button class="btn-sm" onclick="cancelAddSheet('${clientId}')">Annuleren</button>
          <button class="btn-primary" onclick="confirmAddSheet('${clientId}')">Sheet toevoegen</button>
        </div>
      </div>`;
  } else {
    formHtml = `
      <div class="sheet-add-form">
        <div class="settings-link-row">
          <input type="text" class="settings-link-input" id="sheet-url-${clientId}" placeholder="Plak hier de Google Sheets-link…" value="${escHtml(pending.url || '')}" ${pending.loading ? 'disabled' : ''} />
          <button class="settings-copy-btn" onclick="resolveSheet('${clientId}')" ${pending.loading ? 'disabled' : ''}>${pending.loading ? 'Bezig…' : 'Koppelen'}</button>
        </div>
        ${pending.error ? `<div class="settings-pw-hint" style="color:var(--danger)">${escHtml(pending.error)}</div>` : ''}
      </div>`;
  }

  return `
    <div class="sheets-list">${rows || '<div class="sheets-empty">Nog geen sheets gekoppeld.</div>'}</div>
    ${formHtml}`;
}

async function resolveSheet(clientId) {
  const input = document.getElementById(`sheet-url-${clientId}`);
  const url = input?.value?.trim();
  if (!url) return;
  pendingSheetAdd[clientId] = { url, loading: true, error: null };
  renderAll();
  try {
    const r = await fetch('/api/sheets/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || 'Kon sheet niet koppelen.');
    pendingSheetAdd[clientId] = {
      step: 'resolved', url, sheetId: d.sheetId, title: d.title,
      tabs: d.tabs.length ? d.tabs : ['Blad1'], loading: false, error: null,
    };
  } catch (err) {
    pendingSheetAdd[clientId] = { url, loading: false, error: err.message };
  }
  renderAll();
}

function cancelAddSheet(clientId) {
  delete pendingSheetAdd[clientId];
  renderAll();
}

async function confirmAddSheet(clientId) {
  const pending = pendingSheetAdd[clientId];
  if (!pending) return;
  const tabName = document.getElementById(`sheet-tab-${clientId}`)?.value || pending.tabs[0];
  const label   = document.getElementById(`sheet-label-${clientId}`)?.value?.trim() || pending.title;
  const saved   = currentSettings.clients?.[clientId] || {};
  const sheets  = [...(saved.sheets || []), {
    id: 'sheet-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label, sheetId: pending.sheetId, tabName,
  }];
  delete pendingSheetAdd[clientId];
  await saveSheets(clientId, sheets);
}

async function removeSheet(clientId, sheetLinkId) {
  const saved  = currentSettings.clients?.[clientId] || {};
  const sheets = (saved.sheets || []).filter(s => s.id !== sheetLinkId);
  await saveSheets(clientId, sheets);
}

async function saveSheets(clientId, sheets) {
  try {
    const r = await fetch(`/api/client-config/${clientId}/sheets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheets }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error('Opslaan mislukt.');
    if (!currentSettings.clients) currentSettings.clients = {};
    currentSettings.clients[clientId] = { ...(currentSettings.clients[clientId] || {}), sheets };
  } catch (err) {
    alert('Fout bij opslaan van sheet: ' + err.message);
  }
  renderAll();
}

// ─── Event handlers ───────────────────────────────────────────────────────────
function onPwInput(clientId) {
  pwChanged[clientId] = true;
  const input = document.getElementById(`pw-${clientId}`);
  const hint  = document.getElementById(`pw-hint-${clientId}`);
  if (input.value) {
    hint.textContent = 'Nieuw wachtwoord wordt opgeslagen bij "Opslaan".';
    hint.className = 'settings-pw-hint active';
  } else {
    hint.textContent = 'Laat leeg voor vrije toegang.';
    hint.className = 'settings-pw-hint';
  }
}

function onPlatformToggle(clientId, platform, enabled) {
  // Visual feedback — no immediate save
}

function generatePw(clientId) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pw    = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const input = document.getElementById(`pw-${clientId}`);
  const hint  = document.getElementById(`pw-hint-${clientId}`);
  input.value = pw;
  input.type  = 'text';
  input.classList.add('has-value');
  pwChanged[clientId] = true;
  hint.textContent = `Gegenereerd wachtwoord: ${pw} — sla op en deel dit met de klant.`;
  hint.className = 'settings-pw-hint active';

  // Auto-copy
  navigator.clipboard?.writeText(pw).catch(() => {});
}

function resetPw(clientId) {
  const input = document.getElementById(`pw-${clientId}`);
  const hint  = document.getElementById(`pw-hint-${clientId}`);
  input.value = '';
  input.placeholder = 'Geen wachtwoord (open toegang)';
  input.classList.remove('has-value');
  pwChanged[clientId] = 'reset'; // signal explicit reset
  hint.textContent = 'Wachtwoord wordt verwijderd bij "Opslaan". De link wordt daarna openbaar.';
  hint.className = 'settings-pw-hint';
}

function copyLink(clientId) {
  const input = document.getElementById(`link-${clientId}`);
  const btn   = document.querySelector(`#card-${clientId} .settings-copy-btn`);
  navigator.clipboard?.writeText(input.value).then(() => {
    btn.textContent = 'Gekopieerd!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Kopieer link'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    input.select(); document.execCommand('copy');
  });
}

// ─── Save all ─────────────────────────────────────────────────────────────────
async function saveAll() {
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = 'Opslaan…';
  statusEl.className = 'settings-save-status';

  const payload = { clients: {} };

  for (const client of CLIENTS) {
    const id       = client.id;
    const entry    = {};
    const platforms = ['meta', 'google', 'pinterest'].filter(p => !!client[p]);

    // Password
    const pwInput = document.getElementById(`pw-${id}`);
    if (pwInput) {
      if (pwChanged[id] === 'reset') {
        entry.password = '';
      } else if (pwChanged[id] && pwInput.value) {
        entry.password = pwInput.value;
      }
      // else: undefined → server keeps existing password
    }

    // Platform visibility
    const platVis = {};
    platforms.forEach(p => {
      const cb = document.getElementById(`plt-${p}-${id}`);
      if (cb) platVis[p] = cb.checked;
    });
    if (Object.keys(platVis).length) entry.platforms = platVis;

    // Account overrides
    const overrides = {};
    platforms.forEach(p => {
      const input      = document.getElementById(`acc-${p}-${id}`);
      const defaultVal = input?.dataset.default || '';
      const val        = input?.value?.trim() || '';
      if (val && val !== defaultVal) overrides[p] = val;
    });
    entry.accountOverrides = overrides;

    payload.clients[id] = entry;
  }

  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (data.ok) {
      Object.keys(pwChanged).forEach(k => delete pwChanged[k]);
      const fresh = await fetch('/api/settings');
      currentSettings = await fresh.json();
      renderAll();
      statusEl.textContent = 'Opgeslagen ✓';
      statusEl.className = 'settings-save-status success';
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'settings-save-status'; }, 3000);
    } else {
      throw new Error('Server fout');
    }
  } catch (err) {
    statusEl.textContent = 'Fout bij opslaan: ' + err.message;
    statusEl.className = 'settings-save-status error';
  }
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
