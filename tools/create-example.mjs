// Maintainer tool: uses the existing local SPSS installation, never a user download.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BridgeManager } = require('../out/src/spss/bridgeManager.js');
const { locateSpss } = require('../out/src/spss/spssLocator.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'resources', 'examples', 'spss-studio-example.sav');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ssx-create-example-'));
const manager = new BridgeManager({ startupTimeoutMs: 120_000, executionTimeoutMs: 120_000 });
try {
  const installation = await locateSpss();
  if (!installation) throw new Error('A licensed local IBM SPSS installation is required.');
  await manager.start(installation, path.join(root, 'resources', 'bridge', 'spss_bridge.py'));
  const rows = Array.from({ length: 60 }, (_, i) => {
    const id = i + 1;
    const age = 22 + (id * 7) % 39;
    const gender = id % 2;
    const edu = 9 + (id * 5 + Math.floor(id / 5)) % 13;
    const hours = 30 + (id * 3 + Math.floor(id / 3)) % 23;
    const income = 1200 + 85 * edu + 24 * age + 18 * hours + 120 * gender + (id * 137) % 1200 - 600;
    return `${id} ${age} ${gender} ${edu} ${income} ${hours}`;
  });
  const syntax = [
    'DATA LIST FREE /id age gender edu income hours.', 'BEGIN DATA', ...rows, 'END DATA.',
    'VARIABLE LABELS id "Case identifier" age "Age in years" gender "Simulated gender group" edu "Years of education" income "Simulated monthly income" hours "Weekly working hours".',
    'VALUE LABELS gender 0 "Group A" 1 "Group B".',
    'VARIABLE LEVEL id gender (NOMINAL) age edu income hours (SCALE).',
    'FORMATS id(F3.0) age(F2.0) gender(F1.0) edu(F2.0) income(F8.2) hours(F4.1).',
    'FILE LABEL "SPSS Studio: 60 fictional teaching cases; no real people.".',
    `SAVE OUTFILE='${target.replaceAll("'", "''")}' /COMPRESSED.`,
  ].join('\n');
  const response = await manager.run(syntax, { runId: 'create-example', outputDirectory: temporary });
  if (!response.ok || response.errorLevel > 1) throw new Error(response.error ?? 'Example creation failed.');
  const info = await manager.datasetInfo();
  if (info.caseCount !== 60 || info.variableCount !== 6) throw new Error('Unexpected example dimensions.');
  process.stdout.write(JSON.stringify({ cases: info.caseCount, variables: info.variableCount, bytes: (await fs.stat(target)).size }) + '\n');
} finally {
  await manager.stop();
  await fs.rm(temporary, { recursive: true, force: true });
}
