import path from 'node:path';
import type { FileSystemAdapter, LocatorOptions, RegistryProvider, SpssInstallation } from './types';

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = path.win32.normalize(value).replace(/[\\/]+$/u, '').toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function versionFromPath(candidate: string): string | undefined {
  const matches = [...candidate.matchAll(/(?:Statistics|SPSS)[^0-9]*(\d{2,})(?:\.\d+)*/giu)];
  return matches.at(-1)?.[1] ?? candidate.match(/(?:^|[\\/])(\d{2,})(?:\.\d+)*(?:$|[\\/])/u)?.[1];
}

function findVersionedChildren(fs: FileSystemAdapter, root: string): string[] {
  if (!fs.isDirectory(root)) {
    return [];
  }
  return [
    root,
    ...fs
      .readDirectory(root)
      .filter((entry) => entry.isDirectory && /\d{2,}/u.test(entry.name))
      .map((entry) => path.win32.join(root, entry.name)),
  ];
}

function normalizedLauncher(launcher: string): string | undefined {
  const normalized = path.win32.normalize(launcher.trim().replace(/^"(.*)"$/u, '$1'));
  return path.win32.isAbsolute(normalized)
    && path.win32.basename(normalized).toLowerCase() === 'statisticspython3.bat'
    ? normalized
    : undefined;
}

function rootFromLauncher(launcher: string): string | undefined {
  const normalized = normalizedLauncher(launcher);
  if (!normalized) {
    return undefined;
  }
  const parent = path.win32.dirname(normalized);
  return path.win32.basename(parent).toLowerCase() === 'bin'
    ? path.win32.dirname(parent)
    : parent;
}

function launcherBelongsToRoot(root: string, launcher: string): boolean {
  const normalizedLauncherPath = path.win32.normalize(launcher).toLowerCase();
  return [
    path.win32.join(root, 'statisticspython3.bat'),
    path.win32.join(root, 'bin', 'statisticspython3.bat'),
  ].some((candidate) => path.win32.normalize(candidate).toLowerCase() === normalizedLauncherPath);
}

