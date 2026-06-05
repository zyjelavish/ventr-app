// VENTR Connect — Background Service Worker
// STABIELE KERN: alleen queue beheer
// Geavanceerde features (alarms, notifications, context menu) worden later toegevoegd

// ── QUEUE MANAGEMENT ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'VENTR_ADD_TO_QUEUE') {
    addToQueue(msg.item)
      .then(queue => sendResponse({ ok: true, count: queue.filter(q => q.status === 'pending').length }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'VENTR_GET_QUEUE') {
    getQueue()
      .then(queue => sendResponse({ queue }))
      .catch(e => sendResponse({ queue: [] }));
    return true;
  }

  if (msg.type === 'VENTR_REMOVE_FROM_QUEUE') {
    removeFromQueue(msg.id)
      .then(queue => sendResponse({ ok: true, count: queue.length }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'VENTR_MARK_DONE') {
    markStatus(msg.id, 'done')
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'VENTR_MARK_LISTED') {
    markStatus(msg.id, 'listed', { listedAt: Date.now(), platform: msg.platform || 'vinted' })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'VENTR_CLEAR_DONE') {
    clearByStatus('done')
      .then(queue => sendResponse({ ok: true, count: queue.length }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'VENTR_CLEAR_ALL') {
    chrome.storage.local.set({ ventr_queue: [] }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'VENTR_GET_SETTINGS') {
    chrome.storage.local.get(['ventr_repost_rules', 'ventr_price_rules'], d => sendResponse(d));
    return true;
  }

  if (msg.type === 'VENTR_SAVE_SETTINGS') {
    chrome.storage.local.set(msg.settings || {}, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'VENTR_OPEN_MARKTPLAATS') {
    chrome.tabs.create({ url: 'https://www.marktplaats.nl/plaats-advertentie' });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'VENTR_OPEN_FACEBOOK') {
    chrome.tabs.create({ url: 'https://www.facebook.com/marketplace/create/item' });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'VENTR_CROSSLIST') {
    crosslist(msg.item, msg.platform)
      .then(tabId => sendResponse({ ok: true, tabId }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

});

// ── CROSSLISTING ──────────────────────────────────────────────────────────────

async function crosslist(item, platform) {
  const urls = {
    marktplaats: 'https://www.marktplaats.nl/plaats-advertentie',
    facebook:    'https://www.facebook.com/marketplace/create/item',
  };
  const url = urls[platform];
  if (!url) throw new Error('Onbekend platform: ' + platform);

  const tab = await chrome.tabs.create({ url });

  chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
    if (tabId !== tab.id || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(listener);
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, { type: 'VENTR_FILL_LISTING', item, platform })
        .catch(() => {}); // tab kan nog niet klaar zijn
    }, 2500);
  });

  return tab.id;
}

// ── STORAGE HELPERS ───────────────────────────────────────────────────────────

function getQueue() {
  return new Promise(res => {
    chrome.storage.local.get('ventr_queue', d => res(d.ventr_queue || []));
  });
}

async function addToQueue(item) {
  const queue = await getQueue();
  const idx = queue.findIndex(q => q.id === item.id);
  const entry = { ...item, status: item.status || 'pending', addedAt: item.addedAt || Date.now() };
  if (idx >= 0) queue[idx] = entry;
  else queue.push(entry);
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
  return queue;
}

async function removeFromQueue(id) {
  const queue = (await getQueue()).filter(q => q.id !== id);
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
  return queue;
}

async function markStatus(id, status, extra = {}) {
  const queue = await getQueue();
  const item = queue.find(q => q.id === id);
  if (item) Object.assign(item, { status, ...extra });
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
}

async function clearByStatus(status) {
  const queue = (await getQueue()).filter(q => q.status !== status);
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
  return queue;
}
