// VENTR Connect — Background Service Worker v2
// Beheert: queue, notifications, repost scheduler, liker monitor, context menu

// ── INIT ─────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
  setupAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
});

// ── CONTEXT MENU ───────────────────────────────────────────────────────────────

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'ventr-add-image',
      title: '📸 Voeg toe aan VENTR listing',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: 'ventr-add-page',
      title: '🛍️ Importeer product naar VENTR',
      contexts: ['page'],
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ventr-add-image') {
    chrome.storage.local.get('ventr_draft_images', d => {
      const imgs = d.ventr_draft_images || [];
      imgs.push({ src: info.srcUrl, pageUrl: tab?.url, addedAt: Date.now() });
      chrome.storage.local.set({ ventr_draft_images: imgs });
      notify('📸 Foto toegevoegd!', 'Open VENTR om de listing te starten.', 'image');
    });
  }
  if (info.menuItemId === 'ventr-add-page') {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        url: location.href,
        image: document.querySelector('meta[property="og:image"]')?.content
          || document.querySelector('.product-image img, [class*="product"] img')?.src,
        price: document.querySelector('[itemprop="price"], [class*="price"]')?.textContent?.trim(),
      })
    }).then(results => {
      const data = results?.[0]?.result;
      if (data) {
        chrome.storage.local.get('ventr_draft_images', d => {
          const imgs = d.ventr_draft_images || [];
          imgs.push({ ...data, addedAt: Date.now() });
          chrome.storage.local.set({ ventr_draft_images: imgs });
          notify('🛍️ Product geïmporteerd!', data.title?.slice(0, 60) || 'Pagina opgeslagen in VENTR.', 'product');
        });
      }
    });
  }
});

// ── ALARMS & SCHEDULER ────────────────────────────────────────────────────────

function setupAlarms() {
  // Vinted monitor: elke 15 minuten checken op likers/berichten
  chrome.alarms.create('ventr-vinted-monitor', { periodInMinutes: 15 });
  // Repost checker: elk uur
  chrome.alarms.create('ventr-repost-check', { periodInMinutes: 60 });
  // Dynamische prijsverlaging: dagelijks om 02:00
  chrome.alarms.create('ventr-price-drop', { when: nextOccurrenceOf(2, 0), periodInMinutes: 1440 });
}

function nextOccurrenceOf(hour, minute) {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'ventr-vinted-monitor') checkVintedActivity();
  if (alarm.name === 'ventr-repost-check')   checkRepostSchedule();
  if (alarm.name === 'ventr-price-drop')      checkPriceDropRules();
});

// ── VINTED ACTIVITY MONITOR ───────────────────────────────────────────────────

async function checkVintedActivity() {
  const { ventr_monitor_enabled, ventr_vinted_user } = await storageGet([
    'ventr_monitor_enabled', 'ventr_vinted_user'
  ]);
  if (!ventr_monitor_enabled || !ventr_vinted_user) return;

  try {
    // Check Vinted inbox via open tab of via fetch
    const tabs = await chrome.tabs.query({ url: 'https://www.vinted.nl/*' });
    if (tabs.length > 0) {
      // Stuur bericht naar Vinted tab om activiteit te checken
      chrome.tabs.sendMessage(tabs[0].id, { type: 'VENTR_CHECK_ACTIVITY' });
    }
  } catch {}
}

// ── REPOST SCHEDULER ──────────────────────────────────────────────────────────

async function checkRepostSchedule() {
  const { ventr_repost_rules } = await storageGet(['ventr_repost_rules']);
  if (!ventr_repost_rules?.enabled) return;

  const rules = ventr_repost_rules;
  const now = new Date();
  const hour = now.getHours();

  // Controleer of het een piekuur is
  const peakHours = rules.peakHours || [18, 19, 20, 21]; // standaard avonduren
  if (!peakHours.includes(hour)) return;

  const { ventr_queue } = await storageGet(['ventr_queue']);
  const queue = ventr_queue || [];
  const listed = queue.filter(q => q.status === 'listed');

  if (listed.length > 0) {
    notify(
      '⏰ Piekuur actief!',
      `${listed.length} items klaar om te herplaatsen. Open Vinted om te bumpen.`,
      'repost'
    );
  }
}

// ── DYNAMISCHE PRIJSVERLAGING ─────────────────────────────────────────────────

