import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isQuickStartMessage } from '../../src/quickStart/quickStartState';

describe('packaged SPSS examples', () => {
  it('accepts the dedicated Example action', () => {
    assert.equal(isQuickStartMessage({ type: 'openExample' }), true);
  });

  it('opens bilingual editable copies with escaped local SAV paths and keeps edits', async () => {
    const modulePath = '../../src/quickStart/exampleFiles.js';
    const { prepareExample } = await import(modulePath) as {
      prepareExample: (extensionRoot: string, storageRoot: string, language: 'en' | 'zh-cn') => Promise<string>;
    };
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssx-示例 O'Brien-"));
    try {
      const extensionRoot = path.resolve(__dirname, '../../..');
      const english = await prepareExample(extensionRoot, root, 'en');
      const chinese = await prepareExample(extensionRoot, root, 'zh-cn');
      assert.notEqual(english, chinese);
      const en = await fs.readFile(english, 'utf8');
      const zh = await fs.readFile(chinese, 'utf8');
      assert.match(en, /GET FILE='/u);
      assert.ok(en.includes("O''Brien"));
      assert.ok(en.includes(root.replaceAll('\\', '/').replaceAll("'", "''")));
      assert.match(zh, /模拟数据/u);
      assert.match(en, /CODEBOOK/iu);
      assert.match(zh, /REGRESSION/iu);
      const data = await fs.readFile(path.join(path.dirname(english), 'spss-studio-example.sav'));
      assert.equal(data.subarray(0, 4).toString('ascii'), '$FL2');
      assert.ok(data.length < 32_000);
      await fs.writeFile(english, '* My edits.\n');
      assert.equal(await prepareExample(extensionRoot, root, 'en'), english);
      assert.equal(await fs.readFile(english, 'utf8'), '* My edits.\n');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
