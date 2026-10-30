import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { hasWindowsArmHint, windowsChildEnvironment, windowsSystemRoot, windowsTool } from '../../src/spss/windowsEnvironment';
import { inspectWindowsCandidates, scanWindowsDrives, type WindowsScanRecord } from '../../src/spss/windowsScanWorker';
import { parseWindowsScanOutput, windowsDiskDiscovery } from '../../src/spss/windowsDiskDiscovery';
import type { FileSystemAdapter } from '../../src/spss/platform/types';
import { setupAdvice, setupStrings } from '../../src/setup/setupStrings';

function fixture(files: string[]): FileSystemAdapter {
  const key = (value: string): string => path.win32.normalize(value).toLowerCase();
  const paths = new Map(files.map((file) => [key(file), file]));
  const directories = new Map<string, string>();
  for (const file of files) {
    let directory = path.win32.dirname(file);
    while (!directories.has(key(directory))) {
      directories.set(key(directory), directory);
      if (directory === path.win32.dirname(directory)) { break; }
      directory = path.win32.dirname(directory);
    }
  }
  return {
    exists: (value) => paths.has(key(value)) || directories.has(key(value)),
    isFile: (value) => paths.has(key(value)),
    isDirectory: (value) => directories.has(key(value)),
    readText: () => undefined,
    readDirectory: (root) => [
      ...[...directories.values()].filter((value) => key(value) !== key(root) && key(path.win32.dirname(value)) === key(root))
        .map((value) => ({ name: path.win32.basename(value), isDirectory: true, isFile: false })),
      ...files.filter((value) => key(path.win32.dirname(value)) === key(root))
        .map((value) => ({ name: path.win32.basename(value), isDirectory: false, isFile: true })),
    ],
  };
}

