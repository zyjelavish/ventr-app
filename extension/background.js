// VENTR Connect — Background Service Worker
// Beheert de queue opslag en communicatie tussen VENTR en Vinted

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'VENTR_ADD_TO_QUEUE') {
    addToQueue(msg.item).then(queue => sendResponse({ ok: true, count: queue.length }));
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
    markDone(msg.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'VENTR_CLEAR_DONE') {
    clearDone().then(queue => sendResponse({ ok: true, count: queue.length }));
    return true;
  }

  if (msg.type === 'VENTR_CLEAR_ALL') {
    chrome.storage.local.set({ ventr_queue: [] }, () => sendResponse({ ok: true }));
    return true;
  }
});

async function getQueue() {
  return new Promise(res => {
    chrome.storage.local.get('ventr_queue', d => res(d.ventr_queue || []));
  });
}

async function addToQueue(item) {
  const queue = await getQueue();
  // Verwijder duplicaat als al in queue
  const idx = queue.findIndex(q => q.id === item.id);
  if (idx >= 0) queue[idx] = item;
  else queue.push({ ...item, status: 'pending', addedAt: Date.now() });
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
  return queue;
}

async function removeFromQueue(id) {
  const queue = (await getQueue()).filter(q => q.id !== id);
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
  return queue;
}

async function markDone(id) {
  const queue = await getQueue();
  const item = queue.find(q => q.id === id);
  if (item) { item.status = 'done'; item.doneAt = Date.now(); }
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
}

async function clearDone() {
  const queue = (await getQueue()).filter(q => q.status !== 'done');
  await new Promise(res => chrome.storage.local.set({ ventr_queue: queue }, res));
  return queue;
}