function installationFromRoot(
  fs: FileSystemAdapter,
  installRoot: string,
  explicitLauncher?: string,
): SpssInstallation | undefined {
  let root = path.win32.normalize(installRoot.trim().replace(/^"(.*)"$/u, '$1'));
  if (!path.win32.isAbsolute(root)) { return undefined; }
  root = path.win32.resolve(root);
  // A shortcut/registry entry may point to bin; SPSS_HOME must name its parent.
  if (path.win32.basename(root).toLowerCase() === 'bin') { root = path.win32.dirname(root); }
  const configuredLauncher = explicitLauncher ? normalizedLauncher(explicitLauncher) : undefined;
  if (explicitLauncher && (!configuredLauncher || !launcherBelongsToRoot(root, configuredLauncher))) {
    return undefined;
  }
  const launchers = [
    configuredLauncher,
    path.win32.join(root, 'statisticspython3.bat'),
    path.win32.join(root, 'bin', 'statisticspython3.bat'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const launcher = launchers.find((candidate) => fs.isFile(candidate));
  if (!launcher) {
    return undefined;
  }

  const statsCandidates = [path.win32.join(root, 'stats.exe'), path.win32.join(root, 'bin', 'stats.exe')];
  const statsExecutable = statsCandidates.find((candidate) => fs.isFile(candidate));
  if (!statsExecutable) { return undefined; }
  const version = versionFromPath(root);
  const environment: Record<string, string> = { SPSS_HOME: root };
  return {
    ...(version ? { version } : {}),
    installRoot: root,
    ...(statsExecutable ? { statsExecutable } : {}),
    pythonLauncher: launcher,
    launchMode: 'ibm-launcher',
    environment,
  };
}

function numericVersion(installation: SpssInstallation): number {
  return Number.parseInt(installation.version ?? '0', 10) || 0;
}

export async function locateWindows(
  options: LocatorOptions,
  fs: FileSystemAdapter,
  registry: RegistryProvider,
  environment: NodeJS.ProcessEnv,
): Promise<SpssInstallation | undefined> {
  if (options.explicitInstallPath) {
    return installationFromRoot(fs, options.explicitInstallPath, options.explicitPythonLauncherPath);
  }
  if (options.explicitPythonLauncherPath) {
    const installRoot = rootFromLauncher(options.explicitPythonLauncherPath);
    return installRoot
      ? installationFromRoot(fs, installRoot, options.explicitPythonLauncherPath)
      : undefined;
  }

  return (await discoverWindowsInstallations(options, fs, registry, environment))[0];
}

export async function discoverWindowsInstallations(
  options: LocatorOptions,
  fs: FileSystemAdapter,
  registry: RegistryProvider,
  environment: NodeJS.ProcessEnv,
  additionalRoots: readonly string[] = [],
): Promise<SpssInstallation[]> {
  return (await discoverWindowsRuntime(options, fs, registry, environment, additionalRoots)).installations;
}

export interface WindowsInstallationIssue {
  installRoot: string;
  missing: 'launcher' | 'executable';
}

export interface WindowsRuntimeDiscovery {
  installations: SpssInstallation[];
  issues: WindowsInstallationIssue[];
  truncated: boolean;
  registryUnavailable?: boolean;
}

/** Inspect bounded SPSS-related trees, never an unrestricted recursive drive scan. */
export function inspectWindowsRoots(fs: FileSystemAdapter, roots: readonly string[]): WindowsRuntimeDiscovery {
  const candidates = new Map<string, string>();
  let frontier = uniqueCaseInsensitive([...roots]);
  let truncated = false;
  for (let depth = 0; depth <= 4 && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const candidate of frontier) {
      let root = candidate.trim().replace(/^"(.*)"$/u, '$1');
      if (!path.win32.isAbsolute(root)) { continue; }
      if (/^(?:stats\.exe|statisticspython3\.bat)$/iu.test(path.win32.basename(root))) { root = path.win32.dirname(root); }
      if (path.win32.basename(root).toLowerCase() === 'bin') { root = path.win32.dirname(root); }
      root = path.win32.normalize(root);
      const key = root.replace(/[\\/]+$/u, '').toLowerCase();
      if (candidates.has(key)) { continue; }
      if (candidates.size >= 600) { truncated = true; break; }
      candidates.set(key, root);
      if (depth < 4) {
        const entries = fs.readDirectory(root);
        if (entries.length > 200) { truncated = true; }
        for (const entry of entries.slice(0, 200)) {
          if (entry.isDirectory && /SPSS|Statistics|IBM|^\d{2}(?:\.\d+)*$/iu.test(entry.name)) {
            next.push(path.win32.join(root, entry.name));
          }
        }
      }
    }
    frontier = uniqueCaseInsensitive(next);
  }
  const installations: SpssInstallation[] = [];
  const issues: WindowsInstallationIssue[] = [];
  for (const root of candidates.values()) {
    const installation = installationFromRoot(fs, root);
    if (installation) { installations.push(installation); continue; }
    const hasStats = ['stats.exe', 'bin\\stats.exe'].some((name) => fs.isFile(path.win32.join(root, name)));
    const hasLauncher = ['statisticspython3.bat', 'bin\\statisticspython3.bat'].some((name) => fs.isFile(path.win32.join(root, name)));
    if (hasStats || hasLauncher) { issues.push({ installRoot: root, missing: hasStats ? 'launcher' : 'executable' }); }
  }
  return { installations: installations.sort((a, b) => numericVersion(b) - numericVersion(a)), issues, truncated };
}

export async function discoverWindowsRuntime(
  options: LocatorOptions,
  fs: FileSystemAdapter,
  registry: RegistryProvider,
  environment: NodeJS.ProcessEnv,
  additionalRoots: readonly string[] = [],
): Promise<WindowsRuntimeDiscovery> {
  const explicit = options.explicitInstallPath
    ? installationFromRoot(fs, options.explicitInstallPath, options.explicitPythonLauncherPath)
    : options.explicitPythonLauncherPath
      ? installationFromRoot(fs, rootFromLauncher(options.explicitPythonLauncherPath) ?? '', options.explicitPythonLauncherPath)
      : undefined;
  let registryRoots: string[] = [];
  let registryUnavailable = false;
  try { registryRoots = await registry.getInstallRoots(); }
  catch { registryUnavailable = true; }
  const programFiles = uniqueCaseInsensitive(
    [environment.ProgramFiles, environment.ProgramW6432, environment['ProgramFiles(x86)']]
      .filter((value): value is string => Boolean(value)),
  );
  const commonRoots = programFiles.flatMap((root) => [
    path.win32.join(root, 'IBM', 'SPSS Statistics'),
    path.win32.join(root, 'IBM', 'SPSS', 'Statistics'),
    path.win32.join(root, 'IBM SPSS Statistics'),
  ]);
  const expandEnvironment = (value: string): string => value.replace(/%([^%]+)%/gu, (literal, name: string) => {
    const key = Object.keys(environment).find((item) => item.toLowerCase() === name.toLowerCase());
    return key ? environment[key] ?? literal : literal;
  });
  const candidates = uniqueCaseInsensitive([
    options.explicitInstallPath ?? '',
    options.explicitPythonLauncherPath ?? '',
    environment.SPSS_HOME ?? environment.spss_home ?? '',
    ...registryRoots,
    ...additionalRoots,
    ...commonRoots.flatMap((root) => findVersionedChildren(fs, root)),
  ].filter(Boolean).map(expandEnvironment));
  const found = inspectWindowsRoots(fs, candidates);
  const installations = [
    ...(explicit ? [explicit] : []),
    ...found.installations.filter((item) => item.pythonLauncher.toLowerCase() !== explicit?.pythonLauncher.toLowerCase()),
  ];
  return { ...found, installations, registryUnavailable };
}
