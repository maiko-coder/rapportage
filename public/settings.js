// ─── State ────────────────────────────────────────────────────────────────────
let currentSettings = { clients: {} };

// Track which password fields were explicitly changed
const pwChanged = {};

// ─── Local storage fallback (Vercel /tmp is ephemeral) ───────────────────────
const LS_KEY = 'rapportage_settings';

function loadLocalSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}

function saveLocalSettings(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

function mergeWithLocal(serverData) {
  const local = loadLocalSettings();
  if (!local) return serverData;
  // Merge: server is authoritative for passwords; local fills in the rest
  const merged = { clients: { ...serverData.clients } };
  for (const [id, localCfg] of Object.entries(local.clients || {})) {
    const srv = serverData.clients[id] || {};
    merged.clients[id] = {
      ...localCfg,
      // Keep server password state (masked or empty)
      ...(srv.password !== undefined ? { password: srv.password } : {}),
      _hasPassword: !!srv.password || srv._hasPassword,
    };
  }
  return merged;
}

const PLATFORM_LABELS = { meta: 'Meta Ads', google: 'Google Ads', pinterest: 'Pinterest Ads' };
const PLATFORM_BADGE_CLASS = { meta: 'badge-meta', google: 'badge-google', pinterest: 'badge-pinterest' };

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  try {
    const r = await fetch('/api/settings');
    const serverData = await r.json();
    currentSettings = mergeWithLocal(serverData);
  } catch {
    currentSettings = loadLocalSettings() || { clients: {} };
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

      </div>
    </div>`;
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

  // Always save to localStorage first (works on Vercel where /tmp is ephemeral)
  saveLocalSettings(payload);

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
      currentSettings = mergeWithLocal(await fresh.json());
      renderAll();
      statusEl.textContent = 'Opgeslagen ✓';
      statusEl.className = 'settings-save-status success';
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'settings-save-status'; }, 3000);
    } else {
      throw new Error('Server fout');
    }
  } catch (err) {
    // Server save failed (e.g. Vercel cold start) but localStorage save succeeded
    Object.keys(pwChanged).forEach(k => delete pwChanged[k]);
    currentSettings = mergeWithLocal(loadLocalSettings() || payload);
    renderAll();
    statusEl.textContent = 'Opgeslagen (lokaal) ✓';
    statusEl.className = 'settings-save-status success';
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'settings-save-status'; }, 3000);
  }
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
