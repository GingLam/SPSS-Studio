(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  let persistedState = vscode.getState() || {};
  const savedStudioState = persistedState.studio || persistedState;
  const DATA_ROW_NUMBER_WIDTH = 64;
  const DATA_VARIABLE_WIDTH = 160;
  const DATA_VARIABLE_CHUNK = 50;
  const DATA_VARIABLE_REQUEST_LIMIT = 200;
  const state = {
    activeTab: 'output',
    history: [],
    selectedId: undefined,
    dataset: undefined,
    datasetRevision: -1,
    page: undefined,
    pageSize: 100,
    rowOffset: 0,
    desiredVariableStart: 0,
    desiredVariableLimit: 50,
    dataCache: new Map(),
    pendingData: new Set(),
    variablePageOffset: 0,
    variablePageSize: 100,
    requestId: 0,
    generation: 0,
    historyWidth: Number(savedStudioState.historyWidth) || 240,
    historyVisible: false,
  };

  const byId = (id) => document.getElementById(id);
  const tabs = ['output', 'data', 'variables', 'ai'];

  function postStudio(message) {
    vscode.postMessage({ scope: 'studio', message });
  }

  function updatePersistedState(scope, value) {
    persistedState = { ...persistedState, [scope]: value };
    vscode.setState(persistedState);
  }

  const aiModule = window.createSpssAiModule({
    root: byId('spss-ai'),
    postMessage: (message) => vscode.postMessage({ scope: 'ai', message }),
    getState: () => persistedState.ai || {},
    setState: (value) => updatePersistedState('ai', value),
  });

  function showTab(tab, notify = true) {
    state.activeTab = tab;
    for (const candidate of tabs) {
      byId(`${candidate}-view`).classList.toggle('active', candidate === tab);
      byId(`${candidate}-tab`).classList.toggle('active', candidate === tab);
    }
    if (notify) {
      const messages = {
        output: 'showOutput',
        data: 'showData',
        variables: 'showVariables',
        ai: 'showAi',
      };
      postStudio({ type: messages[tab] });
    }
    if (tab === 'data') window.setTimeout(requestVisiblePage, 0);
    if (tab === 'ai') window.requestAnimationFrame(() => aiModule.resize());
  }

  function statusLabel(status) {
    return String(status || '').replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
  }

  function renderHistory() {
    const container = byId('run-history');
    container.replaceChildren();
    for (const record of state.history) {
      const button = document.createElement('button');
      button.className = `run${record.id === state.selectedId ? ' selected' : ''}`;
      button.type = 'button';
      const title = document.createElement('span');
      title.textContent = `Run #${record.sequence}`;
      const detail = document.createElement('span');
      detail.className = 'run-status';
      detail.textContent = `${statusLabel(record.status)} · ${new Date(record.timestamp).toLocaleTimeString()}`;
      button.append(title, detail);
      button.addEventListener('click', () => postStudio({ type: 'selectExecution', id: record.id }));
      container.append(button);
    }
  }

  function setOutputActions(record) {
    const enabled = Boolean(record?.hasHtml) && record.status !== 'RUNNING';
    byId('export-output').disabled = !enabled;
    byId('print-output').disabled = !enabled;
  }

  function setHistoryVisible(visible) {
    state.historyVisible = Boolean(visible);
    byId('output-view').classList.toggle('history-open', state.historyVisible);
    byId('toggle-history').setAttribute('aria-expanded', String(state.historyVisible));
  }

  function renderExecution(record, html) {
    state.selectedId = record.id;
    renderHistory();
    setOutputActions(record);
    const seconds = (record.durationMs / 1000).toFixed(2);
    const error = record.errorMessage ? `\n${record.errorMessage}` : '';
    byId('run-summary').textContent = `Run #${record.sequence} · ${statusLabel(record.status)}\nError level: ${record.errorLevel} · Duration: ${seconds} s${error}`;
    const output = byId('spss-output');
    if (html) {
      // The extension sanitizes this IBM-generated fragment and rewrites local image URIs.
      output.innerHTML = html;
    } else {
      output.replaceChildren();
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = record.status === 'RUNNING'
        ? 'SPSS execution is running…'
        : record.status === 'SUCCESS_NO_OUTPUT'
          ? 'Execution completed successfully. SPSS produced no display output.'
          : 'No SPSS HTML output is available for this execution.';
      output.append(empty);
    }
  }

  function renderDatasetSummary() {
    const dataset = state.dataset;
    if (!dataset || !dataset.active) {
      byId('dataset-summary').textContent = 'No Active Dataset.';
      byId('variables-summary').textContent = 'No Active Dataset.';
      return;
    }
    const controls = [
      dataset.weightVariable ? `Weight: ${dataset.weightVariable}` : '',
      dataset.splitVariables && dataset.splitVariables.length ? `Split: ${dataset.splitVariables.join(', ')}` : '',
      dataset.filterVariable ? `Filter: ${dataset.filterVariable}` : '',
    ].filter(Boolean);
    const cases = dataset.caseCount < 0 ? 'Unknown until data are materialized' : dataset.caseCount.toLocaleString();
    const summary = `Dataset: ${dataset.datasetName} · Cases: ${cases} · Variables: ${dataset.variableCount.toLocaleString()}${controls.length ? ` · ${controls.join(' · ')}` : ''}`;
    byId('dataset-summary').textContent = summary;
    byId('variables-summary').textContent = summary;
  }

  function appendTextCell(row, value, className) {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = value;
    row.append(cell);
    return cell;
  }

  function renderVariables() {
    const variables = state.dataset?.active ? state.dataset.variables : [];
    const maximumOffset = Math.max(0, Math.floor(Math.max(0, variables.length - 1) / state.variablePageSize) * state.variablePageSize);
    state.variablePageOffset = Math.min(state.variablePageOffset, maximumOffset);
    const visible = variables.slice(state.variablePageOffset, state.variablePageOffset + state.variablePageSize);
    const body = byId('variables-table').querySelector('tbody');
    body.replaceChildren();
    visible.forEach((variable, index) => {
      const row = document.createElement('tr');
      appendTextCell(row, String(state.variablePageOffset + index + 1), 'row-number');
      const name = String(variable.name || '—');
      const nameCell = appendTextCell(row, name, 'variable-name');
      nameCell.title = document.documentElement.lang.toLowerCase().startsWith('zh')
        ? `双击插入 ${name}`
        : `Double-click to insert ${name}`;
      nameCell.addEventListener('dblclick', (event) => {
        event.preventDefault();
        postStudio({ type: 'insertVariable', name });
      });
      appendTextCell(row, String(variable.label || '—'));
      appendTextCell(row, String(variable.type || '—'));
      appendTextCell(row, String(variable.format || '—'));
      appendTextCell(row, String(variable.measurementLevel || '—'));
      body.append(row);
    });
    const first = variables.length === 0 ? 0 : state.variablePageOffset + 1;
    const last = Math.min(variables.length, state.variablePageOffset + visible.length);
    byId('variable-page-summary').textContent = `${first.toLocaleString()}–${last.toLocaleString()} of ${variables.length.toLocaleString()}`;
    byId('previous-variable-page').disabled = state.variablePageOffset <= 0;
    byId('next-variable-page').disabled = state.variablePageOffset + visible.length >= variables.length;
  }

  function calculateVariableWindow(scrollLeft, viewportWidth, totalVariables) {
    if (totalVariables <= 0) return { variableStart: 0, variableLimit: 1 };
    const contentLeft = Math.max(0, scrollLeft - DATA_ROW_NUMBER_WIDTH);
    const visibleStart = Math.floor(contentLeft / DATA_VARIABLE_WIDTH);
    const visibleEnd = Math.ceil((contentLeft + Math.max(1, viewportWidth)) / DATA_VARIABLE_WIDTH);
    const overscanStart = Math.max(0, visibleStart - 4);
    const overscanEnd = Math.min(totalVariables, visibleEnd + 4);
    const variableStart = Math.floor(overscanStart / DATA_VARIABLE_CHUNK) * DATA_VARIABLE_CHUNK;
    const alignedEnd = Math.min(totalVariables, Math.ceil(Math.max(overscanEnd, variableStart + 1) / DATA_VARIABLE_CHUNK) * DATA_VARIABLE_CHUNK);
    return {
      variableStart,
      variableLimit: Math.min(DATA_VARIABLE_REQUEST_LIMIT, Math.max(1, alignedEnd - variableStart)),
    };
  }

  function dataKey(offset, limit, variableStart, variableLimit, generation) {
    return `${generation}:${offset}:${limit}:${variableStart}:${variableLimit}`;
  }

  function renderPage(page) {
    state.page = page;
    state.pageSize = page.limit;
    state.rowOffset = page.offset;
    const canvas = byId('data-canvas');
    canvas.style.width = `${DATA_ROW_NUMBER_WIDTH + page.totalVariables * DATA_VARIABLE_WIDTH}px`;

    const table = byId('data-table');
    table.replaceChildren();
    table.style.left = `${DATA_ROW_NUMBER_WIDTH + page.variableStart * DATA_VARIABLE_WIDTH}px`;
    table.style.width = `${Math.max(1, page.variables.length) * DATA_VARIABLE_WIDTH}px`;
    const columns = document.createElement('colgroup');
    for (let index = 0; index < page.variables.length; index += 1) {
      const column = document.createElement('col');
      column.style.width = `${DATA_VARIABLE_WIDTH}px`;
      columns.append(column);
    }
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const variable of page.variables) {
      const cell = document.createElement('th');
      cell.textContent = variable.name;
      cell.title = [variable.label, variable.type, variable.measurementLevel, variable.format].filter(Boolean).join(' · ');
      headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement('tbody');
    page.rows.forEach((row) => {
      const tableRow = document.createElement('tr');
      for (const value of row) appendTextCell(tableRow, value === null ? '.' : String(value));
      body.append(tableRow);
    });
    table.append(columns, head, body);

    const rowTable = byId('data-row-table');
    rowTable.replaceChildren();
    const rowHead = document.createElement('thead');
    const rowHeadRow = document.createElement('tr');
    const number = document.createElement('th');
    number.textContent = '#';
    rowHeadRow.append(number);
    rowHead.append(rowHeadRow);
    const rowBody = document.createElement('tbody');
    page.rows.forEach((_row, rowIndex) => {
      const tableRow = document.createElement('tr');
      appendTextCell(tableRow, String(page.offset + rowIndex + 1), 'row-number');
      rowBody.append(tableRow);
    });
    rowTable.append(rowHead, rowBody);

    const first = page.totalCases === 0 ? 0 : page.offset + 1;
    const last = Math.min(page.totalCases, page.offset + page.rows.length);
    byId('page-summary').textContent = `${first.toLocaleString()}–${last.toLocaleString()} of ${page.totalCases.toLocaleString()}`;
    byId('previous-page').disabled = page.offset <= 0;
    byId('next-page').disabled = page.offset + page.rows.length >= page.totalCases;
  }

  function requestVisiblePage() {
    const dataset = state.dataset;
    if (!dataset?.active || state.activeTab !== 'data') return;
    const scroll = byId('data-scroll');
    const variableWindow = calculateVariableWindow(scroll.scrollLeft, scroll.clientWidth, dataset.variableCount);
    state.desiredVariableStart = variableWindow.variableStart;
    state.desiredVariableLimit = variableWindow.variableLimit;
    const key = dataKey(state.rowOffset, state.pageSize, variableWindow.variableStart, variableWindow.variableLimit, state.generation);
    const cached = state.dataCache.get(key);
    if (cached) {
      renderPage(cached);
      return;
    }
    if (state.pendingData.has(key)) return;
    state.pendingData.add(key);
    state.requestId += 1;
    postStudio({
      type: 'requestDatasetPage',
      offset: state.rowOffset,
      limit: state.pageSize,
      variableStart: variableWindow.variableStart,
      variableLimit: variableWindow.variableLimit,
      requestId: state.requestId,
      generation: state.generation,
    });
  }

  function resetDataRequests(resetRows = false) {
    state.generation += 1;
    state.dataCache.clear();
    state.pendingData.clear();
    state.page = undefined;
    if (resetRows) state.rowOffset = 0;
  }

  function setHistoryWidth(width) {
    const minimum = 160;
    const maximum = Math.max(minimum, Math.floor(window.innerWidth * 0.55));
    state.historyWidth = Math.max(minimum, Math.min(maximum, Math.round(width)));
    document.documentElement.style.setProperty('--history-width', `${state.historyWidth}px`);
    updatePersistedState('studio', { historyWidth: state.historyWidth });
  }

  byId('output-tab').addEventListener('click', () => showTab('output'));
  byId('data-tab').addEventListener('click', () => showTab('data'));
  byId('variables-tab').addEventListener('click', () => showTab('variables'));
  byId('ai-tab').addEventListener('click', () => showTab('ai'));
  byId('clear-output').addEventListener('click', () => postStudio({ type: 'clearOutput' }));
  byId('export-output').addEventListener('click', () => {
    if (state.selectedId) postStudio({ type: 'exportOutput', id: state.selectedId });
  });
  byId('print-output').addEventListener('click', () => {
    if (state.selectedId) postStudio({ type: 'printOutput', id: state.selectedId });
  });
  byId('toggle-history').addEventListener('click', () => {
    setHistoryVisible(!state.historyVisible);
  });
  byId('refresh-data').addEventListener('click', () => {
    resetDataRequests(false);
    postStudio({ type: 'refreshData' });
  });
  byId('refresh-variables').addEventListener('click', () => postStudio({ type: 'refreshVariables' }));
  byId('previous-page').addEventListener('click', () => {
    state.rowOffset = Math.max(0, state.rowOffset - state.pageSize);
    resetDataRequests(false);
    requestVisiblePage();
  });
  byId('next-page').addEventListener('click', () => {
    state.rowOffset += state.pageSize;
    resetDataRequests(false);
    requestVisiblePage();
  });
  byId('page-size').addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    resetDataRequests(true);
    requestVisiblePage();
  });
  byId('previous-variable-page').addEventListener('click', () => {
    state.variablePageOffset = Math.max(0, state.variablePageOffset - state.variablePageSize);
    renderVariables();
  });
  byId('next-variable-page').addEventListener('click', () => {
    state.variablePageOffset += state.variablePageSize;
    renderVariables();
  });
  byId('variable-page-size').addEventListener('change', (event) => {
    state.variablePageSize = Number(event.target.value);
    state.variablePageOffset = 0;
    renderVariables();
  });

  const splitter = byId('output-splitter');
  splitter.addEventListener('pointerdown', (event) => splitter.setPointerCapture(event.pointerId));
  splitter.addEventListener('pointermove', (event) => {
    if (splitter.hasPointerCapture(event.pointerId)) setHistoryWidth(window.innerWidth - event.clientX);
  });
  splitter.addEventListener('pointerup', (event) => splitter.releasePointerCapture(event.pointerId));
  splitter.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setHistoryWidth(state.historyWidth + (event.key === 'ArrowLeft' ? 16 : -16));
    }
  });
  window.addEventListener('resize', () => {
    setHistoryWidth(state.historyWidth);
    requestVisiblePage();
  });
  let dataScrollTimer;
  byId('data-scroll').addEventListener('scroll', () => {
    window.clearTimeout(dataScrollTimer);
    dataScrollTimer = window.setTimeout(requestVisiblePage, 40);
  });

  window.addEventListener('message', (event) => {
    const envelope = event.data;
    if (envelope.scope === 'ai') {
      aiModule.handleMessage(envelope.message);
      return;
    }
    if (envelope.scope !== 'studio') {
      return;
    }
    const message = envelope.message;
    if (message.type === 'executionStarted' || message.type === 'executionCompleted') {
      state.history = message.history;
      state.selectedId = message.selectedId;
      renderHistory();
      setOutputActions(state.history.find((record) => record.id === state.selectedId));
    } else if (message.type === 'executionSelected') {
      renderExecution(message.record, message.html);
    } else if (message.type === 'datasetMetadata') {
      const revisionChanged = message.revision !== state.datasetRevision;
      state.dataset = message.dataset || undefined;
      state.datasetRevision = message.revision;
      if (revisionChanged) {
        state.variablePageOffset = 0;
        resetDataRequests(true);
      }
      renderDatasetSummary();
      renderVariables();
      if (state.activeTab === 'data') requestVisiblePage();
    } else if (message.type === 'datasetPage') {
      const key = dataKey(
        message.page.offset,
        message.page.limit,
        message.page.variableStart,
        message.page.variableLimit,
        message.generation,
      );
      state.pendingData.delete(key);
      if (message.generation === state.generation) {
        state.dataCache.set(key, message.page);
        if (
          message.page.offset === state.rowOffset
          && message.page.variableStart === state.desiredVariableStart
          && message.page.variableLimit === state.desiredVariableLimit
        ) {
          renderPage(message.page);
        }
      }
    } else if (message.type === 'engineState') {
      byId('engine-state').textContent = `SPSS: ${statusLabel(message.state)}`;
    } else if (message.type === 'showOutput') {
      showTab('output', false);
    } else if (message.type === 'showData') {
      showTab('data', false);
    } else if (message.type === 'showVariables') {
      showTab('variables', false);
    } else if (message.type === 'showAi') {
      showTab('ai', false);
    } else if (message.type === 'outputCleared') {
      state.history = [];
      state.selectedId = undefined;
      renderHistory();
      setOutputActions(undefined);
      byId('run-summary').textContent = 'No executions yet.';
      byId('spss-output').replaceChildren();
    }
  });

  setHistoryWidth(state.historyWidth);
  setHistoryVisible(false);
  renderVariables();
  vscode.postMessage({ scope: 'shell', type: 'ready' });
}());
