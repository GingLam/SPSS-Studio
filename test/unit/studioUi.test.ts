import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isWebviewMessage } from '../../src/views/webviewProtocol';

describe('SPSS Studio Webview UI contract', () => {
  it('accepts only well-formed data, tab, variable insertion, and output actions', () => {
    assert.equal(isWebviewMessage({ type: 'showData' }), true);
    assert.equal(isWebviewMessage({ type: 'showVariables' }), true);
    assert.equal(isWebviewMessage({ type: 'showAi' }), true);
    assert.equal(isWebviewMessage({ type: 'refreshVariables' }), true);
    assert.equal(isWebviewMessage({ type: 'insertVariable', name: 'HouseholdIncome' }), true);
    assert.equal(isWebviewMessage({ type: 'copyVariables', names: ['Age', 'Income'] }), true);
    assert.equal(isWebviewMessage({ type: 'insertVariables', names: ['Age', 'Income'] }), true);
    assert.equal(isWebviewMessage({ type: 'exploreVariables', names: ['Age'] }), true);
    assert.equal(isWebviewMessage({ type: 'explainOutput', id: 'run-1' }), true);
    assert.equal(isWebviewMessage({ type: 'exportOutput', id: 'run-1' }), true);
    assert.equal(isWebviewMessage({ type: 'printOutput', id: 'run-1' }), true);
    assert.equal(isWebviewMessage({
      type: 'requestDatasetPage', offset: 0, limit: 100, variableStart: 0, variableLimit: 50,
      requestId: 1, generation: 0,
    }), true);
    assert.equal(isWebviewMessage({ type: 'exportOutput', id: '' }), false);
    assert.equal(isWebviewMessage({ type: 'explainOutput', id: '' }), false);
    assert.equal(isWebviewMessage({ type: 'insertVariable', name: '' }), false);
    assert.equal(isWebviewMessage({ type: 'insertVariable', name: 'x'.repeat(65) }), false);
    assert.equal(isWebviewMessage({ type: 'exploreVariables', names: [] }), false);
    assert.equal(isWebviewMessage({ type: 'requestDatasetPage', offset: -1 }), false);
    assert.equal(isWebviewMessage({ type: 'arbitraryCommand' }), false);
  });

  it('declares Output, Data, Variables, Chat in order and places output before history', () => {
    const panelSource = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssStudioPanel.ts'),
      'utf8',
    );
    const outputTab = panelSource.indexOf('id="output-tab"');
    const dataTab = panelSource.indexOf('id="data-tab"');
    const variablesTab = panelSource.indexOf('id="variables-tab"');
    const aiTab = panelSource.indexOf('id="ai-tab"');
    assert.ok(outputTab >= 0 && outputTab < dataTab && dataTab < variablesTab && variablesTab < aiTab);
    assert.match(panelSource, /id="ai-tab" class="tab">Chat<\/button>/u);
    assert.match(panelSource, /id="ai-view"/u);
    assert.match(panelSource, /id="spss-ai"/u);
    const outputContent = panelSource.indexOf('id="output-content"');
    const outputHistory = panelSource.indexOf('id="output-history"');
    assert.ok(outputContent >= 0 && outputContent < outputHistory);
    assert.match(panelSource, /id="output-splitter"/u);
  });

  it('keeps run history collapsed until the History button is toggled', () => {
    const panelSource = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssStudioPanel.ts'),
      'utf8',
    );
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/studio.js'), 'utf8');
    const style = fs.readFileSync(path.resolve(__dirname, '../../../media/studio.css'), 'utf8');
    const explain = panelSource.indexOf('id="explain-output"');
    const exportOutput = panelSource.indexOf('id="export-output"');
    const print = panelSource.indexOf('id="print-output"');
    const history = panelSource.indexOf('id="toggle-history"');
    assert.ok(explain >= 0 && explain < exportOutput && exportOutput < print && print < history);
    assert.match(panelSource, /id="export-output" disabled>Export<\/button>/u);
    assert.match(script, /type: 'explainOutput'/u);
    assert.match(panelSource, /id="toggle-history"[^>]*aria-expanded="false"[^>]*>History/u);
    assert.match(script, /historyVisible: false/u);
    assert.match(script, /setHistoryVisible\(!state\.historyVisible\)/u);
    assert.match(style, /#output-history \{ display: none;/u);
    assert.match(style, /#output-view\.history-open #output-history/u);
  });

  it('uses row paging only in Data and adds compact variable selection actions', () => {
    const panelSource = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssStudioPanel.ts'),
      'utf8',
    );
    assert.doesNotMatch(panelSource, /id="previous-variables"|id="next-variables"|id="variable-summary"/u);
    assert.ok(panelSource.indexOf('id="next-page"') < panelSource.indexOf('id="page-size"'));
    for (const heading of ['Name', 'Label', 'Type', 'Format', 'Measure']) {
      assert.match(panelSource, new RegExp(`<th>${heading}</th>`, 'u'));
    }
    assert.match(panelSource, /id="variables-table"/u);
    const copy = panelSource.indexOf('id="copy-variables"');
    const insert = panelSource.indexOf('id="insert-variables"');
    const refresh = panelSource.indexOf('id="refresh-variables"');
    const explore = panelSource.indexOf('id="explore-variables"');
    assert.ok(copy >= 0 && copy < insert && insert < refresh && refresh < explore);
    assert.match(panelSource, /class="explore-help"[^>]*>\?<\/button>/u);
    assert.match(panelSource, /class="variable-checkbox-column"/u);
    assert.match(panelSource, /id="previous-variable-page">Previous<\/button>/u);
    assert.match(panelSource, /id="next-variable-page">Next<\/button>/u);
    assert.match(panelSource, /id="variable-filter"[^>]*placeholder="Filter Name or Label"/u);
    assert.ok(panelSource.indexOf('id="variable-page-size"') < panelSource.indexOf('id="variable-filter"'));
  });

  it('filters only the visible Variables page while preserving full-dataset selections', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/studio.js'), 'utf8');
    assert.match(script, /variableFilter: ''/u);
    assert.match(script, /filterVariables\(allVariables, state\.variableFilter\)/u);
    assert.match(script, /state\.variablePageOffset = 0;\s*renderVariables\(\);/u);
    assert.match(script, /function selectedVariableNames\(\)[\s\S]*state\.dataset\?\.active/u);
    assert.match(script, /selected\.length \? selected : filteredVariables\(\)\.slice\(0, 10\)/u);
  });

  it('inserts variables only from a double-click on the Name cell', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/studio.js'), 'utf8');
    assert.equal(script.match(/addEventListener\('dblclick'/gu)?.length, 1);
    assert.match(script, /const nameCell = appendTextCell\(row, name, 'variable-name'\)/u);
    assert.match(script, /nameCell\.addEventListener\('dblclick',[\s\S]*type: 'insertVariable', name/u);
  });
});
