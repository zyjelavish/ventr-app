// VENTR Connect — Marktplaats content script
// Vult advertentieformulier automatisch in op marktplaats.nl

(function () {
  'use strict';

  let pendingItem = null;

  function init() {
    injectPanel();
    loadQueue();
    // Luister naar berichten van background
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'VENTR_FILL_LISTING') {
        pendingItem = msg.item;
        showPanel();
        setTimeout(() => placeItem(pendingItem), 1000);
      }
    });
  }

  // ── PANEL ──────────────────────────────────────────────────────────────────

  let panelEl = null;
  let queue   = [];
  let isPlacing = false;

  function injectPanel() {
    if (document.getElementById('ventr-panel')) return;
    panelEl = document.createElement('div');
    panelEl.id = 'ventr-panel';
    panelEl.innerHTML = `
      <div id="ventr-header">
        <div id="ventr-logo"><span class="ventr-dot"></span>VENTR <span style="font-size:9px;opacity:0.7;letter-spacing:1px">MARKTPLAATS</span></div>
        <div id="ventr-header-right">
          <span id="ventr-count-badge"></span>
          <button id="ventr-minimize">—</button>
        </div>
      </div>
      <div id="ventr-body">
        <div id="ventr-empty">Geen items in wachtrij.<br>Genereer op <a href="https://ventr.nl" target="_blank">ventr.nl</a> 🌸</div>
        <div id="ventr-list"></div>
        <div id="ventr-status"></div>
      </div>`;
    document.body.appendChild(panelEl);

    let minimized = false;
    document.getElementById('ventr-minimize').addEventListener('click', () => {
      minimized = !minimized;
      document.getElementById('ventr-body').style.display = minimized ? 'none' : 'block';
      document.getElementById('ventr-minimize').textContent = minimized ? '+' : '—';
    });
    updatePanel();
  }

  function showPanel() {
    const panel = document.getElementById('ventr-panel');
    if (panel) panel.style.display = 'block';
  }

  function loadQueue() {
    chrome.runtime.sendMessage({ type: 'VENTR_GET_QUEUE' }, res => {
      if (chrome.runtime.lastError) return;
      queue = (res?.queue || []).filter(q => q.status === 'pending');
      updatePanel();
    });
  }

  function updatePanel() {
    if (!panelEl) return;
    const badge = document.getElementById('ventr-count-badge');
    const empty = document.getElementById('ventr-empty');
    const list  = document.getElementById('ventr-list');
    if (badge) badge.textContent = queue.length > 0 ? queue.length : '';
    if (empty) empty.style.display = queue.length === 0 ? 'block' : 'none';
    if (!list) return;

    list.innerHTML = queue.map(item => `
      <div class="ventr-item ${isPlacing && pendingItem?.id === item.id ? 'ventr-item-active' : ''}">
        <div class="ventr-item-photos">
          ${(item.photos||[]).slice(0,3).map(p=>`<img src="${p.preview||p}" alt="">`).join('')}
        </div>
        <div class="ventr-item-info">
          <div class="ventr-item-title">${esc(item.listing?.titel||'')}</div>
          <div class="ventr-item-meta">€${item.listing?.prijs} · ${esc(item.listing?.staat||'')}</div>
        </div>
        <div class="ventr-item-actions">
          <button class="ventr-btn-place" data-id="${item.id}" ${isPlacing?'disabled':''}>▶ Plaatsen</button>
          <button class="ventr-btn-remove" data-id="${item.id}">✕</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('.ventr-btn-place').forEach(btn =>
      btn.addEventListener('click', () => {
        const item = queue.find(q => q.id === btn.dataset.id);
        if (item) placeItem(item);
      }));
    list.querySelectorAll('.ventr-btn-remove').forEach(btn =>
      btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'VENTR_REMOVE_FROM_QUEUE', id: btn.dataset.id }, () => loadQueue());
      }));
  }

  function setStatus(msg, type = 'info') {
    const el = document.getElementById('ventr-status');
    if (el) { el.textContent = msg; el.className = 'ventr-status-' + type; }
  }

  // ── PLAATSEN ────────────────────────────────────────────────────────────────

  async function placeItem(item) {
    if (!item || isPlacing) return;
    pendingItem = item; isPlacing = true; updatePanel();

    try {
      setStatus("📸 Foto's uploaden...", 'info');
      await uploadPhotos(item.photos);
      await sleep(1500);

      setStatus('✏️ Titel invullen...', 'info');
      await fillInput(findEl(['input[id*="title"]','input[name="title"]','input[placeholder*="titel" i]']), item.listing.titel?.slice(0,60));
      await sleep(300);

      setStatus('📝 Beschrijving...', 'info');
      await fillInput(findEl(['textarea[id*="description"]','textarea[name="description"]','textarea[placeholder*="beschrijving" i]','textarea']), item.listing.beschrijving);
      await sleep(300);

      setStatus('💶 Prijs...', 'info');
      await fillInput(findEl(['input[id*="price"]','input[name="price"]','input[type="number"]','input[placeholder*="prijs" i]']), String(item.listing.prijs));
      await sleep(300);

      setStatus('🏷️ Staat selecteren...', 'info');
      await fillMarktplaatsCondition(item.listing.staat);
      await sleep(400);

      setStatus('✅ Klaar — controleer en publiceer!', 'success');
      chrome.runtime.sendMessage({ type: 'VENTR_MARK_LISTED', id: item.id, platform: 'marktplaats' });

    } catch (err) {
      setStatus('❌ ' + err.message, 'error');
    }

    isPlacing = false; pendingItem = null;
    loadQueue(); updatePanel();
  }

  // ── MARKTPLAATS SPECIFIEK ──────────────────────────────────────────────────

  async function fillMarktplaatsCondition(staat) {
    const map = {
      'Nieuw met label':    ['nieuw'],
      'Nieuw zonder label': ['nieuw'],
      'Zeer goed':          ['zo goed als nieuw'],
      'Goed':               ['goed'],
      'Redelijk':           ['redelijk'],
    };
    const terms = map[staat] || [];
    const allInputs = [...document.querySelectorAll('input[type="radio"], label, button[role="radio"]')];
    for (const term of terms) {
      const match = allInputs.find(el => el.textContent?.toLowerCase().includes(term) || el.value?.toLowerCase().includes(term));
      if (match) { match.click(); await sleep(200); break; }
    }
  }

  // ── FOTO UPLOAD ────────────────────────────────────────────────────────────

  async function uploadPhotos(photos) {
    if (!photos?.length) return false;
    const input = findEl(['input[type="file"][multiple]','input[type="file"][accept*="image"]','input[type="file"]']);
    if (!input) return false;

    const dt = new DataTransfer();
    for (let i = 0; i < photos.length; i++) {
      try {
        const src = photos[i].full || photos[i].preview || photos[i];
        const blob = await fetch(src).then(r => r.blob());
        dt.items.add(new File([blob], `ventr-${i+1}.jpg`, { type: 'image/jpeg' }));
      } catch {}
    }
    if (!dt.files.length) return false;

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(input, dt.files);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────

  function findEl(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  async function fillInput(el, value) {
    if (!el || !value) return;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
    )?.set;
    if (setter) setter.call(el, value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