describe('Windows portability', () => {
  it('terminates a blocked scan worker while retaining earlier discoveries', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spss-disk-test-'));
    const worker = path.join(directory, 'blocked.cjs');
    const record = { type: 'installation', value: { installRoot: 'D:\\SPSS', pythonLauncher: 'D:\\SPSS\\statisticspython3.bat', statsExecutable: 'D:\\SPSS\\stats.exe' } };
    fs.writeFileSync(worker, `process.stdout.write(${JSON.stringify(JSON.stringify(record) + '\n')}); while (true) { /* simulate an offline disk */ }`);
    try {
      const result = await windowsDiskDiscovery(undefined, { workerPath: worker, timeoutMs: 500 });
      assert.equal(result.installations[0]?.installRoot, 'D:\\SPSS');
      assert.equal(result.truncated, true);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('finds D/E/F/Z installations without PowerShell, WMI, registry, or C drive', () => {
    const roots = ['D:\\SPSS27 Win64', 'E:\\教学软件\\IBM\\SPSS\\Statistics\\26',
      'F:\\Program Files\\IBM\\SPSS Statistics\\31', 'Z:\\Apps\\Statistics\\29'];
    const fs = fixture(roots.flatMap((root) => [`${root}\\statisticspython3.bat`, `${root}\\stats.exe`]));
    const records: WindowsScanRecord[] = [];
    scanWindowsDrives(fs, { windir: 'E:\\Windows' }, (record) => records.push(record));
    const found = parseWindowsScanOutput(records.map((record) => JSON.stringify(record)).join('\n'));
    assert.deepEqual(found.installations.map((item) => item.installRoot).sort(), roots.sort());
    for (const item of found.installations) { assert.equal(item.environment.SPSS_HOME, item.installRoot); }
  });

  it('retains completed disk results when later drive scanning times out or is cancelled', () => {
    const records: WindowsScanRecord[] = [];
    scanWindowsDrives(fixture(['D:\\SPSS26\\stats.exe', 'D:\\SPSS26\\statisticspython3.bat']), {}, (record) => records.push(record));
    const found = parseWindowsScanOutput(records.map((record) => JSON.stringify(record)).join('\n') + '\n{"partial', true);
    assert.equal(found.installations[0]?.installRoot, 'D:\\SPSS26');
    assert.equal(found.truncated, true);
    assert.equal(parseWindowsScanOutput(Array.from({ length: 601 }, () => JSON.stringify({ type: 'issue', value: { installRoot: 'D:\\SPSS', missing: 'launcher' } })).join('\n')).truncated, true);
  });

  it('inspects manual and registry candidates through the same bounded worker protocol', () => {
    const records: WindowsScanRecord[] = [];
    inspectWindowsCandidates(fixture(['E:\\软件\\IBM\\SPSS26\\bin\\stats.exe', 'E:\\软件\\IBM\\SPSS26\\bin\\statisticspython3.bat']), ['  "E:\\软件"  ', ' E:\\软件\\IBM\\SPSS26\\bin '], (record) => records.push(record));
    const found = parseWindowsScanOutput(records.map((record) => JSON.stringify(record)).join('\n'));
    assert.equal(found.installations.length, 1);
    assert.equal(found.installations[0]?.installRoot, 'E:\\软件\\IBM\\SPSS26');
  });

  it('rejects foreign launchers and reconstructs a clean worker environment', () => {
    const value = { installRoot: 'D:\\SPSS', pythonLauncher: 'D:\\SPSS\\statisticspython3.bat', statsExecutable: 'D:\\SPSS\\stats.exe', environment: { PYTHONHOME: 'C:\\private' } };
    const found = parseWindowsScanOutput(JSON.stringify({ type: 'installation', value }));
    assert.deepEqual(found.installations[0]?.environment, { SPSS_HOME: 'D:\\SPSS' });
    const rejected = parseWindowsScanOutput(JSON.stringify({ type: 'installation', value: { ...value, pythonLauncher: 'C:\\Other\\statisticspython3.bat' } }));
    assert.equal(rejected.installations.length, 0);
    assert.equal(rejected.truncated, true);
  });

  it('uses WINDIR or ComSpec on non-C Windows and never needs PATH', () => {
    assert.equal(windowsSystemRoot({ windir: 'E:\\Windows' }), 'E:\\Windows');
    assert.equal(windowsSystemRoot({ COMSPEC: 'F:\\WinNT\\System32\\cmd.exe' }), 'F:\\WinNT');
    assert.equal(windowsTool('cmd.exe', { windir: 'E:\\Windows', ComSpec: 'C:\\removed\\cmd.exe' }, (name) => name === 'E:\\Windows\\System32\\cmd.exe'), 'E:\\Windows\\System32\\cmd.exe');
    assert.equal(windowsTool('reg.exe', { systemroot: 'D:\\Windows' }, () => false), 'D:\\Windows\\System32\\reg.exe');
    assert.equal(windowsTool('reg.exe', { SystemRoot: 'C:\\removed', WINDIR: 'E:\\Windows' }, (name) => name === 'E:\\Windows\\System32\\reg.exe'), 'E:\\Windows\\System32\\reg.exe');
    assert.equal(windowsTool('powershell.exe', { WINDIR: 'E:\\Windows' }, () => false), 'E:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('supports native tools from an x86 VS Code process and detects ARM hints under x64 emulation', () => {
    assert.equal(windowsTool('reg.exe', { WINDIR: 'E:\\Windows', PROCESSOR_ARCHITEW6432: 'AMD64' }, () => false, 'ia32'), 'E:\\Windows\\Sysnative\\reg.exe');
    const host = { osVersion: 'Windows', osRelease: '10.0', processArchitecture: 'x64', machine: 'x86_64', processorArchitecture: 'AMD64', nativeArchitectureHint: 'ARM64' };
    assert.equal(hasWindowsArmHint(host), true);
    assert.equal(hasWindowsArmHint({ ...host, nativeArchitectureHint: '' }), false);
    assert.match(setupAdvice('EACCES access is denied', 'zh-cn'), /权限/u);
    assert.equal(setupAdvice('%1 is not a valid Win32 application', 'en'), setupStrings('en').architecture);
  });

  it('repairs the child environment without changing global Windows settings or inherited data', () => {
    const original = { windir: 'E:\\Windows', Path: 'D:\\Tools', custom: 'kept' };
    const child = windowsChildEnvironment(original);
    assert.ok(child.PATH?.startsWith('E:\\Windows\\System32;'));
    assert.ok(child.PATH?.endsWith(';D:\\Tools'));
    assert.equal(child.ComSpec, 'E:\\Windows\\System32\\cmd.exe');
    assert.equal(child.custom, 'kept');
    assert.deepEqual(original, { windir: 'E:\\Windows', Path: 'D:\\Tools', custom: 'kept' });
    assert.equal(Object.keys(child).filter((key) => key.toLowerCase() === 'path').length, 1);
  });
});
