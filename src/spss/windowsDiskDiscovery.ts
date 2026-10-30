import { execFile } from 'node:child_process';
import path from 'node:path';
import type { WindowsRuntimeDiscovery } from './platform/windows';
import type { SpssInstallation } from './platform/types';

export function parseWindowsScanOutput(stdout: string, partial = false): WindowsRuntimeDiscovery {
  const result: WindowsRuntimeDiscovery = { installations: [], issues: [], truncated: partial };
  const lines = stdout.split(/\r?\n/u).filter(Boolean);
  if (lines.length > 600) { result.truncated = true; }
  for (const line of lines.slice(0, 600)) {
    let record: unknown;
    try { record = JSON.parse(line); } catch { result.truncated = true; continue; }
    if (typeof record !== 'object' || record === null || !('type' in record)) { result.truncated = true; continue; }
    if (record.type === 'partial') { result.truncated = true; continue; }
    if (!('value' in record) || typeof record.value !== 'object' || record.value === null) { result.truncated = true; continue; }
    const value = record.value;
    if (!('installRoot' in value) || typeof value.installRoot !== 'string' || !path.win32.isAbsolute(value.installRoot)) { result.truncated = true; continue; }
    const launcher = 'pythonLauncher' in value ? value.pythonLauncher : undefined;
    const executable = 'statsExecutable' in value ? value.statsExecutable : undefined;
    if (record.type === 'installation' && typeof launcher === 'string'
      && [path.win32.join(value.installRoot, 'statisticspython3.bat'), path.win32.join(value.installRoot, 'bin', 'statisticspython3.bat')]
        .some((candidate) => candidate.toLowerCase() === launcher.toLowerCase())
      && typeof executable === 'string'
      && [path.win32.join(value.installRoot, 'stats.exe'), path.win32.join(value.installRoot, 'bin', 'stats.exe')]
        .some((candidate) => candidate.toLowerCase() === executable.toLowerCase())) {
      // Reconstruct only host-approved fields; never accept worker environment overrides.
      const installation: SpssInstallation = { installRoot: value.installRoot, pythonLauncher: launcher,
        statsExecutable: executable, launchMode: 'ibm-launcher', environment: { SPSS_HOME: value.installRoot },
        ...('version' in value && typeof value.version === 'string' ? { version: value.version } : {}) };
      result.installations.push(installation);
    } else if (record.type === 'issue' && 'missing' in value && (value.missing === 'launcher' || value.missing === 'executable')) {
      result.issues.push({ installRoot: value.installRoot, missing: value.missing });
    } else { result.truncated = true; }
  }
  return result;
}

export async function windowsDiskDiscovery(signal?: AbortSignal, options: { workerPath?: string; timeoutMs?: number; roots?: readonly string[] } = {}): Promise<WindowsRuntimeDiscovery> {
  signal?.throwIfAborted();
  const roots: string[] = [];
  let characters = 2;
  for (const root of options.roots ?? []) {
    characters += JSON.stringify(root).length + 1;
    if (roots.length >= 600 || characters > 12_000) { break; }
    roots.push(root);
  }
  // Incremental JSONL survives a timeout: results already found on D/E are retained.
  const result = await new Promise<{ stdout: string; partial: boolean }>((resolve) => {
    execFile(process.execPath, [options.workerPath ?? path.join(__dirname, 'windowsScanWorker.js')], {
      windowsHide: true, shell: false, timeout: options.timeoutMs ?? 8_000, maxBuffer: 256_000, encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
        SPSS_STUDIO_DISCOVERY_ROOTS: options.roots ? JSON.stringify(roots) : '' }, ...(signal ? { signal } : {}),
    }, (error, stdout) => resolve({ stdout, partial: error !== null }));
  });
  signal?.throwIfAborted();
  return parseWindowsScanOutput(result.stdout, result.partial || (options.roots !== undefined && roots.length < options.roots.length));
}
