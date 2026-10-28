import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BridgeManager } from '../spss/bridgeManager';
import type { SpssInstallation } from '../spss/platform/types';
import type { SpssRuntimeConfiguration } from '../spss/engineService';
import { descendants, htmlText, parseHtmlDocument } from '../ai/htmlDocument';

export type ProbeStage = 'startup' | 'analysis' | 'data' | 'output' | 'shutdown';
export interface ProbeResult {
  installation: SpssInstallation;
  passed: ProbeStage[];
  ok: boolean;
  error?: string;
  stage?: ProbeStage;
  diagnostics: string[];
}

export const SETUP_SYNTAX = [
  'DATA LIST FREE /ssx_id ssx_age.',
  'BEGIN DATA', '1 20', '2 30', '3 40', 'END DATA.',
  'DATASET NAME SSXSetup.',
  "VARIABLE LABELS ssx_age 'SPSS Studio 测试'.",
  'DESCRIPTIVES VARIABLES=ssx_age.',
  'AGGREGATE OUTFILE=* MODE=ADDVARIABLES /BREAK= /ssx_mean=MEAN(ssx_age).',
  'EXECUTE.',
].join('\n');

export async function probeRuntime(
  installation: SpssInstallation,
  bridgePath: string,
  configuration: SpssRuntimeConfiguration,
  signal: AbortSignal,
  progress: (stage: ProbeStage) => void = () => undefined,
  createManager: (options: ConstructorParameters<typeof BridgeManager>[0]) => BridgeManager = (options) => new BridgeManager(options),
): Promise<ProbeResult> {
  const diagnostics: string[] = [];
  const result: ProbeResult = { installation, passed: [], ok: false, diagnostics };
  const manager = createManager({
    startupTimeoutMs: configuration.startupTimeoutSeconds * 1000,
    executionTimeoutMs: configuration.executionTimeoutSeconds * 1000,
    shutdownTimeoutMs: 10_000,
    debug: true,
    onDiagnostic: (message) => {
      diagnostics.push(message.slice(0, 2000));
      if (diagnostics.length > 30) { diagnostics.shift(); }
    },
  });
  const abort = (): void => manager.abort();
  signal.addEventListener('abort', abort, { once: true });
  let temporaryRoot: string | undefined;
  let stage: ProbeStage = 'startup';
  const advance = (value: ProbeStage): void => {
    signal.throwIfAborted();
    stage = value;
    progress(value);
  };
  try {
    advance('startup');
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spss-studio-setup-'));
    signal.throwIfAborted();
    await manager.start(installation, bridgePath);
    result.passed.push('startup');
    advance('analysis');
    const response = await manager.run(SETUP_SYNTAX, { runId: 'setup', outputDirectory: temporaryRoot });
    if (!response.ok || response.engineAlive !== true || response.errorLevel > 1) {
      throw new Error(response.error ?? 'SETUP_ANALYSIS_FAILED');
    }
    result.passed.push('analysis');
    advance('data');
    const info = await manager.datasetInfo();
    const page = await manager.datasetPage({ offset: 0, limit: 3, variableStart: 0, variableLimit: 3 });
    const names = info.variables.map((variable) => variable.name.toLowerCase());
    const expected = ['ssx_id', 'ssx_age', 'ssx_mean'];
    if (info.caseCount !== 3 || expected.some((name) => !names.includes(name))) {
      throw new Error('SETUP_METADATA_FAILED');
    }
    const columns = page.variables.map((variable) => variable.name.toLowerCase());
    if (page.rows.length !== 3 || page.rows.some((row, index) => (
      row[columns.indexOf('ssx_id')] !== index + 1
      || row[columns.indexOf('ssx_age')] !== (index + 2) * 10
      || row[columns.indexOf('ssx_mean')] !== 30
    ))) { throw new Error('SETUP_DATA_FAILED'); }
    result.passed.push('data');
    advance('output');
    if (!response.htmlPath || path.dirname(response.htmlPath) !== temporaryRoot) {
      throw new Error('SETUP_OUTPUT_FAILED');
    }
    const html = await fs.readFile(response.htmlPath, 'utf8');
    const tables = descendants(parseHtmlDocument(html), 'table');
    const statisticalTable = tables.some((table) => {
      const text = htmlText(table);
      return !/\bNotes\b|Output Created|Processor Time|创建的输出|处理器时间/iu.test(text)
        && /ssx_age|SPSS Studio/iu.test(text)
        && descendants(table, 'td').some((cell) => /^30(?:[.,]0+)?$/u.test(htmlText(cell).trim()));
    });
    if (!statisticalTable) {
      throw new Error('SETUP_OUTPUT_FAILED');
    }
    result.passed.push('output');
    advance('shutdown');
    await manager.stop(true);
    signal.throwIfAborted();
    result.passed.push('shutdown');
    result.ok = true;
  } catch (error) {
    result.error = signal.aborted ? 'SETUP_CANCELLED' : error instanceof Error ? error.message : String(error);
    result.stage = stage;
  } finally {
    signal.removeEventListener('abort', abort);
    await manager.stop();
    if (temporaryRoot) {
      await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  if (signal.aborted) { result.ok = false; result.error = 'SETUP_CANCELLED'; }
  return result;
}
