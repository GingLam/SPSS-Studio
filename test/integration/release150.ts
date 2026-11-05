import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BridgeManager } from '../../src/spss/bridgeManager';
import { locateSpss } from '../../src/spss/spssLocator';
import { nativeOutputLanguage } from '../../src/spss/outputLanguage';
import { descendants, htmlText, parseHtmlDocument } from '../../src/ai/htmlDocument';
import type { SpssOutputLanguage } from '../../src/spss/types';
import { probeRuntime } from '../../src/setup/runtimeProbe';

const recode = [
  'RECODE I2_1 (1=0) (2=6) ',
  '            (3=9) (4 THRU 7=12)',
  '            (8=15) (9=16)',
  '            (10=19) (11=22)',
  '            (99,99997,99998,99999=SYSMIS)            ',
  '            INTO edu_year.',
].join('\n');
const setup = [
  'NEW FILE.', 'DATASET CLOSE ALL.', 'DATA LIST FREE /I2_1.', 'BEGIN DATA',
  '1', '2', '3', '4', '7', '8', '9', '10', '11', '99', '99997', '99998', '99999',
  'END DATA.',
].join('\n');

async function main(): Promise<void> {
  const project = path.resolve(__dirname, '../../..');
  const extension = process.env.SPSS_STUDIO_TEST_EXTENSION_PATH ?? project;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssx150-中文 O'Brien-"));
  const installation = await locateSpss();
  assert.ok(installation, 'An existing licensed SPSS installation is required.');
  let sequence = 0;
  const checks: string[] = [];
  const session = async (language: SpssOutputLanguage, test: (manager: BridgeManager) => Promise<void>): Promise<void> => {
    const manager = new BridgeManager({ startupTimeoutMs: 120_000, executionTimeoutMs: 120_000, outputLanguage: language });
    try { await manager.start(installation, path.join(extension, 'resources/bridge/spss_bridge.py')); await test(manager); }
    finally { await manager.stop(); }
  };
  const run = async (manager: BridgeManager, syntax: string, language?: SpssOutputLanguage) => {
    const id = String(++sequence);
    const response = await manager.run(syntax, { runId: id, outputDirectory: path.join(root, `run-${id}`) }, language);
    const document = parseHtmlDocument(response.htmlPath ? await fs.readFile(response.htmlPath, 'utf8') : '');
    const output = htmlText(document);
    const cells = [...descendants(document, 'td'), ...descendants(document, 'th')].map((cell) => htmlText(cell).trim());
    assert.equal(response.ok, true, `${String(response.error)}\n${output}`);
    assert.ok(response.errorLevel <= 1, output);
    return { response, output, cells };
  };
  const checkLanguage = async (manager: BridgeManager, uiLanguage: string) => {
    const language = nativeOutputLanguage(uiLanguage);
    const { output, cells } = await run(manager, 'DESCRIPTIVES VARIABLES=I2_1.', language);
    if (language === 'Schinese') {
      assert.match(output, /平均值|均值|平均数/u);
      assert.match(output, /描述统计/u);
      assert.ok(!cells.includes('Mean'));
    } else {
      assert.ok(cells.includes('Mean'), output);
      assert.match(output, /Descriptive Statistics/u);
    }
    checks.push(`native-output-${uiLanguage}`);
  };
  try {
    await session('English', async (manager) => {
      for (const endings of ['LF', 'CRLF', 'mixed'] as const) {
        const lf = `${setup}\n${recode}\nEXECUTE.`;
        const syntax = endings === 'LF' ? lf : endings === 'CRLF' ? lf.replace(/\n/gu, '\r\n')
          : lf.split('\n').map((line, index) => line + (index % 2 ? '\r\n' : '\n')).join('');
        const result = await run(manager, syntax);
        assert.deepEqual(result.response.warnings, [], 'Ordinary line endings are silent compatibility handling.');
        const page = await manager.datasetPage({ offset: 0, limit: 13, variableStart: 0, variableLimit: 2 });
        assert.deepEqual(page.rows.map((row) => row[1]), [0, 6, 9, 12, 12, 15, 16, 19, 22, null, null, null, null]);
        checks.push(`exact-recode-${endings}`);
      }
      await checkLanguage(manager, 'en');
      await checkLanguage(manager, 'zh-cn');
      await checkLanguage(manager, 'fr');
      const file = path.join(root, "示例 O'Brien.sav");
      await fs.copyFile(path.join(extension, 'resources/examples/spss-studio-example.sav'), file);
      await manager.clearData();
      await run(manager, `GET FILE "${file.replaceAll('"', '""')}".\r\nCODEBOOK age.`);
      assert.equal((await manager.datasetInfo()).caseCount, 60);
      checks.push('GET-FILE-no-equals-double-quotes-unicode-apostrophe');
      const multiline = [
        `GET FILE "${file.replaceAll('"', '""')}".`, '', '',
        '* A researcher\'s note: keep blank lines and don\'t change string payloads.', '',
        'COMPUTE age_copy=', '', ' age.', '',
        'DO IF age>0.',
        'COMPUTE age_copy=age. /* A valid SPSS line-end comment without a closing marker',
        'COMPUTE age_copy=age.', 'END IF.', '',
        'RECODE age', '', ' (LOWEST THRU 30=1)', '', ' (31 THRU HIGHEST=2)', '', ' INTO ageband.', '',
        'VARIABLE LABELS age_copy "Copied age".', '',
        'EXECUTE.', '',
        'CODEBOOK age gender edu.', '',
        'FREQUENCIES VARIABLES=gender ageband.', '',
        'DESCRIPTIVES VARIABLES=age edu income hours', '', ' /STATISTICS=MEAN STDDEV MIN MAX.', '',
        'CROSSTABS', '', ' /TABLES=gender BY ageband', '', ' /CELLS=COUNT ROW.', '',
        'EXAMINE VARIABLES=income', '', ' /PLOT NONE', '', ' /CINTERVAL 95.', '',
        'T-TEST GROUPS=gender(0 1)', '', ' /VARIABLES=income', '', ' /CRITERIA=CI(.95).', '',
        'REGRESSION', '', ' /DEPENDENT income', '', ' /METHOD=ENTER age gender edu hours.', '',
        'GRAPH /BAR(SIMPLE)=COUNT BY gender.', '',
        'GRAPH /SCATTERPLOT(BIVAR)=edu WITH income.', '',
      ].join('\n');
      for (const uiLanguage of ['en', 'zh-cn']) {
        for (const endings of ['LF', 'CRLF', 'mixed'] as const) {
          await manager.clearData();
          const syntax = endings === 'LF' ? multiline : endings === 'CRLF' ? multiline.replace(/\n/gu, '\r\n')
            : multiline.split('\n').map((line, index) => line + (index % 2 ? '\r\n' : '\n')).join('');
          const { response, output, cells } = await run(manager, syntax, nativeOutputLanguage(uiLanguage));
          assert.deepEqual(response.warnings, []);
          const info = await manager.datasetInfo();
          const page = await manager.datasetPage({ offset: 0, limit: 60, variableStart: 0, variableLimit: 8 });
          const age = info.variables.findIndex((variable) => variable.name === 'age');
          const copy = info.variables.findIndex((variable) => variable.name === 'age_copy');
          const band = info.variables.findIndex((variable) => variable.name === 'ageband');
          assert.ok(age >= 0 && copy >= 0 && band >= 0);
          assert.equal(page.rows.length, 60);
          for (const row of page.rows) {
            assert.equal(row[copy], row[age]);
            assert.equal(row[band], Number(row[age]) <= 30 ? 1 : 2);
          }
          if (uiLanguage === 'zh-cn') {
            assert.match(output, /描述统计/u);
            assert.match(output, /系数/u);
            assert.match(output, /独立样本检验/u);
            assert.ok(!cells.includes('Mean'));
          } else {
            assert.match(output, /Descriptive Statistics/u);
            assert.match(output, /Coefficients/u);
            assert.match(output, /Independent Samples Test/u);
            assert.ok(cells.includes('Mean'));
          }
          checks.push(`blank-lines-multiple-procedures-${uiLanguage}-${endings}`);
        }
      }
      await run(manager, 'TITLE "O\'Brien ""quoted""".\nDESCRIPTIVES age.\nTITLE.');
      checks.push('double-quote-escape-native');
    });
    await session('Schinese', async (manager) => {
      await run(manager, setup);
      const { output } = await run(manager, 'DESCRIPTIVES I2_1.');
      assert.match(output, /平均值|均值|平均数/u);
      checks.push('restarted-native-chinese');
    });
    await session('English', async (manager) => {
      await run(manager, setup);
      const { output, cells } = await run(manager, 'DESCRIPTIVES I2_1.');
      assert.ok(cells.includes('Mean'), output);
      checks.push('restarted-native-english');
    });
    const setupProbe = await probeRuntime(installation, path.join(extension, 'resources/bridge/spss_bridge.py'), {
      installPath: installation.installRoot, pythonLauncherPath: installation.pythonLauncher,
      startupTimeoutSeconds: 120, executionTimeoutSeconds: 120, dataPreviewPageSize: 100,
      autoStart: true, debugLogging: false, uiLanguage: 'zh-cn',
    }, new AbortController().signal);
    assert.equal(setupProbe.ok, true, setupProbe.error);
    assert.deepEqual(setupProbe.passed, ['startup', 'analysis', 'data', 'output', 'shutdown']);
    checks.push('chinese-five-stage-runtime-setup');
    const result = { status: 'PASS', checks, artifactRoot: root, installation: installation.version };
    if (process.env.SPSS_STUDIO_150_REPORTS) {
      await fs.mkdir(process.env.SPSS_STUDIO_150_REPORTS, { recursive: true });
      await fs.writeFile(path.join(process.env.SPSS_STUDIO_150_REPORTS, 'native-release150.json'), JSON.stringify(result, null, 2));
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Native test artifacts retained at ${root}\n`);
    throw error;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
