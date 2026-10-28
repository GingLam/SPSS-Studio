(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.getAttribute('data-action');
      if (['start', 'choose', 'cancel', 'report'].includes(type)) vscode.postMessage({ type });
    });
  });
})();
