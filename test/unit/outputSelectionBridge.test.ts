import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

interface Envelope { scope: string; message?: { type: string; html?: string; blocks?: Array<{ id: string; title: string }> } }
function fixture() {
  const filename = path.resolve(__dirname, '../../src/views/spssStudioPanel.js');
  const compiledRequire = createRequire(filename);
  const raw = fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/output-multiple-tables.html'), 'utf8');
  const posted: Envelope[] = [], questions: string[] = [], notices: string[] = [];
  let receiver: (message: unknown) => void = () => undefined;
  const uri = (value: string) => ({ fsPath: value, toString: () => value });
  const record = { id: 'one', htmlPath: '/runs/output.html', outputDirectory: '/runs', status: 'SUCCESS' };
  const panel = {
    visible: true, viewColumn: 2,
    webview: { html: '', cspSource: 'vscode-webview:', asWebviewUri: (value: unknown) => value,
      postMessage: (message: Envelope) => { posted.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: (callback: (value: unknown) => void) => { receiver = callback; },
    },
    onDidDispose: () => undefined, onDidChangeViewState: () => undefined, reveal: () => undefined,
  };
  const ai = {
    responseLanguage: 'en', attach: () => undefined, detach: () => undefined,
    handleMessage: () => Promise.resolve(), showPage: () => Promise.resolve(),
    sendQuestionFromEditor: (question: string) => { questions.push(question); return Promise.resolve(); },
  };
  const store = {
    sessionRoot: '/runs', selected: record, metadata: [{ ...record, hasHtml: true }],
    get: (id: string) => id === 'one' ? record : undefined, select: () => record, readHtml: () => raw,
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports: module.exports, module, process, Buffer,
    require: (name: string): unknown => name === 'vscode' ? {
      env: { language: 'en' }, ViewColumn: { Beside: -2 },
      Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
      window: { createWebviewPanel: () => panel, showInformationMessage: (message: string) => notices.push(message), showErrorMessage: (message: string) => notices.push(message) },
    } : compiledRequire(name),
  }, { filename });
  const Constructor = (module.exports as { SpssStudioPanel: new (...args: unknown[]) => { showOutput(): void } }).SpssStudioPanel;
  const instance = new Constructor(uri('/extension'), store, {}, ai);
  return { instance, posted, questions, notices, receive: (value: unknown) => receiver(value) };
}
async function flush(): Promise<void> { for (let i = 0; i < 15; i += 1) await Promise.resolve(); }

describe('SPSS selected output to Chat integration', () => {
  it('passes host-owned checked tables to Chat once and preserves explain-all without a selection', async () => {
    const ui = fixture(); ui.instance.showOutput(); ui.receive({ scope: 'shell', type: 'ready' }); await flush();
    const selected = ui.posted.find((item) => item.message?.type === 'executionSelected')?.message;
    assert.equal(selected?.blocks?.length, 12);
    assert.match(selected.html ?? '', /data-spss-output-block/u);
    const coefficients = selected.blocks.find((block) => block.title === 'Regression · Coefficients');
    assert.ok(coefficients);
    ui.receive({ scope: 'studio', message: { type: 'explainOutput', id: 'one', blockIds: [coefficients.id], html: 'FORGED PRIVATE OUTPUT' } }); await flush();
    assert.equal(ui.questions.length, 1);
    assert.match(ui.questions[0] ?? '', /1598\.992/u);
    assert.doesNotMatch(ui.questions[0] ?? '', /7846492\.510|353\.27620|FORGED PRIVATE OUTPUT/u);
    ui.receive({ scope: 'studio', message: { type: 'explainOutput', id: 'one', blockIds: [] } }); await flush();
    assert.equal(ui.questions.length, 2);
    assert.match(ui.questions[1] ?? '', /7846492\.510/u);
  });
  it('rejects stale or malformed IDs without reverting to the complete output', async () => {
    const ui = fixture(); ui.instance.showOutput(); ui.receive({ scope: 'shell', type: 'ready' }); await flush();
    ui.receive({ scope: 'studio', message: { type: 'explainOutput', id: 'one', blockIds: ['block-99999'] } }); await flush();
    assert.equal(ui.questions.length, 0); assert.equal(ui.notices.length, 1);
    ui.receive({ scope: 'studio', message: { type: 'explainOutput', id: 'one', blockIds: ['<script>'] } }); await flush();
    assert.equal(ui.questions.length, 0);
  });
});
