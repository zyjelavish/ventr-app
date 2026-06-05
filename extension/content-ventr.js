// VENTR Connect — Content script op ventr.nl
// Luistert naar berichten van de VENTR app en stuurt ze door naar de extensie

window.addEventListener('message', e => {
  if (e.source !== window || !e.data?.type?.startsWith('VENTR_')) return;
  if (e.data.type.endsWith('_RESPONSE')) return; // Geen response-loops

  chrome.runtime.sendMessage(e.data, response => {
    if (chrome.runtime.lastError) return;
    window.postMessage({ type: e.data.type + '_RESPONSE', ...response }, '*');
  });
});

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
