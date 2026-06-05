// VENTR Connect — Content script op Vinted v3
// Volledig herschreven met robuuste React-compatibele invulmethoden

(function () {
  'use strict';

  let queue     = [];
  let panelEl   = null;
  let currentItem = null;
  let isPlacing = false;

  function init() {
    loadQueue();
    injectPanel();
    setInterval(loadQueue, 8000);

    // Luister naar berichten van background (crosslist flow)
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'VENTR_FILL_LISTING' && msg.item) {
        currentItem = msg.item;
        setTimeout(() => placeItem(currentItem), 1500);
      }
      if (msg.type === 'VENTR_CHECK_ACTIVITY') {
        const badge = document.querySelector('[data-testid="inbox-notification-count"], [class*="unread-count"]');
        const unread = badge ? (parseInt(badge.textContent) || 1) : 0;
        if (unread > 0) chrome.runtime.sendMessage({ type: 'VENTR_ACTIVITY_UPDATE', data: { newMessages: unread } });
      }
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

  let retryCount = 0;

  function loadQueue() {
    // Check of chrome.runtime überhaupt beschikbaar is
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      // Runtime nog niet beschikbaar — wacht en probeer opnieuw
      if (retryCount < 5) {
        retryCount++;
        setTimeout(loadQueue, 1000);
      } else {
        showContextInvalidatedWarning();
      }
      return;
    }

    retryCount = 0;
    try {
      chrome.runtime.sendMessage({ type: 'VENTR_GET_QUEUE' }, res => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          if (msg.includes('invalidated') || msg.includes('connection') || msg.includes('Receiving end')) {
            // Probeer nog 3x voor we de waarschuwing tonen
            if (retryCount < 3) {
              retryCount++;
              setTimeout(loadQueue, 1500);
            } else {
              showContextInvalidatedWarning();
            }
          }
          return;
        }
        retryCount = 0;
        queue = (res?.queue || []).filter(q => q.status === 'pending');
        updatePanel();
      });
    } catch (e) {
      if (retryCount < 3) {
        retryCount++;
        setTimeout(loadQueue, 1500);
      } else {
        showContextInvalidatedWarning();
      }
    }
  }

  function showContextInvalidatedWarning() {
    setStatus('🔄 Extensie herladen — vernieuw deze pagina (F5)', 'warn');
    const list = document.getElementById('ventr-list');
    if (list) list.innerHTML = `
      <div style="text-align:center;padding:14px 10px">
        <div style="font-size:22px;margin-bottom:8px">🔄</div>
        <div style="font-size:11px;color:#7D3C52;font-weight:600;margin-bottom:4px">Extensie is herladen</div>
        <div style="font-size:10px;color:#8A7570;line-height:1.5;margin-bottom:10px">
          Druk <b>F5</b> om deze pagina te vernieuwen.<br>
          Je wachtrij blijft bewaard.
        </div>
        <button onclick="location.reload()" style="background:linear-gradient(135deg,#7D3C52,#C9956C);color:white;border:none;border-radius:8px;padding:8px 16px;font-size:11px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif">
          🔄 Vernieuw pagina
        </button>
      </div>`;
    const empty = document.getElementById('ventr-empty');
    if (empty) empty.style.display = 'none';
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
          ${(item.photos||[]).slice(0,3).map(p=>`<img src="${p.preview||p}" alt="">`).join('')}
        </div>
        <div class="ventr-item-info">
          <div class="ventr-item-title">${esc(item.listing?.titel||'')}</div>
          <div class="ventr-item-meta">€${item.listing?.prijs} · ${esc(item.listing?.staat||'')} · ${esc(item.listing?.maat||'')}</div>
        </div>
        <div class="ventr-item-actions">
          <button class="ventr-btn-place" data-id="${item.id}" ${isPlacing?'disabled':''}>
            ${currentItem?.id === item.id && isPlacing ? '⏳' : '▶ Plaatsen'}
          </button>
          <button class="ventr-btn-remove" data-id="${item.id}">✕</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('.ventr-btn-place').forEach(btn =>
      btn.addEventListener('click', () => placeItem(queue.find(q => q.id === btn.dataset.id))));
    list.querySelectorAll('.ventr-btn-remove').forEach(btn =>
      btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'VENTR_REMOVE_FROM_QUEUE', id: btn.dataset.id }, () => loadQueue());
      }));
  }

  function setStatus(msg, type = 'info') {
    const el = document.getElementById('ventr-status');
    if (el) { el.textContent = msg; el.className = 'ventr-status-' + type; }
  }

  // ── HOOFD PLAATSEN FLOW ────────────────────────────────────────────────────

  async function placeItem(item) {
    if (!item || isPlacing) return;

    // Controleer of we op de juiste pagina zijn
    const onSellPage = /\/(verkopen|items\/new|sell|vendre|verkaufen)/i.test(location.pathname);
    if (!onSellPage) {
      setStatus('Ga naar Vinted → Verkopen om te starten', 'warn');
      return;
    }

    currentItem = item; isPlacing = true; updatePanel();

    try {
      // Wacht op het formulier
      setStatus('⏳ Wacht op formulier...', 'info');
      await waitForElement('input, textarea', 8000);

      // STAP 1: Foto's
      setStatus('📸 Foto\'s uploaden...', 'info');
      const fotoResult = await uploadPhotosRobust(item.photos);
      if (!fotoResult) setStatus('⚠️ Foto\'s handmatig uploaden — rest wordt ingevuld', 'warn');
      await sleep(2000);

      // STAP 2: Tekstvelden
      setStatus('✏️ Titel invullen...', 'info');
      await fillTitle(item.listing.titel);
      await sleep(600);

      setStatus('📝 Beschrijving invullen...', 'info');
      await fillDescription(item.listing.beschrijving);
      await sleep(600);

      setStatus('💶 Prijs invullen...', 'info');
      await fillPrice(item.listing.prijs);
      await sleep(600);

      // STAP 3: Dropdowns
      setStatus('🏷️ Staat selecteren...', 'info');
      await fillCondition(item.listing.staat);
      await sleep(800);

      setStatus('📐 Maat invullen...', 'info');
      await fillSize(item.listing.maat);
      await sleep(600);

      setStatus('✅ Klaar! Controleer en klik Publiceer 🎉', 'success');
      try { chrome.runtime.sendMessage({ type: 'VENTR_MARK_DONE', id: item.id }); } catch {}

    } catch (err) {
      setStatus('❌ ' + err.message, 'error');
      console.error('[VENTR]', err);
    }

    isPlacing = false; currentItem = null;
    loadQueue(); updatePanel();
  }

  // ── FOTO UPLOAD — 3 METHODEN ───────────────────────────────────────────────

  async function uploadPhotosRobust(photos) {
    if (!photos?.length) return false;
    const photoData = photos.map(p => p.full || p.preview || p).filter(Boolean);
    if (!photoData.length) return false;

    // Bouw File objecten
    const files = [];
    for (let i = 0; i < photoData.length; i++) {
      try {
        const blob = await fetch(photoData[i]).then(r => r.blob());
        files.push(new File([blob], `ventr-${i+1}.jpg`, { type: 'image/jpeg' }));
      } catch {}
    }
    if (!files.length) return false;

    // Methode 1: Directe file input injectie
    const ok1 = await tryFileInputMethod(files);
    if (ok1) { await sleep(500); return true; }

    // Methode 2: Klik upload-knop, dan injecteer
    const ok2 = await tryClickThenInject(files);
    if (ok2) { await sleep(500); return true; }

    // Methode 3: Drag-and-drop simulatie op dropzone
    const ok3 = await tryDragDropMethod(files);
    return ok3;
  }

  async function tryFileInputMethod(files) {
    try {
      // Zoek alle mogelijke file inputs
      const inputs = [
        ...document.querySelectorAll('input[type="file"]')
      ].filter(el => el.accept?.includes('image') || el.multiple || el.accept === '');

      const input = inputs[0];
      if (!input) return false;

      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));

      // Methode A: native property setter
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, dt.files);
      } else {
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
      }

      // Stuur alle relevante events
      input.dispatchEvent(new Event('change',  { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('input',   { bubbles: true, cancelable: true }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));

      await sleep(300);

      // Verificeer: heeft de pagina gereageerd?
      const preview = document.querySelector('[class*="photo"], [class*="Photo"], [class*="image-preview"], img[src^="blob"]');
      return !!preview;
    } catch { return false; }
  }

  async function tryClickThenInject(files) {
    try {
      // Vind en klik de upload-trigger
      const uploadTriggers = [
        '[data-testid*="upload"]',
        '[class*="upload-button"]',
        '[class*="UploadButton"]',
        '[class*="photo-uploader"]',
        '[class*="PhotoUploader"]',
        'label[for][class*="upload"]',
        'label[for][class*="photo"]',
        '[aria-label*="foto" i]',
        '[aria-label*="photo" i]',
        '[aria-label*="upload" i]',
      ];

      let trigger = null;
      for (const sel of uploadTriggers) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { trigger = el; break; }
      }

      if (!trigger) return false;
      trigger.click();
      await sleep(500);

      // Zoek nu het file input dat verschenen is
      const input = document.querySelector('input[type="file"]');
      if (!input) return false;

      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
      if (setter) setter.call(input, dt.files);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      return true;
    } catch { return false; }
  }

  async function tryDragDropMethod(files) {
    try {
      const dropzones = [
        '[class*="dropzone"]',
        '[class*="Dropzone"]',
        '[class*="upload-area"]',
        '[class*="UploadArea"]',
        '[class*="photo-upload"]',
        '[class*="PhotoUpload"]',
        '[ondrop]',
        '[class*="drag"]',
      ];

      let zone = null;
      for (const sel of dropzones) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { zone = el; break; }
      }

      if (!zone) return false;

      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));

      // Simuleer dragenter, dragover, drop
      ['dragenter','dragover'].forEach(type => {
        zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      });
      await sleep(100);
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    } catch { return false; }
  }

  // ── TEKSTVELDEN ────────────────────────────────────────────────────────────

  async function fillTitle(text) {
    if (!text) return;
    const el = await findInputByPriority([
      '#title',
      'input[name="title"]',
      'input[data-testid="title"]',
      'input[data-testid*="title" i]',
      'input[maxlength="60"]',
      'input[maxlength="50"]',
      'input[placeholder*="titel" i]',
      'input[placeholder*="title" i]',
      'input[aria-label*="titel" i]',
      'input[aria-label*="title" i]',
    ]);
    if (el) await reactFill(el, text.slice(0, 60));
  }

  async function fillDescription(text) {
    if (!text) return;
    const el = await findInputByPriority([
      '#description',
      'textarea[name="description"]',
      'textarea[data-testid="description"]',
      'textarea[data-testid*="description" i]',
      'textarea[placeholder*="beschrijving" i]',
      'textarea[placeholder*="description" i]',
      'textarea[aria-label*="beschrijving" i]',
      'textarea[aria-label*="description" i]',
      'textarea',
    ]);
    if (el) await reactFill(el, text);
  }

  async function fillPrice(price) {
    if (!price) return;
    const el = await findInputByPriority([
      '#price',
      'input[name="price"]',
      'input[data-testid="price"]',
      'input[data-testid*="price" i]',
      'input[placeholder*="prijs" i]',
      'input[placeholder*="price" i]',
      'input[aria-label*="prijs" i]',
      'input[type="number"]',
    ]);
    if (el) await reactFill(el, String(price));
  }

  async function fillSize(maat) {
    if (!maat) return;
    // Probeer eerst een tekstveld, dan dropdown
    const textEl = await findInputByPriority([
      'input[name="size"]',
      'input[data-testid*="size" i]',
      'input[placeholder*="maat" i]',
      'input[placeholder*="size" i]',
    ]);
    if (textEl) { await reactFill(textEl, maat.split(' ')[0]); return; }

    // Anders dropdown
    const sizeNum = maat.match(/\d+/)?.[0] || '';
    await clickDropdownOption(['maat', 'size'], sizeNum || maat);
  }

  // ── DROPDOWN / STAAT ───────────────────────────────────────────────────────

  async function fillCondition(staat) {
    if (!staat) return;

    // Vinted toont staat als klikbare chips/buttons
    const conditionMap = {
      'Nieuw met label':    ['nieuw met label', 'new with tags', 'brand new'],
      'Nieuw zonder label': ['nieuw zonder label', 'new without tags', 'nieuw'],
      'Zeer goed':          ['zeer goed', 'very good', 'uitstekend'],
      'Goed':               ['goed', 'good'],
      'Redelijk':           ['redelijk', 'satisfactory', 'voldoende'],
    };

    const terms = conditionMap[staat] || [staat.toLowerCase()];

    // Methode 1: Zoek klikbare chips/buttons met matching tekst
    for (const term of terms) {
      const buttons = [...document.querySelectorAll('button, [role="radio"], [role="option"], label, [class*="chip"], [class*="Chip"], [class*="condition"], [class*="Condition"]')];
      const match = buttons.find(el =>
        el.offsetParent !== null &&
        el.textContent?.trim().toLowerCase() === term.toLowerCase()
      );
      if (match) {
        match.click();
        await sleep(300);
        return;
      }
    }

    // Methode 2: Dropdown openen en optie kiezen
    await clickDropdownOption(['staat', 'condition', 'conditie', 'zustand'], terms[0]);
  }

  async function clickDropdownOption(labelTerms, valueText) {
    // Zoek de dropdown trigger via label-tekst in de buurt
    const allLabels = [...document.querySelectorAll('label, [class*="label"], [class*="Label"], legend, h3, h4, span')];

    let trigger = null;
    for (const label of allLabels) {
      const labelText = label.textContent?.toLowerCase() || '';
      if (labelTerms.some(t => labelText.includes(t.toLowerCase()))) {
        // Zoek dropdown-trigger in de buurt
        const container = label.closest('div[class], section, form, fieldset') || label.parentElement?.parentElement;
        if (!container) continue;
        const t = container.querySelector(
          'button[aria-expanded], [role="combobox"], [class*="select"] button, [class*="Select"] button, [class*="dropdown"] button, [class*="Dropdown"] button'
        );
        if (t && t.offsetParent !== null) { trigger = t; break; }
      }
    }

    if (!trigger) {
      // Fallback: zoek op basis van aria-labels
      for (const term of labelTerms) {
        const t = document.querySelector(
          `[aria-label*="${term}" i][aria-expanded], [data-testid*="${term}" i]`
        );
        if (t && t.offsetParent !== null) { trigger = t; break; }
      }
    }

    if (!trigger) return false;

    // Klik om dropdown te openen
    trigger.click();
    await sleep(700);

    // Zoek optie globaal (Vinted gebruikt React portals buiten de main DOM)
    const optionSelectors = [
      '[role="option"]',
      '[role="listbox"] li',
      '[role="listbox"] [role="option"]',
      '[class*="dropdown__item"]',
      '[class*="dropdownItem"]',
      '[class*="SelectOption"]',
      '[class*="select-option"]',
      '[class*="option"]',
      'ul li',
      '[class*="list-item"]',
    ];

    let options = [];
    for (const sel of optionSelectors) {
      options = [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null);
      if (options.length > 0) break;
    }

    if (options.length === 0) {
      // Sluit dropdown
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }

    // Zoek beste match
    const searchLower = valueText.toLowerCase();
    let best = null;
    let bestScore = 0;

    for (const opt of options) {
      const text = opt.textContent?.toLowerCase() || '';
      // Exacte match
      if (text === searchLower) { best = opt; break; }
      // Gedeeltelijke match
      if (text.includes(searchLower) || searchLower.includes(text)) {
        const score = Math.min(text.length, searchLower.length) / Math.max(text.length, searchLower.length);
        if (score > bestScore) { bestScore = score; best = opt; }
      }
    }

    if (best) {
      best.click();
      await sleep(300);
      return true;
    }

    // Niets gevonden, sluit dropdown
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }

  // ── REACT-COMPATIBELE INPUT INVULLING ──────────────────────────────────────

  async function reactFill(el, value) {
    if (!el) return;
    el.focus();
    el.click();
    await sleep(50);

    // Leeg het veld eerst (React-compatibel)
    const isTextarea = el.tagName === 'TEXTAREA';
    const proto = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(30);
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }

    // Stuur alle events die React verwacht
    el.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));

    await sleep(100);
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────

  async function findInputByPriority(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      } catch {}
    }
    return null;
  }

  async function waitForElement(selector, maxMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) return el;
      await sleep(400);
    }
    return null;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── START ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
