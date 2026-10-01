import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isAiWebviewMessage } from '../../src/views/aiWebviewProtocol';

describe('SPSS AI Webview contract', () => {
  it('accepts only bounded, well-formed user actions', () => {
    assert.equal(isAiWebviewMessage({ type: 'sendQuestion', question: 'How do I use FREQUENCIES?' }), true);
    assert.equal(isAiWebviewMessage({ type: 'stop' }), true);
    assert.equal(isAiWebviewMessage({ type: 'clear' }), true);
    assert.equal(isAiWebviewMessage({ type: 'insertCode', code: 'FREQUENCIES VARIABLES=age.' }), true);
    assert.equal(isAiWebviewMessage({ type: 'copyCode', code: 'FREQUENCIES VARIABLES=age.' }), true);
    assert.equal(isAiWebviewMessage({
      type: 'saveConfiguration',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-model',
      apiKey: '',
    }), true);
    assert.equal(isAiWebviewMessage({ type: 'sendQuestion', question: '' }), false);
    assert.equal(isAiWebviewMessage({ type: 'saveConfiguration', providerId: 'unknown' }), false);
    assert.equal(isAiWebviewMessage({ type: 'executeCode', code: 'DELETE EVERYTHING' }), false);
  });

  it('uses inert DOM rendering and creates Insert and Copy controls', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.js'), 'utf8');
    assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(/u);
    assert.match(script, /textContent/u);
    assert.match(script, /'Insert'/u);
    assert.match(script, /'Copy'/u);
  });

  it('declares a restrictive AI Webview content security policy', () => {
    const provider = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssAiViewProvider.ts'),
      'utf8',
    );
    assert.match(provider, /default-src 'none'/u);
    assert.match(provider, /connect-src 'none'/u);
    assert.doesNotMatch(provider, /unsafe-inline/u);
  });
});
