(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const checkbox = document.getElementById('suppress-after-updates');
  const status = document.getElementById('preference-status');
  if (!(checkbox instanceof HTMLInputElement) || !status) {
    return;
  }

  checkbox.addEventListener('change', () => {
    checkbox.disabled = true;
    status.textContent = document.body.dataset.saving ?? '';
    vscode.postMessage({ type: 'setSuppressAfterUpdates', value: checkbox.checked });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'suppressPreferenceSaved' || typeof message.value !== 'boolean') {
      return;
    }
    checkbox.checked = message.value;
    checkbox.disabled = false;
    status.textContent = message.value
      ? document.body.dataset.savedOn ?? ''
      : document.body.dataset.savedOff ?? '';
  });
})();
