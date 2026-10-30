import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';

interface Envelope { scope: string; message?: { type: string; html?: string; blocks?: Array<{ id: string; title: string }> } }
function fixture(rawOverride?: string, outputDirectory = '/runs') {
  const filename = path.resolve(__dirname, '../../src/views/spssStudioPanel.js');
  const compiledRequire = createRequire(filename);
  let raw = rawOverride ?? fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/output-multiple-tables.html'), 'utf8');
  const posted: Envelope[] = [], questions: string[] = [], notices: string[] = [];
  const writes = new Map<string, string>();
  const opened: string[] = [];
  let dialogs = 0;
  let onSave: () => void = () => undefined;
  let receiver: (message: unknown) => void = () => undefined;
  const uri = (value: string) => ({ fsPath: value, toString: () => value });
  const record = { id: 'one', sequence: 1, timestamp: '2026-10-31T00:00:00Z', htmlPath: path.join(outputDirectory, 'output.html'), outputDirectory, status: 'SUCCESS' };
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
      env: { language: 'en', openExternal: (target: { fsPath: string }) => { opened.push(target.fsPath); return Promise.resolve(true); } }, ViewColumn: { Beside: -2 },
      Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
      window: { createWebviewPanel: () => panel, showInformationMessage: (message: string) => notices.push(message), showErrorMessage: (message: string) => notices.push(message),
        showSaveDialog: () => { dialogs += 1; onSave(); return Promise.resolve(uri('/export/result.html')); } },
      workspace: { fs: { writeFile: (target: { fsPath: string }, bytes: Buffer) => { writes.set(target.fsPath, bytes.toString('utf8')); return Promise.resolve(); } } },
    } : name === 'node:fs' ? { ...fs, promises: { ...fs.promises, writeFile: (target: string, text: string) => { writes.set(target, text); return Promise.resolve(); } } } : compiledRequire(name),
  }, { filename });
  const Constructor = (module.exports as { SpssStudioPanel: new (...args: unknown[]) => { showOutput(): void } }).SpssStudioPanel;
  const instance = new Constructor(uri('/extension'), store, {}, ai);
  return { instance, posted, questions, notices, writes, opened, dialogCount: () => dialogs,
    markup: () => panel.webview.html,
    onSave: (callback: () => void) => { onSave = callback; }, replaceRaw: (value: string) => { raw = value; },
    receive: (value: unknown) => receiver(value) };
}
async function flush(): Promise<void> { for (let i = 0; i < 15; i += 1) await Promise.resolve(); }

describe('SPSS selected output to Chat integration', () => {
  it('snapshots local images before waiting for the save dialog', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spss-export-snapshot-'));
    const image = path.join(root, 'chart.png');
    fs.writeFileSync(image, Buffer.from('TEST RASTER'));
    try {
      const ui = fixture('<body><p>Whole result</p><img src="chart.png"></body>', root);
      ui.instance.showOutput();
      ui.onSave(() => fs.rmSync(image));
      ui.receive({ scope: 'studio', message: { type: 'exportOutput', id: 'one', blockIds: [] } });
      await flush();
      assert.match(ui.writes.get('/export/result.html') ?? '', /data:image\/png;base64,VEVTVCBSQVNURVI=/u);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('exports only checked native results and snapshots them before the save dialog', async () => {
    const ui = fixture(); ui.instance.showOutput(); ui.receive({ scope: 'shell', type: 'ready' }); await flush();
    const selected = ui.posted.find((item) => item.message?.type === 'executionSelected')?.message;
    const coefficients = selected?.blocks?.find((block) => block.title === 'Regression · Coefficients');
    assert.ok(coefficients);
    ui.onSave(() => ui.replaceRaw('<table><tr><td>CHANGED AFTER CLICK</td></tr></table>'));
    ui.receive({ scope: 'studio', message: { type: 'exportOutput', id: 'one', blockIds: [coefficients.id], html: 'FORGED' } }); await flush();
    const html = ui.writes.get('/export/result.html') ?? '';
    assert.match(html, /1598\.992/u);
    assert.doesNotMatch(html, /7846492\.510|CHANGED AFTER CLICK|FORGED/u);
    assert.equal(ui.questions.length, 0);
  });

  it('prints checked results to distinct files and preserves whole-run export when unchecked', async () => {
    const ui = fixture(); ui.instance.showOutput(); ui.receive({ scope: 'shell', type: 'ready' }); await flush();
    const selected = ui.posted.find((item) => item.message?.type === 'executionSelected')?.message;
    const coefficients = selected?.blocks?.find((block) => block.title === 'Regression · Coefficients');
    assert.ok(coefficients);
    for (let i = 0; i < 2; i += 1) { ui.receive({ scope: 'studio', message: { type: 'printOutput', id: 'one', blockIds: [coefficients.id] } }); }
    await flush();
    assert.equal(ui.opened.length, 2);
    assert.notEqual(ui.opened[0], ui.opened[1]);
    for (const filename of ui.opened) {
      const html = ui.writes.get(filename) ?? '';
      assert.match(html, /1598\.992/u);
      assert.match(html, /window\.print/u);
      assert.doesNotMatch(html, /7846492\.510/u);
    }
    ui.receive({ scope: 'studio', message: { type: 'exportOutput', id: 'one', blockIds: [] } }); await flush();
    assert.match(ui.writes.get('/export/result.html') ?? '', /7846492\.510/u);
    assert.equal(ui.questions.length, 0);
  });

  it('never opens export or print for stale selections', async () => {
    const ui = fixture();
    ui.instance.showOutput();
    for (const type of ['exportOutput', 'printOutput']) { ui.receive({ scope: 'studio', message: { type, id: 'one', blockIds: ['block-99999'] } }); }
    await flush();
    assert.equal(ui.writes.size, 0);
    assert.equal(ui.opened.length, 0);
    assert.equal(ui.dialogCount(), 0);
  });

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
