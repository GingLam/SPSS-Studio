import path from 'node:path';
import type { FileSystemAdapter, LocatorOptions, RegistryProvider, SpssInstallation } from './types';

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = path.win32.normalize(value).toLowerCase();
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
  const normalized = path.win32.normalize(launcher);
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
  const root = path.win32.normalize(installRoot);
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

  const registryRoots = await registry.getInstallRoots();
  const programFiles = uniqueCaseInsensitive(
    [environment.ProgramFiles, environment.ProgramW6432, environment['ProgramFiles(x86)']]
      .filter((value): value is string => Boolean(value)),
  );
  const commonRoots = programFiles.flatMap((root) => [
    path.win32.join(root, 'IBM', 'SPSS Statistics'),
    path.win32.join(root, 'IBM', 'SPSS', 'Statistics'),
    path.win32.join(root, 'IBM SPSS Statistics'),
  ]);
  const candidates = uniqueCaseInsensitive([
    ...registryRoots,
    ...commonRoots.flatMap((root) => findVersionedChildren(fs, root)),
  ]);
  const installations = candidates
    .map((candidate) => installationFromRoot(fs, candidate))
    .filter((installation): installation is SpssInstallation => installation !== undefined)
    .sort((left, right) => numericVersion(right) - numericVersion(left));
  return installations[0];
}
