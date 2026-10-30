import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function windowsEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(environment).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? environment[key] : undefined;
}

function absolute(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/^"(.*)"$/u, '$1');
  return clean && path.win32.isAbsolute(clean) && !/[\r\n\0]/u.test(clean) ? path.win32.normalize(clean) : undefined;
}

export function windowsSystemRoot(environment: NodeJS.ProcessEnv): string {
  const configured = absolute(windowsEnvironmentValue(environment, 'SystemRoot'))
    ?? absolute(windowsEnvironmentValue(environment, 'WINDIR'));
  if (configured) { return configured; }
  const interpreter = absolute(windowsEnvironmentValue(environment, 'ComSpec'));
  if (interpreter && /^(?:System32|SysWOW64|Sysnative)$/iu.test(path.win32.basename(path.win32.dirname(interpreter)))) {
    return path.win32.dirname(path.win32.dirname(interpreter));
  }
  const drive = windowsEnvironmentValue(environment, 'SystemDrive');
  return drive && /^[A-Za-z]:$/u.test(drive) ? `${drive}\\Windows` : 'C:\\Windows';
}

/** Prefer system-owned tools and keep missing PATH/ComSpec from blocking setup. */
export function windowsTool(
  name: 'cmd.exe' | 'reg.exe' | 'taskkill.exe' | 'powershell.exe',
  environment: NodeJS.ProcessEnv = process.env,
  isFile: (value: string) => boolean = fs.existsSync,
  processArchitecture = process.arch,
): string {
  const root = windowsSystemRoot(environment);
  const folder = name === 'powershell.exe' ? 'WindowsPowerShell\\v1.0' : '';
  const directories = processArchitecture === 'ia32' && windowsEnvironmentValue(environment, 'PROCESSOR_ARCHITEW6432')
    ? ['Sysnative', 'System32'] : ['System32'];
  const interpreter = absolute(windowsEnvironmentValue(environment, 'ComSpec'));
  const roots = [...new Set([root, absolute(windowsEnvironmentValue(environment, 'WINDIR')),
    interpreter ? path.win32.dirname(path.win32.dirname(interpreter)) : undefined].filter((value): value is string => Boolean(value)))];
  const candidates = roots.flatMap((candidate) => directories.map((directory) => path.win32.join(candidate, directory, folder, name)));
  if (name === 'cmd.exe' && interpreter && path.win32.basename(interpreter).toLowerCase() === name) { candidates.push(interpreter); }
  return candidates.find(isFile) ?? path.win32.join(root, directories[0] ?? 'System32', folder, name);
}

/** Repair only the launched child's standard Windows environment. */
export function windowsChildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const interpreter = windowsTool('cmd.exe', environment);
  const parent = path.win32.dirname(interpreter);
  const root = /^(?:System32|SysWOW64|Sysnative)$/iu.test(path.win32.basename(parent))
    ? path.win32.dirname(parent) : windowsSystemRoot(environment);
  const inheritedPath = windowsEnvironmentValue(environment, 'PATH') ?? '';
  const seen = new Set<string>();
  const entries = [path.win32.join(root, 'System32'), root, path.win32.join(root, 'System32', 'Wbem'),
    path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0'), ...inheritedPath.split(';')]
    .filter((entry) => {
      const key = entry.trim().toLowerCase();
      if (!key || seen.has(key)) { return false; }
      seen.add(key); return true;
    });
  return { ...Object.fromEntries(Object.entries(environment).filter(([key]) => !['path', 'comspec', 'systemroot', 'windir'].includes(key.toLowerCase()))),
    SystemRoot: root, WINDIR: root, ComSpec: interpreter, PATH: entries.join(';') };
}

export interface SetupHostInfo {
  osVersion: string;
  osRelease: string;
  processArchitecture: string;
  machine: string;
  processorArchitecture: string;
  nativeArchitectureHint: string;
}

export function setupHostInfo(environment: NodeJS.ProcessEnv = process.env): SetupHostInfo {
  return { osVersion: os.version(), osRelease: os.release(), processArchitecture: process.arch,
    machine: os.machine(), processorArchitecture: windowsEnvironmentValue(environment, 'PROCESSOR_ARCHITECTURE') ?? '',
    nativeArchitectureHint: windowsEnvironmentValue(environment, 'PROCESSOR_ARCHITEW6432') ?? '' };
}

export function hasWindowsArmHint(info: SetupHostInfo): boolean {
  return [info.machine, info.processorArchitecture, info.nativeArchitectureHint].some((value) => /^(?:arm64|aarch64)$/iu.test(value));
}
