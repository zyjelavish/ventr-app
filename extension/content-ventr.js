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

// Signaleer aan VENTR dat de extensie actief is
window.postMessage({ type: 'VENTR_EXTENSION_READY' }, '*');
