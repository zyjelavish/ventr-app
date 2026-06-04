// VENTR Connect — Content script op Vinted
// Vult advertentieformulier automatisch in incl. dropdowns

(function () {
  'use strict';

  let queue = [];
  let panelEl = null;
  let currentItem = null;
  let isPlacing = false;

  function init() {
    loadQueue();
    injectPanel();
    setInterval(loadQueue, 5000);
  }

  function loadQueue() {
    chrome.runtime.sendMessage({ type: 'VENTR_GET_QUEUE' }, res => {
      if (chrome.runtime.lastError) return;
      queue = (res?.queue || []).filter(q => q.status === 'pending');
      updatePanel();
    });
  }

  // ── PANEL ──────────────────────────────────────────────────────────────────

  function injectPanel() {
    if (document.getElementById('ventr-panel')) return;
    panelEl = document.createElement('div');
    panelEl.id = 'ventr-panel';
    panelEl.innerHTML = `
      <div id="ventr-header">
        <div id="ventr-logo"><span class="ventr-dot"></span>VENTR</div>
        <div id="ventr-header-right">
          <span id="ventr-count-badge"></span>
          <button id="ventr-minimize">—</button>
        </div>
      </div>
      <div id="ventr-body">
        <div id="ventr-empty">Geen advertenties in wachtrij.<br>Ga naar <a href="https://ventr.nl" target="_blank">ventr.nl</a> 🌸</div>
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

  function updatePanel() {
    if (!panelEl) return;
    const badge = document.getElementById('ventr-count-badge');
    const empty = document.getElementById('ventr-empty');
    const list  = document.getElementById('ventr-list');
    if (badge) badge.textContent = queue.length > 0 ? queue.length : '';
    if (empty) empty.style.display = queue.length === 0 ? 'block' : 'none';
    if (!list) return;

    list.innerHTML = queue.map(item => `
      <div class="ventr-item ${currentItem?.id === item.id ? 'ventr-item-active' : ''}">
        <div class="ventr-item-photos">
          ${(item.photos || []).slice(0, 3).map(p => `<img src="${p.preview || p}" alt="">`).join('')}
        </div>
        <div class="ventr-item-info">
          <div class="ventr-item-title">${esc(item.listing?.titel || '')}</div>
          <div class="ventr-item-meta">€${item.listing?.prijs} · ${esc(item.listing?.staat || '')} · ${esc(item.listing?.maat || '')}</div>
        </div>
        <div class="ventr-item-actions">
          <button class="ventr-btn-place" data-id="${item.id}" ${isPlacing ? 'disabled' : ''}>
            ${currentItem?.id === item.id && isPlacing ? '⏳' : '▶ Plaatsen'}
          </button>
          <button class="ventr-btn-remove" data-id="${item.id}" title="Verwijder">✕</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('.ventr-btn-place').forEach(btn =>
      btn.addEventListener('click', () => placeItem(btn.dataset.id)));
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

  async function placeItem(id) {
    const item = queue.find(q => q.id === id);
    if (!item || isPlacing) return;
    currentItem = item; isPlacing = true; updatePanel();

    const onPage = window.location.pathname.includes('/sell')
      || window.location.pathname.includes('/items/new')
      || window.location.pathname.includes('/verkopen')
      || window.location.pathname.includes('/vendre');

    if (!onPage) {
      setStatus('Ga naar Vinted → Verkopen om te starten', 'warn');
      isPlacing = false; currentItem = null; updatePanel(); return;
    }

    try {
      setStatus('📸 Foto\'s uploaden...', 'info');
      await uploadPhotos(item.photos);
      await sleep(2000);

      setStatus('✏️ Titel invullen...', 'info');
      await fillInput(findTitle(), item.listing.titel?.slice(0, 60));
      await sleep(300);

      setStatus('📝 Beschrijving invullen...', 'info');
      await fillInput(findDescription(), item.listing.beschrijving);
      await sleep(300);

      setStatus('💶 Prijs invullen...', 'info');
      await fillInput(findPrice(), String(item.listing.prijs));
      await sleep(300);

      setStatus('🏷️ Staat selecteren...', 'info');
      await fillDropdownByValue(findDropdown('staat|condition|conditie|zustand'), item.listing.staat);
      await sleep(500);

      setStatus('📐 Maat selecteren...', 'info');
      await fillDropdownByValue(findDropdown('maat|size|größe|taille'), item.listing.maat);
      await sleep(500);

      setStatus('🗂️ Categorie selecteren...', 'info');
      await fillDropdownByValue(findDropdown('categorie|category|catégorie'), item.listing.categorie);
      await sleep(500);

      setStatus('✅ Klaar! Controleer en klik Publiceer 🎉', 'success');
      chrome.runtime.sendMessage({ type: 'VENTR_MARK_DONE', id: item.id });

    } catch (err) {
      setStatus('❌ ' + err.message, 'error');
    }

    isPlacing = false; currentItem = null;
    loadQueue(); updatePanel();
  }

  // ── FORMULIER HELPERS ──────────────────────────────────────────────────────

  function findEl(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.offsetParent !== null) return el; // moet zichtbaar zijn
    }
    return null;
  }

  function findTitle() {
    return findEl([
      'input[data-testid*="title"]', 'input[name="title"]',
      'input[maxlength="60"]', 'input[maxlength="50"]',
      'input[placeholder*="titel"]', 'input[placeholder*="title" i]',
    ]);
  }

  function findDescription() {
    return findEl([
      'textarea[data-testid*="description"]', 'textarea[name="description"]',
      'textarea[placeholder*="beschrijving" i]', 'textarea[placeholder*="description" i]',
      'textarea',
    ]);
  }

  function findPrice() {
    return findEl([
      'input[data-testid*="price"]', 'input[name="price"]',
      'input[type="number"]', 'input[placeholder*="prijs" i]',
      'input[placeholder*="price" i]',
    ]);
  }

  function findDropdown(labelPattern) {
    const re = new RegExp(labelPattern, 'i');
    // Zoek label met matching tekst
    const allLabels = [...document.querySelectorAll('label, [class*="label"], [class*="Label"]')];
    for (const label of allLabels) {
      if (!re.test(label.textContent)) continue;
      // Zoek bijbehorende dropdown in de buurt
      const parent = label.closest('div[class], section, form') || label.parentElement?.parentElement;
      if (!parent) continue;
      const trigger = parent.querySelector(
        'button[aria-haspopup], [role="combobox"], [class*="dropdown"] button, [class*="select"] button, [class*="Select"] button'
      );
      if (trigger) return trigger;
    }
    // Fallback: zoek via aria-label
    return findEl([
      `[aria-label*="${labelPattern}" i]`,
      `button[data-testid*="${labelPattern}" i]`,
    ]);
  }

  async function fillInput(el, value) {
    if (!el || !value) return;
    el.focus();
    el.select?.();
    const setter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
    )?.set;
    if (setter) setter.call(el, value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  async function fillDropdownByValue(trigger, value) {
    if (!trigger || !value) return false;
    trigger.click();
    await sleep(600);

    // Zoek naar opties in geopend dropdown
    const optionSelectors = [
      '[role="option"]', '[role="listbox"] li', '[role="listbox"] [role="option"]',
      '[class*="dropdown__item"]', '[class*="dropdownItem"]', '[class*="option"]',
      '[class*="Option"]', 'ul li', '[class*="list"] li',
    ];

    let options = [];
    for (const sel of optionSelectors) {
      options = [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null);
      if (options.length > 0) break;
    }

    if (options.length === 0) {
      // Sluit dropdown en geef op
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }

    // Normaliseer zoekwaarde voor matching
    const searchTerms = normalizeValue(value);
    let best = null;
    let bestScore = 0;

    for (const opt of options) {
      const text = normalizeValue(opt.textContent);
      const score = matchScore(text, searchTerms);
      if (score > bestScore) { bestScore = score; best = opt; }
    }

    if (best && bestScore > 0) {
      best.click();
      await sleep(300);
      return true;
    }

    // Niets gevonden — sluit dropdown
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }

  function normalizeValue(str) {
    return String(str).toLowerCase()
      .replace(/[\/\-\(\)\.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function matchScore(text, search) {
    // Hoe hoog is de overlap tussen text en search?
    const searchWords = search.split(' ').filter(w => w.length > 1);
    let hits = 0;
    for (const word of searchWords) {
      if (text.includes(word)) hits++;
    }
    return hits / Math.max(searchWords.length, 1);
  }

  // ── FOTO UPLOAD ────────────────────────────────────────────────────────────

  async function uploadPhotos(photos) {
    if (!photos?.length) return false;

    // Gebruik full-kwaliteit foto's als beschikbaar, anders preview
    const photoData = photos.map(p => p.full || p.preview || p);

    const input = findEl([
      'input[type="file"][multiple]',
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ]);

    if (!input) return false;

    const dt = new DataTransfer();
    for (let i = 0; i < photoData.length; i++) {
      try {
        const blob = await fetch(photoData[i]).then(r => r.blob());
        dt.items.add(new File([blob], `ventr-${i + 1}.jpg`, { type: 'image/jpeg' }));
      } catch { /* skip */ }
    }

    if (dt.files.length === 0) return false;

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (nativeSetter) nativeSetter.call(input, dt.files);
    else Object.defineProperty(input, 'files', { value: dt.files, configurable: true });

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    await sleep(800);
    return true;
  }

  // ── UTILS ──────────────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── START ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
