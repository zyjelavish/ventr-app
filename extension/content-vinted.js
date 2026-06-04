// VENTR Connect — Content script op Vinted
// Toont zwevend panel en vult advertentieformulier automatisch in

(function () {
  'use strict';

  let queue = [];
  let panelEl = null;
  let currentItem = null;
  let isPlacing = false;

  // ── INIT ───────────────────────────────────────────────────────────────────

  function init() {
    loadQueue();
    injectPanel();
    // Herladen queue elke 5 seconden
    setInterval(loadQueue, 5000);
  }

  function loadQueue() {
    chrome.runtime.sendMessage({ type: 'VENTR_GET_QUEUE' }, res => {
      if (chrome.runtime.lastError) return;
      queue = (res?.queue || []).filter(q => q.status === 'pending');
      updatePanel();
    });
  }

  // ── PANEL UI ───────────────────────────────────────────────────────────────

  function injectPanel() {
    if (document.getElementById('ventr-panel')) return;

    panelEl = document.createElement('div');
    panelEl.id = 'ventr-panel';
    panelEl.innerHTML = `
      <div id="ventr-header">
        <div id="ventr-logo">
          <span class="ventr-dot"></span>VENTR
        </div>
        <div id="ventr-header-right">
          <span id="ventr-count-badge"></span>
          <button id="ventr-minimize">—</button>
        </div>
      </div>
      <div id="ventr-body">
        <div id="ventr-empty">
          Geen advertenties in wachtrij.<br>
          Genereer ze op <a href="https://ventr.nl" target="_blank">ventr.nl</a> 🌸
        </div>
        <div id="ventr-list"></div>
        <div id="ventr-status"></div>
      </div>
    `;
    document.body.appendChild(panelEl);

    // Minimize toggle
    let minimized = false;
    document.getElementById('ventr-minimize').addEventListener('click', () => {
      minimized = !minimized;
      document.getElementById('ventr-body').style.display = minimized ? 'none' : 'block';
      document.getElementById('ventr-minimize').textContent = minimized ? '+' : '—';
    });

    updatePanel();
  }

  function updatePanel() {
    if (!panelEl) return;

    const badge = document.getElementById('ventr-count-badge');
    const empty = document.getElementById('ventr-empty');
    const list = document.getElementById('ventr-list');

    if (badge) badge.textContent = queue.length > 0 ? queue.length : '';
    if (empty) empty.style.display = queue.length === 0 ? 'block' : 'none';
    if (!list) return;

    list.innerHTML = queue.map((item, i) => `
      <div class="ventr-item ${currentItem?.id === item.id ? 'ventr-item-active' : ''}">
        <div class="ventr-item-photos">
          ${item.photos.slice(0, 3).map(p =>
            `<img src="${p.preview}" alt="">`
          ).join('')}
        </div>
        <div class="ventr-item-info">
          <div class="ventr-item-title">${escHtml(item.listing.titel || '')}</div>
          <div class="ventr-item-meta">€${item.listing.prijs} · ${escHtml(item.listing.staat || '')} · ${escHtml(item.listing.maat || '')}</div>
        </div>
        <div class="ventr-item-actions">
          <button class="ventr-btn-place" data-id="${item.id}" ${isPlacing ? 'disabled' : ''}>
            ${currentItem?.id === item.id && isPlacing ? '⏳' : '▶ Plaatsen'}
          </button>
          <button class="ventr-btn-remove" data-id="${item.id}" title="Verwijder">✕</button>
        </div>
      </div>
    `).join('');

    // Events
    list.querySelectorAll('.ventr-btn-place').forEach(btn => {
      btn.addEventListener('click', () => placeItem(btn.dataset.id));
    });
    list.querySelectorAll('.ventr-btn-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'VENTR_REMOVE_FROM_QUEUE', id: btn.dataset.id }, () => loadQueue());
      });
    });
  }

  function setStatus(msg, type = 'info') {
    const el = document.getElementById('ventr-status');
    if (el) {
      el.textContent = msg;
      el.className = 'ventr-status-' + type;
    }
  }

  // ── PLAATSEN FLOW ──────────────────────────────────────────────────────────

  async function placeItem(id) {
    const item = queue.find(q => q.id === id);
    if (!item || isPlacing) return;

    currentItem = item;
    isPlacing = true;
    updatePanel();

    try {
      setStatus('Formulier zoeken...', 'info');

      // Wacht op Vinted formulier (navigate als nodig)
      const onListingPage = window.location.pathname.includes('/items/new')
        || window.location.pathname.includes('/sell')
        || window.location.pathname.includes('/verkopen');

      if (!onListingPage) {
        setStatus('Ga naar Vinted → Verkopen om te beginnen', 'warn');
        isPlacing = false;
        updatePanel();
        return;
      }

      await waitForForm();

      setStatus('Foto\'s uploaden...', 'info');
      const photosOk = await injectPhotos(item.photos);
      if (!photosOk) setStatus('⚠️ Foto\'s handmatig uploaden', 'warn');

      await sleep(1500);

      setStatus('Titel invullen...', 'info');
      await fillTitle(item.listing.titel || '');
      await sleep(400);

      setStatus('Beschrijving invullen...', 'info');
      await fillDescription(item.listing.beschrijving || '');
      await sleep(400);

      setStatus('Prijs invullen...', 'info');
      await fillPrice(item.listing.prijs);
      await sleep(400);

      setStatus('Maat en staat invullen...', 'info');
      await fillCondition(item.listing.staat);
      await sleep(400);

      setStatus('✅ Klaar — controleer en klik Publiceer!', 'success');

      // Markeer als klaar in queue
      await new Promise(res =>
        chrome.runtime.sendMessage({ type: 'VENTR_MARK_DONE', id: item.id }, res)
      );

    } catch (err) {
      setStatus('❌ Fout: ' + err.message, 'error');
    }

    isPlacing = false;
    currentItem = null;
    loadQueue();
    updatePanel();
  }

  // ── FORM HELPERS ───────────────────────────────────────────────────────────

  async function waitForForm(maxMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (findTitle() || findDescription()) return true;
      await sleep(300);
    }
    throw new Error('Formulier niet gevonden');
  }

  function findEl(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function findTitle() {
    return findEl([
      'input[data-testid*="title"]',
      'input[name="title"]',
      'input[placeholder*="titel"]',
      'input[placeholder*="Title"]',
      'input[id*="title"]',
      'input[maxlength="60"]',
      'input[maxlength="50"]',
    ]);
  }

  function findDescription() {
    return findEl([
      'textarea[data-testid*="description"]',
      'textarea[name="description"]',
      'textarea[placeholder*="beschrijving"]',
      'textarea[placeholder*="escription"]',
      'textarea[id*="description"]',
    ]);
  }

  function findPrice() {
    return findEl([
      'input[data-testid*="price"]',
      'input[name="price"]',
      'input[type="number"]',
      'input[placeholder*="prijs"]',
      'input[placeholder*="Price"]',
    ]);
  }

  function findFileInput() {
    return findEl([
      'input[type="file"][multiple]',
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ]);
  }

  function fillReactInput(el, value) {
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (setter) setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function fillTitle(text) {
    const el = findTitle();
    if (!el) return;
    el.focus();
    el.select();
    fillReactInput(el, text.slice(0, 60));
  }

  async function fillDescription(text) {
    const el = findDescription();
    if (!el) return;
    el.focus();
    fillReactInput(el, text);
  }

  async function fillPrice(price) {
    const el = findPrice();
    if (!el) return;
    el.focus();
    fillReactInput(el, String(price));
  }

  async function fillCondition(staat) {
    // Vinted staat-labels mappen naar knoppen
    const map = {
      'Nieuw met label':    ['nieuw met label', 'new with tags', 'new_with_tags', '1'],
      'Nieuw zonder label': ['nieuw zonder label', 'new without tags', 'new_without_tags', '2'],
      'Zeer goed':          ['zeer goed', 'very good', 'very_good', '3'],
      'Goed':               ['goed', 'good', '4'],
      'Redelijk':           ['redelijk', 'satisfactory', '5'],
    };
    const terms = map[staat] || [];
    // Zoek naar label/button met matchende tekst
    const allButtons = [...document.querySelectorAll('button, label, [role="radio"], [role="option"]')];
    for (const term of terms) {
      const btn = allButtons.find(b => b.textContent.toLowerCase().includes(term.toLowerCase()));
      if (btn) { btn.click(); await sleep(200); break; }
    }
  }

  async function injectPhotos(photos) {
    try {
      const input = findFileInput();
      if (!input) return false;

      const dt = new DataTransfer();
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const blob = await fetch(p.preview).then(r => r.blob());
        const file = new File([blob], `ventr-foto-${i + 1}.jpg`, { type: 'image/jpeg' });
        dt.items.add(file);
      }

      // React native input hack
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, dt.files);
      } else {
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
      }

      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(500);
      return true;
    } catch (e) {
      console.warn('[VENTR] Foto-injectie mislukt:', e);
      return false;
    }
  }

  // ── UTILS ──────────────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── START ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
