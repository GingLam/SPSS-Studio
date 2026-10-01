(() => {
  const vscode = acquireVsCodeApi();
  const elements = {
    activeProfile: document.getElementById('active-profile'),
    activeProfileLabel: document.getElementById('active-profile-label'),
    aiTitle: document.getElementById('ai-title'),
    apiKey: document.getElementById('api-key'),
    apiKeyLabel: document.getElementById('api-key-label'),
    banner: document.getElementById('banner'),
    baseUrl: document.getElementById('base-url'),
    baseUrlLabel: document.getElementById('base-url-label'),
    clearHistory: document.getElementById('clear-history'),
    deleteKey: document.getElementById('delete-key'),
    deleteProfile: document.getElementById('delete-profile'),
    duplicateProfile: document.getElementById('duplicate-profile'),
    historyHeading: document.getElementById('history-heading'),
    historyList: document.getElementById('history-list'),
    keyStatus: document.getElementById('key-status'),
    makeActive: document.getElementById('make-active'),
    manageProfiles: document.getElementById('manage-profiles'),
    messages: document.getElementById('messages'),
    model: document.getElementById('model'),
    modelLabel: document.getElementById('model-label'),
    newChat: document.getElementById('new-chat'),
    newProfile: document.getElementById('new-profile'),
    profileForm: document.getElementById('profile-form'),
    profileList: document.getElementById('profile-list'),
    profileName: document.getElementById('profile-name'),
    profileNameLabel: document.getElementById('profile-name-label'),
    provider: document.getElementById('provider'),
    providerHelp: document.getElementById('provider-help'),
    providerLabel: document.getElementById('provider-label'),
    question: document.getElementById('question'),
    saveProfile: document.getElementById('save-profile'),
    send: document.getElementById('send'),
    sendingStatus: document.getElementById('sending-status'),
    splitter: document.getElementById('splitter'),
    stop: document.getElementById('stop'),
    tabChat: document.getElementById('tab-chat'),
    tabHistory: document.getElementById('tab-history'),
    tabProfiles: document.getElementById('tab-profiles'),
    tabs: document.getElementById('tabs'),
    transcriptTitle: document.getElementById('transcript-title'),
  };

  const restored = vscode.getState() || {};
  let currentPage = ['chat', 'history', 'profiles'].includes(restored.page)
    ? restored.page
    : 'chat';
  let selectedProfileId = typeof restored.selectedProfileId === 'string'
    ? restored.selectedProfileId
    : undefined;
  let creatingProfile = false;
  let presets = [];
  let strings;
  let state = {
    busy: false,
    profiles: { profiles: [] },
    history: [],
  };
  let currentAssistant;
  let composerHeight = 112;

  function persistUiState() {
    const next = { page: currentPage };
    if (selectedProfileId) {
      next.selectedProfileId = selectedProfileId;
    }
    vscode.setState(next);
  }

  function setBanner(message, error = false) {
    elements.banner.textContent = message;
    elements.banner.classList.toggle('error', error);
    elements.banner.hidden = !message;
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.send.disabled = busy || state.profiles.profiles.length === 0;
    elements.stop.disabled = !busy;
    elements.question.disabled = busy;
    elements.activeProfile.disabled = busy || state.profiles.profiles.length === 0;
    elements.newChat.disabled = busy;
    elements.sendingStatus.textContent = busy ? strings.sending : '';
  }

  function showPage(page) {
    if (!['chat', 'history', 'profiles'].includes(page)) {
      return;
    }
    currentPage = page;
    for (const candidate of ['chat', 'history', 'profiles']) {
      const active = candidate === page;
      const tab = document.getElementById(`tab-${candidate}`);
      const section = document.getElementById(`page-${candidate}`);
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      section.hidden = !active;
    }
    persistUiState();
  }

  function applyStrings() {
    document.title = strings.title;
    elements.aiTitle.textContent = strings.title;
    elements.activeProfileLabel.textContent = strings.activeProfile;
    elements.newChat.textContent = strings.newChat;
    elements.manageProfiles.textContent = strings.configureModels;
    elements.tabChat.textContent = strings.currentChat;
    elements.tabHistory.textContent = strings.history;
    elements.tabProfiles.textContent = strings.modelProfiles;
    elements.transcriptTitle.textContent = strings.transcript;
    elements.question.placeholder = strings.questionPlaceholder;
    elements.stop.textContent = strings.stop;
    elements.send.textContent = strings.send;
    elements.historyHeading.textContent = strings.history;
    elements.clearHistory.textContent = strings.clearAll;
    elements.newProfile.textContent = strings.newProfile;
    elements.profileNameLabel.textContent = strings.name;
    elements.providerLabel.textContent = strings.provider;
    elements.baseUrlLabel.textContent = strings.baseUrl;
    elements.modelLabel.textContent = strings.model;
    elements.apiKeyLabel.textContent = strings.apiKey;
    elements.apiKey.placeholder = strings.apiKeyPlaceholder;
    elements.saveProfile.textContent = strings.save;
    elements.duplicateProfile.textContent = strings.duplicate;
    elements.makeActive.textContent = strings.makeActive;
    elements.deleteKey.textContent = strings.deleteKey;
    elements.deleteProfile.textContent = strings.delete;
    elements.providerHelp.textContent = strings.officialDocs;
  }

  function profileById(profileId) {
    return state.profiles.profiles.find((profile) => profile.id === profileId);
  }

  function presetById(providerId) {
    return presets.find((preset) => preset.id === providerId);
  }

  function populateProviderOptions() {
    const previous = elements.provider.value;
    elements.provider.replaceChildren();
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      elements.provider.append(option);
    }
    if (presetById(previous)) {
      elements.provider.value = previous;
    }
  }

  function populateActiveProfile() {
    elements.activeProfile.replaceChildren();
    if (state.profiles.profiles.length === 0) {
      const option = document.createElement('option');
      option.textContent = strings.noProfile;
      option.value = '';
      elements.activeProfile.append(option);
      return;
    }
    for (const profile of state.profiles.profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      elements.activeProfile.append(option);
    }
    elements.activeProfile.value = state.profiles.activeProfileId || state.profiles.profiles[0].id;
  }

  function createMessage(role, profileName) {
    const article = document.createElement('article');
    article.className = `message ${role}`;
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = role === 'user'
      ? strings.user
      : profileName || strings.title;
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
      insert.textContent = strings.insert;
      insert.addEventListener('click', () => {
        vscode.postMessage({ type: 'insertCode', code: segment.content });
        flashButton(insert, strings.inserted);
      });
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = strings.copy;
      copy.addEventListener('click', () => {
        vscode.postMessage({ type: 'copyCode', code: segment.content });
        flashButton(copy, strings.copied);
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

  function renderConversation() {
    elements.messages.replaceChildren();
    currentAssistant = undefined;
    const conversation = state.currentConversation;
    if (!conversation || conversation.messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = state.profiles.profiles.length === 0
        ? strings.profileEmpty
        : strings.chatEmpty;
      elements.messages.append(empty);
      return;
    }
    if (conversation.truncated) {
      const notice = document.createElement('div');
      notice.className = 'truncated-notice';
      notice.textContent = strings.truncatedHistory;
      elements.messages.append(notice);
    }
    for (const message of conversation.messages) {
      const body = createMessage(message.role, message.profileName);
      if (message.role === 'assistant') {
        renderSegments(body, message.segments || []);
      } else {
        body.textContent = message.content || '';
      }
    }
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function makeHistoryActions(summary, row) {
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = strings.open;
    open.disabled = state.busy;
    open.addEventListener('click', () => {
      vscode.postMessage({ type: 'openConversation', conversationId: summary.id });
    });
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.textContent = strings.rename;
    rename.disabled = state.busy;
    rename.addEventListener('click', () => beginRename(summary, row));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = strings.delete;
    remove.disabled = state.busy;
    remove.addEventListener('click', () => {
      vscode.postMessage({ type: 'deleteConversation', conversationId: summary.id });
    });
    actions.append(open, rename, remove);
    return actions;
  }

  function beginRename(summary, row) {
    const title = row.querySelector('.history-title');
    const actions = row.querySelector('.history-actions');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.value = summary.title;
    input.className = 'history-rename';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = strings.save;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = strings.cancel;
    const finish = () => renderHistory();
    const submit = () => {
      const nextTitle = input.value.trim();
      if (nextTitle) {
        vscode.postMessage({
          type: 'renameConversation',
          conversationId: summary.id,
          title: nextTitle,
        });
      }
    };
    save.addEventListener('click', submit);
    cancel.addEventListener('click', finish);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      }
    });
    title.replaceWith(input);
    actions.replaceChildren(save, cancel);
    input.focus();
    input.select();
  }

  function renderHistory() {
    elements.historyList.replaceChildren();
    elements.clearHistory.disabled = state.busy || state.history.length === 0;
    if (state.history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = strings.historyEmpty;
      elements.historyList.append(empty);
      return;
    }
    for (const summary of state.history) {
      const row = document.createElement('article');
      row.className = 'history-row';
      const details = document.createElement('div');
      details.className = 'history-details';
      const title = document.createElement('strong');
      title.className = 'history-title';
      title.textContent = summary.title;
      const metadata = document.createElement('span');
      metadata.className = 'history-metadata';
      const pieces = [
        formatDate(summary.updatedAt),
        `${String(summary.questionCount)} ${strings.questions}`,
      ];
      if (summary.lastProfileName) {
        pieces.push(summary.lastProfileName);
      }
      metadata.textContent = pieces.join(' · ');
      details.append(title, metadata);
      row.append(details, makeHistoryActions(summary, row));
      elements.historyList.append(row);
    }
  }

  function setProfileFormEnabled(enabled) {
    for (const control of elements.profileForm.querySelectorAll('input, select, button')) {
      control.disabled = !enabled || state.busy;
    }
  }

  function selectedProfile() {
    return selectedProfileId ? profileById(selectedProfileId) : undefined;
  }

  function renderProfileForm() {
    const profile = selectedProfile();
    if (!creatingProfile && !profile) {
      elements.profileName.value = '';
      elements.baseUrl.value = '';
      elements.model.value = '';
      elements.apiKey.value = '';
      elements.keyStatus.textContent = strings.profileEmpty;
      setProfileFormEnabled(false);
      return;
    }
    setProfileFormEnabled(true);
    if (creatingProfile) {
      const preset = presets[0];
      elements.profileName.value = '';
      elements.provider.value = preset?.id || '';
      elements.baseUrl.value = preset?.baseUrl || '';
      elements.model.value = '';
      elements.apiKey.value = '';
      elements.keyStatus.textContent = strings.apiKeyMissing;
    } else {
      elements.profileName.value = profile.name;
      elements.provider.value = profile.providerId;
      elements.baseUrl.value = profile.baseUrl;
      elements.model.value = profile.model;
      elements.apiKey.value = '';
      elements.keyStatus.textContent = profile.hasApiKey
        ? strings.apiKeySaved
        : strings.apiKeyMissing;
    }
    const preset = presetById(elements.provider.value);
    elements.model.placeholder = preset?.modelPlaceholder || '';
    const hasProfile = Boolean(profile) && !creatingProfile;
    elements.duplicateProfile.disabled = state.busy || !hasProfile;
    elements.makeActive.disabled = state.busy
      || !hasProfile
      || state.profiles.activeProfileId === profile.id;
    elements.deleteKey.disabled = state.busy || !hasProfile || !profile.hasApiKey;
    elements.deleteProfile.disabled = state.busy || !hasProfile;
  }

  function renderProfiles() {
    elements.profileList.replaceChildren();
    for (const profile of state.profiles.profiles) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-row';
      button.classList.toggle('selected', !creatingProfile && profile.id === selectedProfileId);
      button.classList.toggle('active-profile', profile.id === state.profiles.activeProfileId);
      const name = document.createElement('strong');
      name.textContent = profile.name;
      const details = document.createElement('span');
      details.textContent = `${presetById(profile.providerId)?.label || profile.providerId} · ${profile.model}`;
      button.append(name, details);
      button.addEventListener('click', () => {
        creatingProfile = false;
        selectedProfileId = profile.id;
        persistUiState();
        renderProfiles();
      });
      elements.profileList.append(button);
    }
    renderProfileForm();
  }

  function renderAll() {
    const profileIds = new Set(state.profiles.profiles.map((profile) => profile.id));
    if (!creatingProfile && (!selectedProfileId || !profileIds.has(selectedProfileId))) {
      selectedProfileId = state.profiles.activeProfileId || state.profiles.profiles[0]?.id;
    }
    populateProviderOptions();
    populateActiveProfile();
    renderConversation();
    renderHistory();
    renderProfiles();
    setBusy(state.busy);
    if (state.profiles.profiles.length === 0 && currentPage === 'chat') {
      showPage('profiles');
    } else {
      showPage(currentPage);
    }
  }

  function sendQuestion() {
    const question = elements.question.value.trim();
    if (!question || state.busy) {
      return;
    }
    vscode.postMessage({ type: 'sendQuestion', question });
    elements.question.value = '';
  }

  function saveProfile() {
    const payload = {
      name: elements.profileName.value.trim(),
      providerId: elements.provider.value,
      baseUrl: elements.baseUrl.value.trim(),
      model: elements.model.value.trim(),
      apiKey: elements.apiKey.value,
    };
    if (creatingProfile) {
      vscode.postMessage({ type: 'createProfile', ...payload });
    } else if (selectedProfileId) {
      vscode.postMessage({ type: 'saveProfile', profileId: selectedProfileId, ...payload });
    }
  }

  function maximumComposerHeight() {
    return Math.max(86, Math.min(600, window.innerHeight - 180));
  }

  function applyComposerHeight(height, persist = false) {
    composerHeight = Math.max(86, Math.min(maximumComposerHeight(), Math.round(height)));
    document.documentElement.style.setProperty('--composer-height', `${composerHeight}px`);
    elements.splitter.setAttribute('aria-valuemin', '86');
    elements.splitter.setAttribute('aria-valuemax', String(maximumComposerHeight()));
    elements.splitter.setAttribute('aria-valuenow', String(composerHeight));
    if (persist) {
      vscode.postMessage({ type: 'setComposerHeight', height: composerHeight });
    }
  }

  function initializeSplitter() {
    let startY = 0;
    let startHeight = 0;
    elements.splitter.addEventListener('pointerdown', (event) => {
      startY = event.clientY;
      startHeight = composerHeight;
      elements.splitter.setPointerCapture(event.pointerId);
      elements.splitter.classList.add('dragging');
    });
    elements.splitter.addEventListener('pointermove', (event) => {
      if (!elements.splitter.hasPointerCapture(event.pointerId)) {
        return;
      }
      applyComposerHeight(startHeight + startY - event.clientY);
    });
    const finish = (event) => {
      if (!elements.splitter.hasPointerCapture(event.pointerId)) {
        return;
      }
      elements.splitter.releasePointerCapture(event.pointerId);
      elements.splitter.classList.remove('dragging');
      applyComposerHeight(composerHeight, true);
    };
    elements.splitter.addEventListener('pointerup', finish);
    elements.splitter.addEventListener('pointercancel', finish);
    elements.splitter.addEventListener('dblclick', () => applyComposerHeight(112, true));
    elements.splitter.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowUp') {
        next = composerHeight + 10;
      } else if (event.key === 'ArrowDown') {
        next = composerHeight - 10;
      } else if (event.key === 'Home') {
        next = 86;
      } else if (event.key === 'End') {
        next = maximumComposerHeight();
      }
      if (next !== undefined) {
        event.preventDefault();
        applyComposerHeight(next, true);
      }
    });
    window.addEventListener('resize', () => applyComposerHeight(composerHeight));
  }

  elements.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (button) {
      showPage(button.dataset.page);
    }
  });
  elements.manageProfiles.addEventListener('click', () => showPage('profiles'));
  elements.newChat.addEventListener('click', () => {
    vscode.postMessage({ type: 'newChat' });
    showPage('chat');
  });
  elements.activeProfile.addEventListener('change', () => {
    if (elements.activeProfile.value) {
      vscode.postMessage({ type: 'selectProfile', profileId: elements.activeProfile.value });
    }
  });
  elements.send.addEventListener('click', sendQuestion);
  elements.stop.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  elements.question.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendQuestion();
    }
  });
  elements.clearHistory.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearAllConversations' });
  });
  elements.newProfile.addEventListener('click', () => {
    creatingProfile = true;
    selectedProfileId = undefined;
    persistUiState();
    renderProfiles();
    elements.profileName.focus();
  });
  elements.profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveProfile();
  });
  elements.provider.addEventListener('change', () => {
    const preset = presetById(elements.provider.value);
    if (preset) {
      elements.baseUrl.value = preset.baseUrl;
      elements.model.placeholder = preset.modelPlaceholder;
    }
  });
  elements.duplicateProfile.addEventListener('click', () => {
    if (selectedProfileId) {
      vscode.postMessage({ type: 'duplicateProfile', profileId: selectedProfileId });
    }
  });
  elements.makeActive.addEventListener('click', () => {
    if (selectedProfileId) {
      vscode.postMessage({ type: 'selectProfile', profileId: selectedProfileId });
    }
  });
  elements.deleteKey.addEventListener('click', () => {
    if (selectedProfileId) {
      vscode.postMessage({ type: 'deleteProfileKey', profileId: selectedProfileId });
    }
  });
  elements.deleteProfile.addEventListener('click', () => {
    if (selectedProfileId) {
      vscode.postMessage({ type: 'deleteProfile', profileId: selectedProfileId });
    }
  });
  elements.providerHelp.addEventListener('click', () => {
    vscode.postMessage({ type: 'openProviderHelp', providerId: elements.provider.value });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'renderState') {
      presets = message.presets;
      strings = message.strings;
      state = message.state;
      composerHeight = message.composerHeight;
      creatingProfile = false;
      currentAssistant = undefined;
      applyStrings();
      applyComposerHeight(composerHeight);
      setBanner('');
      renderAll();
    } else if (message.type === 'showPage') {
      showPage(message.page);
    } else if (message.type === 'responseStarted') {
      const userBody = createMessage('user');
      userBody.textContent = message.question;
      currentAssistant = createMessage('assistant');
      currentAssistant.classList.add('streaming');
      setBusy(true);
      renderHistory();
      renderProfiles();
      setBanner('');
    } else if (message.type === 'responseDelta') {
      if (currentAssistant) {
        currentAssistant.textContent += message.content;
        elements.messages.scrollTop = elements.messages.scrollHeight;
      }
    } else if (message.type === 'requestFailed') {
      currentAssistant = undefined;
      setBusy(false);
      renderHistory();
      renderProfiles();
      if (!elements.question.value) {
        elements.question.value = message.question;
      }
      setBanner(message.message, !message.cancelled);
    } else if (message.type === 'operationMessage') {
      setBanner(message.message, message.error);
    }
  });

  initializeSplitter();
  vscode.postMessage({ type: 'ready' });
})();
