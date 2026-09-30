import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isWebviewMessage } from '../../src/views/webviewProtocol';

describe('SPSS Studio Webview UI contract', () => {
  it('accepts only well-formed data, tab, and output action messages', () => {
    assert.equal(isWebviewMessage({ type: 'showData' }), true);
    assert.equal(isWebviewMessage({ type: 'showVariables' }), true);
    assert.equal(isWebviewMessage({ type: 'refreshVariables' }), true);
    assert.equal(isWebviewMessage({ type: 'exportOutput', id: 'run-1' }), true);
    assert.equal(isWebviewMessage({ type: 'printOutput', id: 'run-1' }), true);
    assert.equal(isWebviewMessage({
      type: 'requestDatasetPage', offset: 0, limit: 100, variableStart: 0, variableLimit: 50,
      requestId: 1, generation: 0,
    }), true);
    assert.equal(isWebviewMessage({ type: 'exportOutput', id: '' }), false);
    assert.equal(isWebviewMessage({ type: 'requestDatasetPage', offset: -1 }), false);
    assert.equal(isWebviewMessage({ type: 'arbitraryCommand' }), false);
  });

  it('declares Output, Data, Variables and places output before history', () => {
    const panelSource = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssStudioPanel.ts'),
      'utf8',
    );
    const outputTab = panelSource.indexOf('id="output-tab"');
    const dataTab = panelSource.indexOf('id="data-tab"');
    const variablesTab = panelSource.indexOf('id="variables-tab"');
    assert.ok(outputTab >= 0 && outputTab < dataTab && dataTab < variablesTab);
    const outputContent = panelSource.indexOf('id="output-content"');
    const outputHistory = panelSource.indexOf('id="output-history"');
    assert.ok(outputContent >= 0 && outputContent < outputHistory);
    assert.match(panelSource, /id="output-splitter"/u);
  });

  it('uses row paging only in Data and five read-only variable attributes', () => {
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
  });
});
