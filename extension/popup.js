// VENTR Connect — Popup v2

let currentTab = 'queue';

function renderTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = el.id === `tab-${currentTab}` ? 'block' : 'none';
  });
}

// ── QUEUE TAB ──────────────────────────────────────────────────────────────

function renderQueue(queue) {
  const pending = queue.filter(q => q.status === 'pending');
  const done    = queue.filter(q => q.status === 'done' || q.status === 'listed');

  document.getElementById('statPending').textContent = pending.length;
  document.getElementById('statDone').textContent    = done.length;

  const list  = document.getElementById('queueList');
  const empty = document.getElementById('emptyMsg');

  if (queue.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = queue.map(item => {
    const thumb = item.photos?.[0]?.preview || '';
    const isDone = item.status === 'done' || item.status === 'listed';
    const platIcon = item.platform === 'marktplaats' ? '🏠' : item.platform === 'facebook' ? '📘' : '🌸';
    return `
      <div class="queue-item ${isDone ? 'done' : ''}">
        ${thumb ? `<img class="qi-thumb" src="${thumb}" alt="">` : ''}
        <div class="qi-info">
          <div class="qi-title">${esc(item.listing?.titel || '—')}</div>
          <div class="qi-price">€${item.listing?.prijs || '?'} ${platIcon}</div>
        </div>
        <div class="qi-status ${isDone ? 'status-done' : 'status-pending'}">${isDone ? '✅' : '⏳'}</div>
      </div>`;
  }).join('');
}

// ── SETTINGS TAB ──────────────────────────────────────────────────────────

function loadSettings() {
  chrome.runtime.sendMessage({ type: 'VENTR_GET_SETTINGS' }, res => {
    const repost = res?.ventr_repost_rules || {};
    const price  = res?.ventr_price_rules  || {};

    const repostEl = document.getElementById('repost-enabled');
    const priceEl  = document.getElementById('price-enabled');
    const drop14El = document.getElementById('price-drop14');
    const drop30El = document.getElementById('price-drop30');

    if (repostEl) repostEl.checked = !!repost.enabled;
    if (priceEl)  priceEl.checked  = !!price.enabled;
    if (drop14El) drop14El.value   = price.after14days || 10;
    if (drop30El) drop30El.value   = price.after30days || 15;
  });
}

function saveSettings() {
  const settings = {
    ventr_repost_rules: {
      enabled: document.getElementById('repost-enabled')?.checked,
      peakHours: [18, 19, 20, 21],
    },
    ventr_price_rules: {
      enabled: document.getElementById('price-enabled')?.checked,
      after14days: +document.getElementById('price-drop14')?.value || 10,
      after30days: +document.getElementById('price-drop30')?.value || 15,
    },
  };
  chrome.runtime.sendMessage({ type: 'VENTR_SAVE_SETTINGS', settings }, () => {
    const btn = document.getElementById('save-btn');
    if (btn) { btn.textContent = '✅ Opgeslagen!'; setTimeout(() => { btn.textContent = 'Opslaan'; }, 2000); }
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      renderTabs();
      if (currentTab === 'settings') loadSettings();
    });
  });
  renderTabs();

  // Queue laden
  chrome.runtime.sendMessage({ type: 'VENTR_GET_QUEUE' }, res => {
    renderQueue(res?.queue || []);
  });

  // Knoppen
  document.getElementById('btnVinted')?.addEventListener('click', () =>
    chrome.tabs.create({ url: 'https://www.vinted.nl/sell' }));
  document.getElementById('btnMarktplaats')?.addEventListener('click', () =>
    chrome.tabs.create({ url: 'https://www.marktplaats.nl/plaats-advertentie' }));
  document.getElementById('btnFacebook')?.addEventListener('click', () =>
    chrome.tabs.create({ url: 'https://www.facebook.com/marketplace/create/item' }));
  document.getElementById('btnVentr')?.addEventListener('click', () =>
    chrome.tabs.create({ url: 'https://ventr.nl' }));
  document.getElementById('btnClearDone')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'VENTR_CLEAR_DONE' }, () => {
      chrome.runtime.sendMessage({ type: 'VENTR_GET_QUEUE' }, res => renderQueue(res?.queue || []));
    });
  });
  document.getElementById('save-btn')?.addEventListener('click', saveSettings);
});

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
