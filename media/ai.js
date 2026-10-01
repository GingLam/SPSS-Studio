(() => {
  const vscode = acquireVsCodeApi();
  const elements = {
    apiKey: document.getElementById('api-key'),
    banner: document.getElementById('banner'),
    baseUrl: document.getElementById('base-url'),
    cancelConfiguration: document.getElementById('cancel-configuration'),
    clear: document.getElementById('clear'),
    configuration: document.getElementById('configuration'),
    configure: document.getElementById('configure'),
    deleteKey: document.getElementById('delete-key'),
    emptyState: document.getElementById('empty-state'),
    keyStatus: document.getElementById('key-status'),
    messages: document.getElementById('messages'),
    model: document.getElementById('model'),
    provider: document.getElementById('provider'),
    providerHelp: document.getElementById('provider-help'),
    providerSummary: document.getElementById('provider-summary'),
    question: document.getElementById('question'),
    saveConfiguration: document.getElementById('save-configuration'),
    send: document.getElementById('send'),
    stop: document.getElementById('stop'),
  };

  let presets = [];
  let currentAssistant;

  function setBusy(busy) {
    elements.send.disabled = busy;
    elements.stop.disabled = !busy;
    elements.question.disabled = busy;
  }

  function setBanner(message, error = true) {
    elements.banner.textContent = message;
    elements.banner.classList.toggle('error', error);
    elements.banner.hidden = !message;
  }

  function clearDisplay() {
    elements.messages.replaceChildren(elements.emptyState);
    elements.emptyState.hidden = false;
    currentAssistant = undefined;
    setBusy(false);
  }

  function createMessage(role) {
    elements.emptyState.hidden = true;
    const article = document.createElement('article');
    article.className = `message ${role}`;
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'You' : 'SPSS AI';
    const body = document.createElement('div');
    body.className = 'message-body';
    article.append(label, body);
    elements.messages.append(article);
    elements.messages.scrollTop = elements.messages.scrollHeight;
    return body;
  }

  function flashButton(button, label) {
    const original = button.textContent;
    button.textContent = label;
    window.setTimeout(() => {
      button.textContent = original;
    }, 1_200);
  }

  function renderSegments(target, segments) {
    target.replaceChildren();
    for (const segment of segments) {
      if (segment.type === 'text') {
        const prose = document.createElement('div');
        prose.className = 'prose';
        prose.textContent = segment.content;
        target.append(prose);
        continue;
      }
      const block = document.createElement('section');
      block.className = 'code-block';
      const header = document.createElement('div');
      header.className = 'code-header';
      const language = document.createElement('span');
      language.textContent = segment.language || 'code';
      const actions = document.createElement('div');
      actions.className = 'code-actions';
      const insert = document.createElement('button');
      insert.type = 'button';
      insert.textContent = 'Insert';
      insert.addEventListener('click', () => {
        vscode.postMessage({ type: 'insertCode', code: segment.content });
        flashButton(insert, 'Inserted');
      });
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        vscode.postMessage({ type: 'copyCode', code: segment.content });
        flashButton(copy, 'Copied');
      });
      actions.append(insert, copy);
      header.append(language, actions);
      const code = document.createElement('code');
      code.textContent = segment.content;
      const pre = document.createElement('pre');
      pre.append(code);
      block.append(header, pre);
      target.append(block);
    }
  }

  function appendStoredMessage(message) {
    const body = createMessage(message.role);
    if (message.role === 'assistant') {
      renderSegments(body, message.segments || []);
    } else {
      body.textContent = message.content || '';
    }
  }

  function populateProviders() {
    elements.provider.replaceChildren();
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      elements.provider.append(option);
    }
  }

  function applyConfigurationState(state) {
    const configuration = state.configuration;
    elements.provider.value = configuration.providerId;
    elements.baseUrl.value = configuration.baseUrl;
    elements.model.value = configuration.model;
    const preset = presets.find((candidate) => candidate.id === configuration.providerId);
    elements.model.placeholder = preset?.modelPlaceholder || 'Enter a model identifier';
    elements.keyStatus.textContent = state.hasApiKey ? 'API Key saved securely.' : 'No API Key saved.';
    elements.deleteKey.disabled = !state.hasApiKey;
    elements.providerSummary.textContent = state.configured
      ? `${preset?.label || configuration.providerId} · ${configuration.model}`
      : 'Not configured';
    elements.apiKey.value = '';
    if (state.configured) {
      elements.configuration.hidden = true;
      setBanner('');
    }
  }

  function showConfiguration() {
    elements.configuration.hidden = false;
    elements.provider.focus();
  }

  function sendQuestion() {
    const question = elements.question.value.trim();
    if (!question) {
      return;
    }
    vscode.postMessage({ type: 'sendQuestion', question });
    elements.question.value = '';
  }

  elements.configure.addEventListener('click', showConfiguration);
  elements.cancelConfiguration.addEventListener('click', () => {
    elements.configuration.hidden = true;
    setBanner('');
  });
  elements.provider.addEventListener('change', () => {
    const preset = presets.find((candidate) => candidate.id === elements.provider.value);
    if (!preset) {
      return;
    }
    elements.baseUrl.value = preset.baseUrl;
    elements.model.value = '';
    elements.model.placeholder = preset.modelPlaceholder;
    elements.apiKey.value = '';
    elements.keyStatus.textContent = 'Enter a key or leave blank to keep an existing key for this provider.';
  });
  elements.saveConfiguration.addEventListener('click', () => {
    vscode.postMessage({
      type: 'saveConfiguration',
      providerId: elements.provider.value,
      baseUrl: elements.baseUrl.value.trim(),
      model: elements.model.value.trim(),
      apiKey: elements.apiKey.value,
    });
  });
  elements.deleteKey.addEventListener('click', () => {
    vscode.postMessage({ type: 'deleteApiKey', providerId: elements.provider.value });
  });
  elements.providerHelp.addEventListener('click', () => {
    vscode.postMessage({ type: 'openProviderHelp', providerId: elements.provider.value });
  });
  elements.send.addEventListener('click', sendQuestion);
  elements.stop.addEventListener('click', () => {
    vscode.postMessage({ type: 'stop' });
  });
  elements.clear.addEventListener('click', () => {
    vscode.postMessage({ type: 'clear' });
  });
  elements.question.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendQuestion();
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'initialize') {
      presets = message.presets;
      populateProviders();
      applyConfigurationState(message.state);
      clearDisplay();
      for (const item of message.history) {
        appendStoredMessage(item);
      }
      if (!message.state.configured) {
        showConfiguration();
      }
    } else if (message.type === 'configurationState') {
      applyConfigurationState(message.state);
    } else if (message.type === 'configurationError') {
      setBanner(message.message);
      showConfiguration();
    } else if (message.type === 'showConfiguration') {
      showConfiguration();
    } else if (message.type === 'appendUser') {
      const body = createMessage('user');
      body.textContent = message.content;
    } else if (message.type === 'responseStarted') {
      currentAssistant = createMessage('assistant');
      currentAssistant.classList.add('streaming');
      setBusy(true);
      setBanner('');
    } else if (message.type === 'responseDelta') {
      if (currentAssistant) {
        currentAssistant.textContent += message.content;
        elements.messages.scrollTop = elements.messages.scrollHeight;
      }
    } else if (message.type === 'responseCompleted') {
      if (currentAssistant) {
        currentAssistant.classList.remove('streaming');
        renderSegments(currentAssistant, message.segments);
      }
      currentAssistant = undefined;
      setBusy(false);
    } else if (message.type === 'responseFailed') {
      currentAssistant?.classList.remove('streaming');
      currentAssistant = undefined;
      setBusy(false);
      setBanner(message.message, !message.cancelled);
    } else if (message.type === 'conversationCleared') {
      clearDisplay();
      setBanner('');
    }
  });
})();
