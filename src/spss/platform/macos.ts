import path from 'node:path';
import type { FileSystemAdapter, LocatorOptions, SpssInstallation } from './types';

const APP_NAME = 'SPSS Statistics.app';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function versionFromPath(candidate: string): string | undefined {
  const matches = [...candidate.matchAll(/(?:Statistics|SPSS)[^0-9]*(\d{2,})(?:\.\d+)*/giu)];
  return matches.at(-1)?.[1];
}

function readBundleVersion(fs: FileSystemAdapter, appPath: string): string | undefined {
  const plist = fs.readText(path.posix.join(appPath, 'Contents', 'Info.plist'));
  if (!plist) {
    return undefined;
  }
  return plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/u)?.[1];
}

function findPythonHome(fs: FileSystemAdapter, installRoot: string, appPath: string): string | undefined {
  const candidates = [
    path.posix.join(installRoot, 'Resources', 'Python3'),
    path.posix.join(appPath, 'Contents', 'Resources', 'Python3'),
    path.posix.join(appPath, 'Contents', 'Python3'),
  ];
  return candidates.find((candidate) => fs.isDirectory(candidate));
}

function findDirectPython(fs: FileSystemAdapter, pythonHome: string | undefined): string | undefined {
  if (!pythonHome) {
    return undefined;
  }
  const binDirectory = path.posix.join(pythonHome, 'bin');
  const preferred = path.posix.join(binDirectory, 'python3');
  if (fs.isFile(preferred)) {
    return preferred;
  }
  return fs
    .readDirectory(binDirectory)
    .filter((entry) => entry.isFile && /^python3(?:\.\d+)*$/u.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
    .map((entry) => path.posix.join(binDirectory, entry.name))[0];
}

function findSitePackages(fs: FileSystemAdapter, pythonHome: string | undefined): string | undefined {
  if (!pythonHome) {
    return undefined;
  }
  const libDirectory = path.posix.join(pythonHome, 'lib');
  for (const entry of fs
    .readDirectory(libDirectory)
    .filter((candidate) => candidate.isDirectory && /^python\d+(?:\.\d+)+$/u.test(candidate.name))
    .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))) {
    const sitePackages = path.posix.join(libDirectory, entry.name, 'site-packages');
    if (fs.isDirectory(sitePackages)) {
      return sitePackages;
    }
  }
  return undefined;
}

function normalizeRoot(candidate: string): { installRoot: string; appPath: string } {
  const normalized = path.posix.normalize(candidate);
  if (normalized.endsWith('/Contents')) {
    const appPath = path.posix.dirname(normalized);
    return { installRoot: path.posix.dirname(appPath), appPath };
  }
  if (normalized.endsWith('.app')) {
    return { installRoot: path.posix.dirname(normalized), appPath: normalized };
  }
  return { installRoot: normalized, appPath: path.posix.join(normalized, APP_NAME) };
}

function installationFromRoot(
  fs: FileSystemAdapter,
  candidate: string,
  explicitLauncher?: string,
): SpssInstallation | undefined {
  const { installRoot, appPath } = normalizeRoot(candidate);
  if (!fs.isDirectory(appPath)) {
    return undefined;
  }
  const contents = path.posix.join(appPath, 'Contents');
  const statsExecutable = path.posix.join(contents, 'MacOS', 'stats');
  const defaultLauncher = path.posix.join(contents, 'bin', 'statisticspython3');
  const launcher = explicitLauncher && fs.isFile(explicitLauncher)
    ? explicitLauncher
    : (fs.isFile(defaultLauncher) ? defaultLauncher : undefined);
  const pythonHome = findPythonHome(fs, installRoot, appPath);
  const directPython = findDirectPython(fs, pythonHome);
  const pythonLauncher = launcher ?? directPython;
  if (!pythonLauncher) {
    return undefined;
  }

  const version = readBundleVersion(fs, appPath) ?? versionFromPath(candidate);
  const environment: Record<string, string> = { SPSSHOME: contents };
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
    installRoot,
    ...(fs.isFile(statsExecutable) ? { statsExecutable } : {}),
    pythonLauncher,
    ...(pythonHome ? { pythonHome } : {}),
    launchMode,
    environment,
  };
}

function numericVersion(installation: SpssInstallation): number {
  return Number.parseInt(installation.version ?? '0', 10) || 0;
}

export function locateMacOS(
  options: LocatorOptions,
  fs: FileSystemAdapter,
  applicationsRoot = '/Applications',
): SpssInstallation | undefined {
  if (options.explicitInstallPath) {
    return installationFromRoot(fs, options.explicitInstallPath, options.explicitPythonLauncherPath);
  }

  if (options.explicitPythonLauncherPath && fs.isFile(options.explicitPythonLauncherPath)) {
    const marker = '/Contents/bin/';
    const markerIndex = options.explicitPythonLauncherPath.indexOf(marker);
    if (markerIndex >= 0) {
      const appPath = options.explicitPythonLauncherPath.slice(0, markerIndex);
      const result = installationFromRoot(fs, appPath, options.explicitPythonLauncherPath);
      if (result) {
        return result;
      }
    }
  }

  const roots = [
    path.posix.join(applicationsRoot, 'IBM SPSS Statistics'),
    ...fs
      .readDirectory(applicationsRoot)
      .filter((entry) => entry.isDirectory && /^IBM SPSS Statistics(?:\s+\d+)?$/u.test(entry.name))
      .map((entry) => path.posix.join(applicationsRoot, entry.name)),
  ];
  const installations = unique(roots)
    .map((root) => installationFromRoot(fs, root))
    .filter((installation): installation is SpssInstallation => installation !== undefined)
    .sort((left, right) => numericVersion(right) - numericVersion(left));
  return installations[0];
}
