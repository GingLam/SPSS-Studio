(() => {
  window.createSpssAiModule = ({ root, postMessage, getState, setState }) => {
  const vscode = { postMessage, getState, setState };
  const byId = (id) => root.querySelector(`#${id}`);
  const elements = {
    activeProfile: byId('active-profile'),
    activeProfileLabel: byId('active-profile-label'),
    apiKey: byId('api-key'),
    apiKeyLabel: byId('api-key-label'),
    banner: byId('banner'),
    baseUrl: byId('base-url'),
    baseUrlLabel: byId('base-url-label'),
    clearHistory: byId('clear-history'),
    deleteKey: byId('delete-key'),
    deleteProfile: byId('delete-profile'),
    duplicateProfile: byId('duplicate-profile'),
    historyHeading: byId('history-heading'),
    historyList: byId('history-list'),
    keyStatus: byId('key-status'),
    makeActive: byId('make-active'),
    manageProfiles: byId('manage-profiles'),
    messages: byId('messages'),
    model: byId('model'),
    modelLabel: byId('model-label'),
    newChat: byId('new-chat'),
    newProfile: byId('new-profile'),
    profileForm: byId('profile-form'),
    profileList: byId('profile-list'),
    profileName: byId('profile-name'),
    profileNameLabel: byId('profile-name-label'),
    provider: byId('provider'),
    providerHelp: byId('provider-help'),
    providerLabel: byId('provider-label'),
    question: byId('question'),
    reasoningEnabled: byId('reasoning-enabled'),
    reasoningEnabledLabel: byId('reasoning-enabled-label'),
    reasoningStatus: byId('reasoning-status'),
    responseLanguage: byId('response-language'),
    responseLanguageLabel: byId('response-language-label'),
    responseLanguageZh: byId('response-language-zh'),
    responseLanguageEn: byId('response-language-en'),
    saveProfile: byId('save-profile'),
    send: byId('send'),
    sendingStatus: byId('sending-status'),
    splitter: byId('splitter'),
    stop: byId('stop'),
    tabChat: byId('tab-chat'),
    tabHistory: byId('tab-history'),
    tabs: byId('tabs'),
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
  let profileFormEnabled = false;

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
    elements.responseLanguage.disabled = busy;
    elements.sendingStatus.textContent = busy ? strings.sending : '';
    updateReasoningControl();
  }

  function showPage(page) {
    if (!['chat', 'history', 'profiles'].includes(page)) {
      return;
    }
    currentPage = page;
    for (const candidate of ['chat', 'history', 'profiles']) {
      const active = candidate === page;
      const tab = byId(`tab-${candidate}`);
      const section = byId(`page-${candidate}`);
      if (tab) {
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      }
      section.hidden = !active;
    }
    elements.manageProfiles.classList.toggle('active', page === 'profiles');
    elements.manageProfiles.setAttribute('aria-pressed', String(page === 'profiles'));
    persistUiState();
  }

  function applyStrings() {
    elements.activeProfileLabel.textContent = strings.activeProfile;
    elements.newChat.textContent = strings.newChat;
    elements.manageProfiles.textContent = strings.configureModels;
    elements.tabChat.textContent = strings.currentChat;
    elements.tabHistory.textContent = strings.history;
    elements.question.placeholder = strings.questionPlaceholder;
    elements.stop.textContent = strings.stop;
    elements.send.textContent = strings.send;
    elements.historyHeading.textContent = strings.history;
    elements.clearHistory.textContent = strings.clearAll;
    elements.newProfile.textContent = strings.newProfile;
    elements.profileNameLabel.textContent = strings.name;
    elements.providerLabel.textContent = strings.provider;
    elements.responseLanguageLabel.textContent = strings.responseLanguage;
    elements.responseLanguageZh.textContent = strings.responseLanguageChinese;
    elements.responseLanguageEn.textContent = strings.responseLanguageEnglish;
    elements.reasoningEnabledLabel.textContent = strings.enableReasoning;
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
    const body = document.createElement('div');
    body.className = 'message-body';
    if (role === 'assistant') {
      const label = document.createElement('div');
      label.className = 'message-label';
      label.textContent = profileName || strings.title;
      article.append(label);
    }
    article.append(body);
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

  const tokenizeSpssSyntax = window.createSpssTokenizer(window.SPSS_SYNTAX_DATA || {});

  function isSpssLanguage(language) {
    return ['spss', 'sps', 'spss-syntax', 'ibm-spss', 'ibm spss']
      .includes(String(language || '').trim().toLowerCase());
  }

  function renderSpssCode(target, source) {
    for (const token of tokenizeSpssSyntax(source)) {
      if (token.type === 'plain') {
        target.append(document.createTextNode(token.content));
        continue;
      }
      const span = document.createElement('span');
      span.className = `syntax-token ${token.type}`;
      span.textContent = token.content;
      target.append(span);
    }
  }

  function renderInline(target, nodes) {
    for (const node of nodes) {
      if (node.type === 'text') {
        target.append(document.createTextNode(node.content));
      } else if (node.type === 'break') {
        target.append(document.createElement('br'));
      } else if (node.type === 'code') {
        const code = document.createElement('code');
        code.className = 'inline-code';
        code.textContent = node.content;
        target.append(code);
      } else if (node.type === 'link') {
        const link = document.createElement('a');
        link.href = node.url;
        link.title = node.url;
        link.rel = 'noreferrer';
        renderInline(link, node.children);
        link.addEventListener('click', (event) => {
          event.preventDefault();
          vscode.postMessage({ type: 'openLink', url: node.url });
        });
        target.append(link);
      } else {
        const element = document.createElement(node.type === 'strong'
          ? 'strong'
          : node.type === 'emphasis'
            ? 'em'
            : 'del');
        renderInline(element, node.children);
        target.append(element);
      }
    }
  }

  function renderMarkdownBlocks(target, blocks) {
    for (const block of blocks) {
      if (block.type === 'paragraph' || block.type === 'heading') {
        const element = document.createElement(block.type === 'heading' ? `h${block.level}` : 'p');
        renderInline(element, block.children);
        target.append(element);
      } else if (block.type === 'thematicBreak') {
        target.append(document.createElement('hr'));
      } else if (block.type === 'blockquote') {
        const quote = document.createElement('blockquote');
        renderMarkdownBlocks(quote, block.blocks);
        target.append(quote);
      } else if (block.type === 'list') {
        const list = document.createElement(block.ordered ? 'ol' : 'ul');
        if (block.ordered && block.start) list.start = block.start;
        for (const item of block.items) {
          const entry = document.createElement('li');
          renderMarkdownBlocks(entry, item);
          list.append(entry);
        }
        target.append(list);
      } else if (block.type === 'table') {
        const table = document.createElement('table');
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const cell of block.header) {
          const heading = document.createElement('th');
          renderInline(heading, cell);
          headRow.append(heading);
        }
        head.append(headRow);
        const body = document.createElement('tbody');
        for (const row of block.rows) {
          const tableRow = document.createElement('tr');
          for (const cell of row) {
            const data = document.createElement('td');
            renderInline(data, cell);
            tableRow.append(data);
          }
          body.append(tableRow);
        }
        table.append(head, body);
        const scroll = document.createElement('div');
        scroll.className = 'markdown-table-scroll';
        scroll.append(table);
        target.append(scroll);
      }
    }
  }

  function renderSegments(target, segments) {
    target.replaceChildren();
    for (const segment of segments) {
      if (segment.type === 'markdown') {
        const prose = document.createElement('div');
        prose.className = 'prose';
        renderMarkdownBlocks(prose, segment.blocks);
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
      if (isSpssLanguage(segment.language)) {
        renderSpssCode(code, segment.content);
      } else {
        code.textContent = segment.content;
      }
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
    profileFormEnabled = enabled;
    for (const control of elements.profileForm.querySelectorAll('input, select, button')) {
      control.disabled = !enabled || state.busy;
    }
    updateReasoningControl();
  }

  function updateReasoningControl() {
    const preset = presetById(elements.provider.value);
    const supported = Boolean(preset) && preset.reasoningControl !== 'none';
    elements.reasoningEnabled.disabled = !profileFormEnabled || state.busy || !supported;
    elements.reasoningStatus.textContent = profileFormEnabled && !supported
      ? strings.reasoningUnavailable
      : '';
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
      elements.reasoningEnabled.checked = false;
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
      elements.reasoningEnabled.checked = false;
      elements.keyStatus.textContent = strings.apiKeyMissing;
    } else {
      elements.profileName.value = profile.name;
      elements.provider.value = profile.providerId;
      elements.baseUrl.value = profile.baseUrl;
      elements.model.value = profile.model;
      elements.apiKey.value = '';
      elements.reasoningEnabled.checked = profile.reasoningEnabled;
      elements.keyStatus.textContent = profile.hasApiKey
        ? strings.apiKeySaved
        : strings.apiKeyMissing;
    }
    const preset = presetById(elements.provider.value);
    elements.model.placeholder = preset?.modelPlaceholder || '';
    updateReasoningControl();
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
    elements.responseLanguage.value = state.responseLanguage || 'zh-CN';
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
      reasoningEnabled: elements.reasoningEnabled.checked,
      apiKey: elements.apiKey.value,
    };
    if (creatingProfile) {
      vscode.postMessage({ type: 'createProfile', ...payload });
    } else if (selectedProfileId) {
      vscode.postMessage({ type: 'saveProfile', profileId: selectedProfileId, ...payload });
    }
  }

  function maximumComposerHeight() {
    const availableHeight = root.clientHeight > 0 ? root.clientHeight : window.innerHeight;
    return Math.max(86, Math.min(600, availableHeight - 180));
  }

  function applyComposerHeight(height, persist = false) {
    composerHeight = Math.max(86, Math.min(maximumComposerHeight(), Math.round(height)));
    root.style.setProperty('--composer-height', `${composerHeight}px`);
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
  elements.responseLanguage.addEventListener('change', () => {
    vscode.postMessage({
      type: 'setResponseLanguage',
      language: elements.responseLanguage.value,
    });
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
    if (preset?.reasoningControl === 'none') {
      elements.reasoningEnabled.checked = false;
    }
    updateReasoningControl();
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

  function handleMessage(message) {
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
  }

  function resize() {
    applyComposerHeight(composerHeight);
  }

  initializeSplitter();
  return { handleMessage, resize, showPage };
  };
})();
