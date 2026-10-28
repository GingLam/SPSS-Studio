import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BridgeManager } from '../src/spss/bridgeManager';
import { locateSpss } from '../src/spss/spssLocator';
import { prepareExample } from '../src/quickStart/exampleFiles';
import { descendants, htmlText, parseHtmlDocument } from '../src/ai/htmlDocument';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '../..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ssx-示例 O'Brien-"));
  const data = path.join(root, 'resources/examples/spss-studio-example.sav');
  const before = createHash('sha256').update(await fs.readFile(data)).digest('hex');
  const installation = await locateSpss();
  assert.ok(installation);
  const manager = new BridgeManager({ startupTimeoutMs: 120_000, executionTimeoutMs: 120_000 });
  let sequence = 0;
  const run = (syntax: string) => manager.run(syntax, {
    runId: String(++sequence), outputDirectory: path.join(temp, `run-${String(sequence)}`),
  });
  try {
    await manager.start(installation, path.join(root, 'resources/bridge/spss_bridge.py'));
    await run('DATA LIST FREE /keep_id.\nBEGIN DATA\n1\nEND DATA.\nDATASET NAME KeepMe.');
    for (const language of ['en', 'zh-cn'] as const) {
      const file = await prepareExample(root, temp, language);
      const syntax = await fs.readFile(file, 'utf8');
      const response = await run(syntax);
      const nativeOutput = response.htmlPath ? await fs.readFile(response.htmlPath, 'utf8') : '';
      assert.equal(response.errorLevel, 0, nativeOutput ? htmlText(parseHtmlDocument(nativeOutput)).slice(-3000) : response.error ?? language);
      assert.equal(response.status, 'SUCCESS');
      assert.ok(response.htmlPath);
      const document = parseHtmlDocument(await fs.readFile(response.htmlPath, 'utf8'));
      const tables = descendants(document, 'table').length;
      const images = descendants(document, 'img');
      assert.ok(tables >= 8, `${language}: ${String(tables)} tables`);
      assert.ok(images.length >= 2, `${language}: charts missing`);
      for (const image of images) {
        const source = image.attributes.src;
        if (source && !source.startsWith('data:')) {
          const imageFile = path.resolve(path.dirname(response.htmlPath), decodeURIComponent(source));
          assert.ok((await fs.stat(imageFile)).size > 0);
        }
      }
      const info = await manager.datasetInfo();
      assert.equal(info.caseCount, 60);
      assert.deepEqual(info.variables.map((v) => v.name), ['id', 'age', 'gender', 'edu', 'income', 'hours']);
      // Repeat the exact same GET without deleting unrelated named datasets.
      const repeated = await run(syntax.match(/^GET FILE=.+$/mu)?.[0] ?? '');
      assert.equal(repeated.ok, true);
      assert.equal((await manager.datasetInfo()).caseCount, 60);
      const activate = await run('DATASET ACTIVATE KeepMe.');
      assert.equal(activate.errorLevel, 0);
      assert.equal((await manager.datasetInfo()).variables[0]?.name, 'keep_id');
      process.stdout.write(JSON.stringify({ language, cases: 60, variables: 6, tables, charts: images.length, namedDatasetPreserved: true }) + '\n');
    }
    await manager.clearData();
    assert.equal((await manager.datasetInfo()).active, false);
    assert.equal(manager.state, 'ready');
    assert.equal((await run('DATASET ACTIVATE KeepMe.')).ok, false);
    await manager.clearData();
    const file = await prepareExample(root, temp, 'en');
    assert.equal((await run(await fs.readFile(file, 'utf8'))).errorLevel, 0);
    assert.equal((await manager.datasetInfo()).caseCount, 60);
    assert.equal(createHash('sha256').update(await fs.readFile(data)).digest('hex'), before);
    process.stdout.write('Clear, reload, and unchanged original SAV: passed.\n');
  } finally {
    await manager.stop();
    await fs.rm(temp, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
