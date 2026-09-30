import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shouldRefreshDatasetMetadata } from '../../src/spss/executionResult';
import { DataPreviewState } from '../../src/views/dataPreviewState';
import { sanitizeSpssHtml } from '../../src/views/htmlSanitizer';
import { OutputStore } from '../../src/views/outputStore';

describe('SPSS output and data preview state', () => {
  it('refreshes metadata after an SPSS error when the processor remains alive', () => {
    assert.equal(shouldRefreshDatasetMetadata({ status: 'ERROR', engineAlive: true }), true);
    assert.equal(shouldRefreshDatasetMetadata({ status: 'WARNING', engineAlive: true }), true);
    assert.equal(shouldRefreshDatasetMetadata({ status: 'ENGINE_ERROR', engineAlive: false }), false);
    assert.equal(shouldRefreshDatasetMetadata({ status: 'TIMEOUT', engineAlive: false }), false);
  });

  it('keeps only execution metadata in memory and lazily reads selected HTML', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spss-output-test-'));
    const store = new OutputStore(temporaryRoot);
    try {
      const first = store.begin('Run Current Command');
      const firstHtml = path.join(first.target.outputDirectory, 'output.html');
      fs.writeFileSync(firstHtml, '<table><tr><td>first</td></tr></table>', 'utf8');
      store.complete(first.record.id, {
        id: 'one', ok: true, errorLevel: 0, output: '', warnings: [], error: null,
        durationMs: 12, engineAlive: true, status: 'SUCCESS', htmlPath: firstHtml,
      });
      const second = store.begin('Run File');
      store.complete(second.record.id, {
        id: 'two', ok: true, errorLevel: 0, output: '', warnings: [], error: null,
        durationMs: 3, engineAlive: true, status: 'SUCCESS_NO_OUTPUT', htmlPath: null,
      });

      assert.equal(store.metadata.length, 2);
      assert.equal(store.metadata[0]?.hasHtml, false);
      assert.ok(!JSON.stringify(store.metadata).includes('<table>'));
      assert.match(store.readHtml(first.record.id) ?? '', /first/u);
      assert.equal(store.readHtml(second.record.id), undefined);
      store.clear();
      assert.equal(store.metadata.length, 0);
      assert.equal(fs.existsSync(first.target.outputDirectory), false);
    } finally {
      store.dispose();
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('sanitizes executable and remote HTML while preserving SPSS table order', () => {
    const source = `<!doctype html><html><head><style>@import 'https://bad'; table{color:red;background:url(https://bad)}</style><script>alert(1)</script></head><body>
<div onclick="bad()">Warnings</div><table><tr><td>Result</td></tr></table>
<img src="output_files/chart.png" onerror="bad()"><img src="data:image/png;base64,QUJD"><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="https://bad/chart.png">
<a href="javascript:bad()">Unsafe link</a></body></html>`;
    const sanitized = sanitizeSpssHtml(source, (image) => {
      if (image.startsWith('output_files/')) return `webview://${image}`;
      if (/^data:image\/(?:png|jpe?g|gif|bmp);base64,[a-z0-9+/=]+$/iu.test(image)) return image;
      return undefined;
    });
    assert.ok(sanitized.indexOf('Warnings') < sanitized.indexOf('Result'));
    assert.match(sanitized, /<table>/u);
    assert.match(sanitized, /webview:\/\/output_files\/chart\.png/u);
    assert.match(sanitized, /data:image\/png;base64,QUJD/u);
    assert.doesNotMatch(sanitized, /image\/svg/iu);
    assert.doesNotMatch(sanitized, /script|onclick|onerror|https:\/\/bad|javascript:/iu);
  });

  it('normalizes row and variable pagination without allowing unbounded pages', () => {
    const state = new DataPreviewState(100);
    assert.deepEqual(state.current, { offset: 0, limit: 100, variableStart: 0, variableLimit: 50 });
    assert.deepEqual(
      state.update({ offset: -5, limit: 10_000, variableStart: -1, variableLimit: 10_000 }),
      { offset: 0, limit: 100, variableStart: 0, variableLimit: 200 },
    );
  });

  it('uses one short-lived HTML OMS path and excludes forbidden output/client APIs', () => {
    const bridge = fs.readFileSync(path.resolve(__dirname, '../../../resources/bridge/spss_bridge.py'), 'utf8');
    assert.match(bridge, /FORMAT=HTML/u);
    assert.match(bridge, /VIEWER=NO/u);
    assert.match(bridge, /IMAGEFORMAT=PNG/u);
    assert.match(bridge, /__SPSS_STUDIO_/u);
    assert.doesNotMatch(bridge, /FORMAT=TEXT|FORMAT=OXML|FORMAT=SPV|SpssClient|fetchall\s*\(/u);
    assert.doesNotMatch(bridge, /OMSEND\."/u);
  });
});