async function checkPriceDropRules() {
  const { ventr_price_rules, ventr_queue } = await storageGet([
    'ventr_price_rules', 'ventr_queue'
  ]);
  if (!ventr_price_rules?.enabled) return;

  const queue = ventr_queue || [];
  const now = Date.now();
  const drops = [];

  queue.forEach(item => {
    if (item.status !== 'listed' || !item.listedAt) return;
    const daysSince = (now - item.listedAt) / (1000 * 60 * 60 * 24);
    const rule14 = ventr_price_rules.after14days;
    const rule30 = ventr_price_rules.after30days;

    if (daysSince >= 30 && rule30 && !item.dropped30) {
      drops.push({ id: item.id, reason: `30 dagen online`, pct: rule30 });
    } else if (daysSince >= 14 && rule14 && !item.dropped14) {
      drops.push({ id: item.id, reason: `14 dagen online`, pct: rule14 });
    }
  });

  if (drops.length > 0) {
    notify(
      '💸 Prijsverlaging klaar',
      `${drops.length} items: ${drops[0].reason} (${drops[0].pct}% korting). Open VENTR.`,
      'pricedrop'
    );
  }
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

function notify(title, message, type = 'info') {
  chrome.notifications.create(`ventr-${type}-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
    priority: 2,
  });
}

// ── QUEUE MANAGEMENT ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'VENTR_ADD_TO_QUEUE') {
    addToQueue(msg.item).then(queue => sendResponse({ ok: true, count: queue.filter(q=>q.status==='pending').length }));
    return true;
  }
  if (msg.type === 'VENTR_ADD_BATCH_TO_QUEUE') {
    (async () => {
      let queue;
      for (const item of msg.items) queue = await addToQueue(item);
      sendResponse({ ok: true, count: (queue||[]).filter(q=>q.status==='pending').length });
    })();
    return true;
  }
  if (msg.type === 'VENTR_GET_QUEUE') {
    getQueue().then(queue => sendResponse({ queue }));
    return true;
  }
  if (msg.type === 'VENTR_REMOVE_FROM_QUEUE') {
    removeFromQueue(msg.id).then(queue => sendResponse({ ok: true, count: queue.length }));
    return true;
  }
  if (msg.type === 'VENTR_MARK_DONE') {
    markStatus(msg.id, 'done').then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'VENTR_MARK_LISTED') {
    markStatus(msg.id, 'listed', { listedAt: Date.now(), platform: msg.platform || 'vinted' })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'VENTR_CLEAR_DONE') {
    clearByStatus('done').then(queue => sendResponse({ ok: true, count: queue.length }));
    return true;
  }
  if (msg.type === 'VENTR_CLEAR_ALL') {
    chrome.storage.local.set({ ventr_queue: [] }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'VENTR_GET_SETTINGS') {
    chrome.storage.local.get([
      'ventr_repost_rules', 'ventr_price_rules', 'ventr_monitor_enabled',
      'ventr_draft_images', 'ventr_vinted_user'
    ], d => sendResponse(d));
    return true;
  }
  if (msg.type === 'VENTR_SAVE_SETTINGS') {
    chrome.storage.local.set(msg.settings, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'VENTR_ACTIVITY_UPDATE') {
    // Vinted content script rapporteert activiteit
    handleActivityUpdate(msg.data);
    sendResponse({ ok: true });
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
    handleCrosslist(msg.item, msg.platform, sendResponse);
    return true;
  }
  if (msg.type === 'VENTR_GET_DRAFT_IMAGES') {
    chrome.storage.local.get('ventr_draft_images', d => sendResponse({ images: d.ventr_draft_images || [] }));
    return true;
  }
  if (msg.type === 'VENTR_CLEAR_DRAFT_IMAGES') {
    chrome.storage.local.set({ ventr_draft_images: [] }, () => sendResponse({ ok: true }));
    return true;
  }
});

// ── CROSSLISTING ──────────────────────────────────────────────────────────────

async function handleCrosslist(item, platform, sendResponse) {
  try {
    let url;
    if (platform === 'marktplaats') url = 'https://www.marktplaats.nl/plaats-advertentie';
    if (platform === 'facebook')    url = 'https://www.facebook.com/marketplace/create/item';

    const tab = await chrome.tabs.create({ url });

    // Wacht tot tab geladen is, stuur dan item data
    const listener = (tabId, info) => {
      if (tabId !== tab.id || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'VENTR_FILL_LISTING',
          item,
          platform,
        });
      }, 2000);
    };
    chrome.tabs.onUpdated.addListener(listener);
    sendResponse({ ok: true, tabId: tab.id });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ── VINTED ACTIVITEIT HANDLER ─────────────────────────────────────────────────

function handleActivityUpdate(data) {
  if (data?.newMessages > 0) {
    notify('💬 Nieuw bericht op Vinted!', `${data.newMessages} ongelezen bericht(en). Klik om te openen.`, 'message');
    // Update badge
    chrome.action.setBadgeText({ text: String(data.newMessages) });
    chrome.action.setBadgeBackgroundColor({ color: '#C9956C' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }

  if (data?.newOffers > 0) {
    notify('💰 Nieuw bod ontvangen!', `${data.newOffers} bod(den) wachten op jouw reactie.`, 'offer');
  }

  if (data?.highLikers?.length > 0) {
    const item = data.highLikers[0];
    notify(
      '❤️ Populair item!',
      `"${item.title}" heeft ${item.likers} likers. Stuur nu een aanbod voor snelle verkoop!`,
      'likers'
    );
  }
}

// ── STORAGE HELPERS ───────────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise(res => chrome.storage.local.get(keys, res));
}

async function getQueue() {
  const d = await storageGet('ventr_queue');
  return d.ventr_queue || [];
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
