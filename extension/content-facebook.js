// VENTR Connect — Facebook Marketplace content script
// Vult advertentieformulier automatisch in op facebook.com/marketplace

(function () {
  'use strict';

  // Alleen actief op marketplace create pagina
  const isMarketplacePage = () =>
    location.pathname.includes('/marketplace/create') ||
    location.pathname.includes('/marketplace/item/create');

  let queue     = [];
  let panelEl   = null;
  let isPlacing = false;
  let pendingItem = null;

  function init() {
    if (!isMarketplacePage()) {
      // Niet op create pagina — toon mini-indicator
      injectMiniIndicator();
      return;
    }
    injectPanel();
    loadQueue();

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'VENTR_FILL_LISTING') {
        pendingItem = msg.item;
        setTimeout(() => placeItem(pendingItem), 2500); // FB heeft meer laadtijd nodig
      }
    });

    // Observeer URL-wijzigingen (FB is SPA)
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (isMarketplacePage() && !document.getElementById('ventr-panel')) {
          setTimeout(() => { injectPanel(); loadQueue(); }, 1500);
        }
      }
    }).observe(document.body, { subtree: true, childList: true });
  }

  // ── MINI INDICATOR (niet op create pagina) ─────────────────────────────────

  function injectMiniIndicator() {
    if (document.getElementById('ventr-fb-mini')) return;
    const mini = document.createElement('div');
    mini.id = 'ventr-fb-mini';
    mini.style.cssText = `
      position: fixed; bottom: 80px; right: 20px; z-index: 99999;
      background: linear-gradient(135deg, #7D3C52, #C9956C);
      color: white; border-radius: 50px; padding: 10px 16px;
      font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600;
      cursor: pointer; box-shadow: 0 4px 16px rgba(125,60,82,0.3);
      display: flex; align-items: center; gap: 8px;
      letter-spacing: 1px;
    `;
    mini.innerHTML = `<span>•</span> VENTR`;
    mini.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'VENTR_OPEN_FACEBOOK' });
    });
    document.body.appendChild(mini);
  }

  // ── PANEL ──────────────────────────────────────────────────────────────────

  function injectPanel() {
    if (document.getElementById('ventr-panel')) return;
    panelEl = document.createElement('div');
    panelEl.id = 'ventr-panel';
    panelEl.style.right = '80px'; // Facebook heeft sidebar rechts
    panelEl.innerHTML = `
      <div id="ventr-header">
        <div id="ventr-logo"><span class="ventr-dot"></span>VENTR <span style="font-size:9px;opacity:0.7;letter-spacing:1px">FACEBOOK</span></div>
        <div id="ventr-header-right">
          <span id="ventr-count-badge"></span>
          <button id="ventr-minimize">—</button>
        </div>
      </div>
      <div id="ventr-body">
        <div id="ventr-empty">Geen items in wachtrij.<br>Ga naar <a href="https://ventr.nl" target="_blank">ventr.nl</a> 🌸</div>
        <div id="ventr-list"></div>
        <div id="ventr-status"></div>
        <div style="padding:8px 10px;border-top:1px solid rgba(201,149,108,0.2);margin-top:6px">
          <div style="font-size:9px;color:#8A7570;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">⚠️ Facebook vereist</div>
          <div style="font-size:10px;color:#8A7570;line-height:1.5">
            Locatie en categorie handmatig selecteren. Foto's en tekst worden automatisch ingevuld.
          </div>
        </div>
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
      <div class="ventr-item">
        <div class="ventr-item-photos">
          ${(item.photos||[]).slice(0,3).map(p=>`<img src="${p.preview||p}" alt="">`).join('')}
        </div>
        <div class="ventr-item-info">
          <div class="ventr-item-title">${esc(item.listing?.titel||'')}</div>
          <div class="ventr-item-meta">€${item.listing?.prijs}</div>
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
      // Facebook Marketplace heeft een specifieke wizard-flow
      setStatus("📸 Foto's uploaden...", 'info');
      await uploadPhotosFacebook(item.photos);
      await sleep(2000);

      setStatus('✏️ Titel invullen...', 'info');
      await fillFBInput(findFBField('Titel', 'Title'), item.listing.titel?.slice(0, 99));
      await sleep(500);

      setStatus('💶 Prijs invullen...', 'info');
      await fillFBInput(findFBField('Prijs', 'Price'), String(item.listing.prijs));
      await sleep(500);

      setStatus('📝 Beschrijving invullen...', 'info');
      await fillFBInput(findFBField('Beschrijving', 'Description'), item.listing.beschrijving);
      await sleep(500);

      setStatus('✅ Foto\'s en tekst ingevuld!\n⚠️ Selecteer nog: Categorie + Locatie', 'success');
      chrome.runtime.sendMessage({ type: 'VENTR_MARK_LISTED', id: item.id, platform: 'facebook' });

    } catch (err) {
      setStatus('❌ ' + err.message, 'error');
    }

    isPlacing = false; pendingItem = null;
    loadQueue(); updatePanel();
  }

  // ── FACEBOOK SPECIFIEKE HELPERS ────────────────────────────────────────────

  function findFBField(...labels) {
    // Facebook gebruikt aria-labels en placeholders
    for (const label of labels) {
      const el = document.querySelector(
        `[aria-label*="${label}" i], [placeholder*="${label}" i], label:has(~ [aria-label*="${label}" i])`
      );
      if (el && el.offsetParent !== null) {
        // Als het een label is, zoek het bijbehorende input
        if (el.tagName === 'LABEL') {
          const input = document.getElementById(el.htmlFor) ||
            el.closest('[data-testid]')?.querySelector('input, textarea');
          if (input) return input;
        }
        return el;
      }
    }
    // Fallback: zoek via React's internal state
    const allInputs = [...document.querySelectorAll('input:not([type="hidden"]), textarea')];
    return allInputs.find(el => {
      const ariaLabel = el.getAttribute('aria-label') || '';
      return labels.some(l => ariaLabel.toLowerCase().includes(l.toLowerCase()));
    });
  }

  async function fillFBInput(el, value) {
    if (!el || !value) return;
    el.click();
    el.focus();
    await sleep(200);

    // Facebook React vereist native input events
    const setter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;

    // Leeg eerst
    if (setter) setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));

    await sleep(100);

    // Vul in
    if (setter) setter.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  async function uploadPhotosFacebook(photos) {
    if (!photos?.length) return false;

    // Facebook heeft meerdere mogelijke foto-upload inputs
    const input = document.querySelector(
      'input[type="file"][accept*="image"], input[type="file"][multiple]'
    );
    if (!input) {
      // Probeer de upload-knop te vinden en te klikken
      const uploadBtn = document.querySelector(
        '[aria-label*="foto" i], [aria-label*="photo" i], [aria-label*="afbeelding" i]'
      );
      if (uploadBtn) uploadBtn.click();
      await sleep(800);
      // Probeer opnieuw na klik
      const inputAfterClick = document.querySelector('input[type="file"]');
      if (!inputAfterClick) return false;
    }

    const targetInput = document.querySelector('input[type="file"]');
    if (!targetInput) return false;

    const dt = new DataTransfer();
    for (let i = 0; i < Math.min(photos.length, 10); i++) {
      try {
        const src = photos[i].full || photos[i].preview || photos[i];
        const blob = await fetch(src).then(r => r.blob());
        dt.items.add(new File([blob], `ventr-fb-${i+1}.jpg`, { type: 'image/jpeg' }));
      } catch {}
    }

    if (!dt.files.length) return false;

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(targetInput, dt.files);
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── START ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
