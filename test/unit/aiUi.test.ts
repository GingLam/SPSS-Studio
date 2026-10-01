import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isAiWebviewMessage } from '../../src/views/aiWebviewProtocol';

describe('SPSS AI Webview contract', () => {
  it('accepts only bounded, well-formed user actions', () => {
    assert.equal(isAiWebviewMessage({ type: 'ready' }), true);
    assert.equal(isAiWebviewMessage({ type: 'sendQuestion', question: 'How do I use FREQUENCIES?' }), true);
    assert.equal(isAiWebviewMessage({ type: 'stop' }), true);
    assert.equal(isAiWebviewMessage({ type: 'newChat' }), true);
    assert.equal(isAiWebviewMessage({ type: 'clearAllConversations' }), true);
    assert.equal(isAiWebviewMessage({ type: 'openConversation', conversationId: 'conversation-1' }), true);
    assert.equal(isAiWebviewMessage({
      type: 'renameConversation',
      conversationId: 'conversation-1',
      title: 'Descriptive statistics',
    }), true);
    assert.equal(isAiWebviewMessage({ type: 'deleteConversation', conversationId: 'conversation-1' }), true);
    assert.equal(isAiWebviewMessage({ type: 'selectProfile', profileId: 'profile-1' }), true);
    assert.equal(isAiWebviewMessage({ type: 'insertCode', code: 'FREQUENCIES VARIABLES=age.' }), true);
    assert.equal(isAiWebviewMessage({ type: 'copyCode', code: 'FREQUENCIES VARIABLES=age.' }), true);
    assert.equal(isAiWebviewMessage({
      type: 'createProfile',
      name: 'DeepSeek teaching',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-model',
      apiKey: '',
    }), true);
    assert.equal(isAiWebviewMessage({
      type: 'saveProfile',
      profileId: 'profile-1',
      name: '',
      providerId: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    }), true);
    assert.equal(isAiWebviewMessage({ type: 'setComposerHeight', height: 180 }), true);
    assert.equal(isAiWebviewMessage({ type: 'sendQuestion', question: '' }), false);
    assert.equal(isAiWebviewMessage({
      type: 'createProfile',
      providerId: 'unknown',
      baseUrl: 'https://example.com',
      model: 'model',
    }), false);
    assert.equal(isAiWebviewMessage({ type: 'setComposerHeight', height: 20 }), false);
    assert.equal(isAiWebviewMessage(Object.create({ type: 'ready' }) as unknown), false);
    assert.equal(isAiWebviewMessage({ type: 'executeCode', code: 'DELETE EVERYTHING' }), false);
  });

  it('uses inert DOM rendering, localized code actions, and a ready handshake', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.js'), 'utf8');
    assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(/u);
    assert.match(script, /textContent/u);
    assert.match(script, /strings\.insert/u);
    assert.match(script, /strings\.copy/u);
    assert.match(script, /type: 'ready'/u);
    assert.ok(
      script.indexOf("window.addEventListener('message'") < script.indexOf("type: 'ready'"),
      'the Webview must install its message listener before requesting initial state',
    );
    assert.match(script, /type: 'createProfile'/u);
    assert.match(script, /type: 'openConversation'/u);
    assert.match(script, /type: 'setComposerHeight'/u);
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

  it('keeps model profiles behind Manage Models and exposes an adjustable composer boundary', () => {
    const provider = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssAiViewProvider.ts'),
      'utf8',
    );
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.js'), 'utf8');
    const style = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.css'), 'utf8');
    assert.match(provider, /data-page="chat"/u);
    assert.match(provider, /data-page="history"/u);
    assert.doesNotMatch(provider, /data-page="profiles"/u);
    assert.match(provider, /id="manage-profiles"/u);
    assert.match(provider, /id="page-profiles"/u);
    assert.match(script, /manageProfiles\.addEventListener\('click', \(\) => showPage\('profiles'\)\)/u);
    assert.match(provider, /role="separator"/u);
    assert.match(provider, /aria-orientation="horizontal"/u);
    assert.match(script, /ArrowUp/u);
    assert.match(script, /ArrowDown/u);
    assert.match(script, /setPointerCapture/u);
    assert.match(style, /--composer-height/u);
    assert.match(style, /cursor: ns-resize/u);
  });

  it('distinguishes chat roles and highlights SPSS code without unsafe HTML rendering', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.js'), 'utf8');
    const style = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.css'), 'utf8');

    assert.match(script, /if \(role === 'assistant'\)/u);
    assert.doesNotMatch(script, /role === 'user'\s*\?\s*strings\.user/u);
    assert.match(script, /function renderSpssCode/u);
    assert.match(script, /className = `syntax-token \$\{token\.type\}`/u);
    assert.match(script, /isSpssLanguage\(segment\.language\)/u);
    assert.match(style, /--vscode-inputOption-activeBackground/u);
    assert.match(style, /\.code-block[\s\S]*--vscode-editor-background/u);
    assert.match(style, /\.syntax-token\.keyword/u);
    assert.match(style, /\.syntax-token\.comment/u);
    assert.match(style, /\.code-actions button/u);
    assert.match(style, /--vscode-button-background/u);
  });

  it('keeps AI navigation in one compact header without redundant titles', () => {
    const provider = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssAiViewProvider.ts'),
      'utf8',
    );
    const headerStart = provider.indexOf('<header class="ai-header">');
    const tabs = provider.indexOf('<nav id="tabs"');
    const headerEnd = provider.indexOf('</header>', headerStart);
    assert.ok(headerStart >= 0 && tabs > headerStart && tabs < headerEnd);
    assert.doesNotMatch(provider, /id="ai-title"/u);
    assert.doesNotMatch(provider, /id="transcript-title"/u);

    const style = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.css'), 'utf8');
    assert.match(style, /grid-template-rows: auto auto minmax\(0, 1fr\)/u);
    assert.match(style, /grid-template-rows: minmax\(0, 1fr\) 9px var\(--composer-height\)/u);
  });
});
