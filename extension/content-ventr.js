// VENTR Connect — Content script op ventr.nl
// Luistert naar berichten van de VENTR app en stuurt ze door naar de extensie

window.addEventListener('message', e => {
  if (e.source !== window || !e.data?.type?.startsWith('VENTR_')) return;
  if (e.data.type.endsWith('_RESPONSE')) return;

  const msg = e.data;

  // Queue-operaties direct via chrome.storage — betrouwbaarder dan via background
  if (msg.type === 'VENTR_ADD_TO_QUEUE') {
    addToQueueDirect(msg.item).then(count =>
      window.postMessage({ type: 'VENTR_ADD_TO_QUEUE_RESPONSE', ok: true, count }, '*')
    );
    return;
  }

  if (msg.type === 'VENTR_GET_QUEUE') {
    getQueueDirect().then(queue =>
      window.postMessage({ type: 'VENTR_GET_QUEUE_RESPONSE', queue }, '*')
    );
    return;
  }

  if (msg.type === 'VENTR_REMOVE_FROM_QUEUE') {
    removeFromQueueDirect(msg.id).then(count =>
      window.postMessage({ type: 'VENTR_REMOVE_FROM_QUEUE_RESPONSE', ok: true, count }, '*')
    );
    return;
  }

  if (msg.type === 'VENTR_MARK_DONE') {
    markStatusDirect(msg.id, 'done').then(() =>
      window.postMessage({ type: 'VENTR_MARK_DONE_RESPONSE', ok: true }, '*')
    );
    return;
  }

  if (msg.type === 'VENTR_CLEAR_DONE') {
    clearDoneDirect().then(count =>
      window.postMessage({ type: 'VENTR_CLEAR_DONE_RESPONSE', ok: true, count }, '*')
    );
    return;
  }

  // Overige berichten via background (VENTR_CROSSLIST, VENTR_OPEN_*, etc.)
  try {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) {
        console.warn('[VENTR] background niet bereikbaar:', chrome.runtime.lastError.message);
        return;
      }
      window.postMessage({ type: msg.type + '_RESPONSE', ...response }, '*');
    });
  } catch(e) {
    console.warn('[VENTR] sendMessage exception:', e.message);
  }
});

// ── FOTO RESIZE VOOR QUEUE ────────────────────────────────────────────────────

function resizeForQueue(dataUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800; // Optie B + A: 800px is genoeg voor Vinted
      const scale = Math.min(MAX / img.width, MAX / img.height, 1);
      const c = document.createElement('canvas');
      c.width  = Math.round(img.width  * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high'; // Optie B: bicubische kwaliteit
      ctx.drawImage(img, 0, 0, c.width, c.height);
      res({ preview: c.toDataURL('image/jpeg', 0.88) }); // 0.88 = hoge kwaliteit
    };
    img.onerror = rej;
    img.src = dataUrl;
  });
}

// ── DIRECTE STORAGE OPERATIES ─────────────────────────────────────────────────

function getQueueDirect() {
  return new Promise(res =>
    chrome.storage.local.get('ventr_queue', d => res(d.ventr_queue || []))
  );
}

async function addToQueueDirect(item) {
  const queue = await getQueueDirect();
  const idx = queue.findIndex(q => q.id === item.id);

  // Sla medium kwaliteit op (600px) — balans tussen kwaliteit en opslaggrootte
  const photos = await Promise.all((item.photos || []).map(async p => {
    const src = p.full || p.preview || p;
    if (!src || typeof src !== 'string' || !src.startsWith('data:')) return { preview: src };
    try {
      return await resizeForQueue(src);
    } catch { return { preview: p.preview || src }; }
  }));

  const entry = { ...item, photos, status: 'pending', addedAt: item.addedAt || Date.now() };
  if (idx >= 0) queue[idx] = entry; else queue.push(entry);

  try {
    await new Promise((res, rej) => {
      chrome.storage.local.set({ ventr_queue: queue }, () => {
        if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
        else res();
      });
    });
  } catch(e) {
    // Queue te groot — verwijder oudste items en probeer opnieuw
    console.warn('[VENTR] Queue opslaan mislukt, oudste items verwijderen:', e.message);
    const trimmed = queue.slice(-20); // Bewaar max 20 meest recente
    await new Promise(res => chrome.storage.local.set({ ventr_queue: trimmed }, res));
  }

  return queue.filter(q => q.status === 'pending').length;
}

async function removeFromQueueDirect(id) {
  const queue = (await getQueueDirect()).filter(q => q.id !== id);
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
  return queue.length;
}

async function markStatusDirect(id, status) {
  const queue = await getQueueDirect();
  const item = queue.find(q => q.id === id);
  if (item) item.status = status;
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
}

async function clearDoneDirect() {
  const queue = (await getQueueDirect()).filter(q => q.status !== 'done');
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
  return queue.length;
}

// Vinted activiteitscheck vanuit background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'VENTR_CHECK_ACTIVITY') {
    // Lees activiteitsdata van Vinted
    try {
      const msgBadge = document.querySelector('[data-testid="inbox-notification"], [class*="unread"]');
      const unread = msgBadge ? parseInt(msgBadge.textContent) || 1 : 0;
      sendResponse({ ok: true, data: { newMessages: unread, newOffers: 0, highLikers: [] } });
      if (unread > 0) {
        chrome.runtime.sendMessage({ type: 'VENTR_ACTIVITY_UPDATE', data: { newMessages: unread } });
      }
    } catch { sendResponse({ ok: false }); }
    return true;
  }
});

// Signaleer aan VENTR dat de extensie actief is
window.postMessage({ type: 'VENTR_EXTENSION_READY' }, '*');

// Ruim te grote queue items op bij laden
chrome.storage.local.get('ventr_queue', d => {
  const q = d.ventr_queue || [];
  if (q.length > 50) {
    // Bewaar alleen de 30 meest recente pending items
    const cleaned = q.filter(i => i.status === 'pending').slice(-30);
    chrome.storage.local.set({ ventr_queue: cleaned });
    console.log('[VENTR] Queue opgeschoond:', q.length, '→', cleaned.length, 'items');
  }
});
