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

function findSitePackages(fs: FileSystemAdapter, pythonHome: string): string | undefined {
  const lib = path.win32.join(pythonHome, 'Lib');
  const direct = path.win32.join(lib, 'site-packages');
  if (fs.isDirectory(direct)) {
    return direct;
  }
  return fs
    .readDirectory(lib)
    .filter((entry) => entry.isDirectory && /^python\d+(?:\.\d+)+$/iu.test(entry.name))
    .map((entry) => path.win32.join(lib, entry.name, 'site-packages'))
    .find((candidate) => fs.isDirectory(candidate));
}

function installationFromRoot(
  fs: FileSystemAdapter,
  installRoot: string,
  explicitLauncher?: string,
): SpssInstallation | undefined {
  const root = path.win32.normalize(installRoot);
  const launchers = [
    explicitLauncher,
    path.win32.join(root, 'statisticspython3.bat'),
    path.win32.join(root, 'bin', 'statisticspython3.bat'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const launcher = launchers.find((candidate) => fs.isFile(candidate));
  const pythonHomeCandidates = [
    path.win32.join(root, 'Python3'),
    path.win32.join(root, 'Resources', 'Python3'),
  ];
  const pythonHome = pythonHomeCandidates.find((candidate) => fs.isDirectory(candidate));
  const directPython = pythonHome ? path.win32.join(pythonHome, 'python.exe') : undefined;
  const pythonLauncher = launcher ?? (directPython && fs.isFile(directPython) ? directPython : undefined);
  if (!pythonLauncher) {
    return undefined;
  }

  const statsCandidates = [path.win32.join(root, 'stats.exe'), path.win32.join(root, 'bin', 'stats.exe')];
  const statsExecutable = statsCandidates.find((candidate) => fs.isFile(candidate));
  const version = versionFromPath(root);
  const environment: Record<string, string> = { SPSS_HOME: root };
  const launchMode = launcher ? 'ibm-launcher' : 'direct-python';
  if (launchMode === 'direct-python' && pythonHome) {
    environment.PYTHONHOME = pythonHome;
    const sitePackages = findSitePackages(fs, pythonHome);
    if (sitePackages) {
      environment.PYTHONPATH = sitePackages;
    }
  }
  return {
    ...(version ? { version } : {}),
    installRoot: root,
    ...(statsExecutable ? { statsExecutable } : {}),
    pythonLauncher,
    ...(pythonHome ? { pythonHome } : {}),
    launchMode,
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
    .map((candidate) => installationFromRoot(fs, candidate, options.explicitPythonLauncherPath))
    .filter((installation): installation is SpssInstallation => installation !== undefined)
    .sort((left, right) => numericVersion(right) - numericVersion(left));
  return installations[0];
}
