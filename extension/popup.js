// VENTR Connect — Popup script

function render(queue) {
  const pending = queue.filter(q => q.status === 'pending');
  const done    = queue.filter(q => q.status === 'done');

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
    const isDone = item.status === 'done';
    return `
      <div class="queue-item ${isDone ? 'done' : ''}">
        ${thumb ? `<img class="qi-thumb" src="${thumb}" alt="">` : ''}
        <div class="qi-info">
          <div class="qi-title">${esc(item.listing?.titel || '—')}</div>
          <div class="qi-price">€${item.listing?.prijs || '?'}</div>
        </div>
        <div class="qi-status ${isDone ? 'status-done' : 'status-pending'}">
          ${isDone ? '✅' : '⏳'}
        </div>
      </div>`;
  }).join('');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Laad queue
chrome.runtime.sendMessage({ type: 'VENTR_GET_QUEUE' }, res => {
  render(res?.queue || []);
});

// Knoppen
document.getElementById('btnVinted').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.vinted.nl/sell' });
});

document.getElementById('btnClearDone').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'VENTR_CLEAR_DONE' }, res => {
    chrome.runtime.sendMessage({ type: 'VENTR_GET_QUEUE' }, res2 => render(res2?.queue || []));
  });
});
