import path from 'node:path';
import { NodeFileSystem } from './spssLocator';
import { inspectWindowsRoots } from './platform/windows';
import type { WindowsInstallationIssue } from './platform/windows';
import type { FileSystemAdapter, SpssInstallation } from './platform/types';
import { windowsSystemRoot } from './windowsEnvironment';

export type WindowsScanRecord = { type: 'installation'; value: SpssInstallation }
  | { type: 'issue'; value: WindowsInstallationIssue } | { type: 'partial' };

export function inspectWindowsCandidates(fs: FileSystemAdapter, roots: readonly string[], emit: (record: WindowsScanRecord) => void): void {
  if (roots.length > 600) { emit({ type: 'partial' }); }
  const emitted = new Set<string>();
  for (const candidate of roots.slice(0, 600)) {
    const root = candidate.trim().replace(/^"(.*)"$/u, '$1');
    if (!path.win32.isAbsolute(root)) { continue; }
    const found = inspectWindowsRoots(fs, [root]);
    for (const installation of found.installations) {
      const key = installation.pythonLauncher.toLowerCase();
      if (!emitted.has(key)) { emitted.add(key); emit({ type: 'installation', value: installation }); }
    }
    for (const issue of found.issues) { emit({ type: 'issue', value: issue }); }
    if (found.truncated) { emit({ type: 'partial' }); }
  }
}

/** Runs outside the extension host so an offline mapped drive cannot freeze it. */
export function scanWindowsDrives(
  fs: FileSystemAdapter,
  environment: NodeJS.ProcessEnv,
  emit: (record: WindowsScanRecord) => void,
): void {
  const systemDrive = path.win32.parse(windowsSystemRoot(environment)).root;
  const drives = [...new Set([systemDrive, ...'DEFGHIJKLMNOPQRSTUVWXYZCAB'.split('').map((letter) => `${letter}:\\`)])];
  const emitted = new Set<string>();
  for (const drive of drives) {
    if (!fs.isDirectory(drive)) { continue; }
    const roots = [drive, ...['IBM', 'SPSS', 'Program Files\\IBM', 'Program Files (x86)\\IBM', 'Program Files\\IBM SPSS Statistics']
      .map((folder) => path.win32.join(drive, folder))];
    const entries = fs.readDirectory(drive);
    if (entries.length > 200) { emit({ type: 'partial' }); }
    for (const entry of entries.slice(0, 200)) {
      if (entry.isDirectory && /SPSS|Statistics|IBM|^(?:Apps?|Programs?|Program Files(?: \(x86\))?|Tools?|Software|Softwares|软件|应用|教学软件|科研软件)$/iu.test(entry.name)) {
        roots.push(path.win32.join(drive, entry.name));
      }
    }
    const found = inspectWindowsRoots(fs, roots);
    for (const installation of found.installations) {
      const key = installation.pythonLauncher.toLowerCase();
      if (!emitted.has(key)) { emitted.add(key); emit({ type: 'installation', value: installation }); }
    }
    for (const issue of found.issues) { emit({ type: 'issue', value: issue }); }
    if (found.truncated) { emit({ type: 'partial' }); }
  }
}

if (require.main === module) {
  const emit = (record: WindowsScanRecord): void => { process.stdout.write(`${JSON.stringify(record)}\n`); };
  const data = process.env.SPSS_STUDIO_DISCOVERY_ROOTS;
  if (data) {
    const roots: unknown = JSON.parse(data);
    if (!Array.isArray(roots) || !roots.every((item): item is string => typeof item === 'string')) { throw new Error('Invalid discovery roots'); }
    inspectWindowsCandidates(new NodeFileSystem(), roots, emit);
  } else { scanWindowsDrives(new NodeFileSystem(), process.env, emit); }
}
