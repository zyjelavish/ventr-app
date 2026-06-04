// VENTR Connect — Content script op ventr.nl
// Luistert naar berichten van de VENTR app en stuurt ze door naar de extensie

window.addEventListener('message', e => {
  if (e.source !== window || !e.data?.type?.startsWith('VENTR_')) return;

  chrome.runtime.sendMessage(e.data, response => {
    // Stuur respons terug naar VENTR app
    window.postMessage({ type: e.data.type + '_RESPONSE', ...response }, '*');
  });
});

// Signaleer aan VENTR dat de extensie actief is
window.postMessage({ type: 'VENTR_EXTENSION_READY' }, '*');
