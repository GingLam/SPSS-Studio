import { NodeFileSystem, locateSpss, WindowsRegistry } from '../spss/spssLocator';
import { discoverWindowsRuntime, inspectWindowsRoots, type WindowsInstallationIssue } from '../spss/platform/windows';
import type { LocatorOptions, SpssInstallation } from '../spss/platform/types';
import { windowsDiscoveryRoots, windowsProductVersions } from '../spss/windowsSystemInfo';

export interface DiscoveryResult {
  installations: SpssInstallation[];
  warnings: string[];
  issues?: WindowsInstallationIssue[];
}

export async function discoverRuntime(options: LocatorOptions, manualRoot?: string, signal?: AbortSignal): Promise<DiscoveryResult> {
  signal?.throwIfAborted();
  if (process.platform !== 'win32') {
    const found = await locateSpss({ options: manualRoot ? { explicitInstallPath: manualRoot } : options });
    return { installations: found ? [found] : [], warnings: [] };
  }
  const fs = new NodeFileSystem();
  const warnings: string[] = [];
  const roots: string[] = [];
  if (!manualRoot) {
    try { roots.push(...await windowsDiscoveryRoots(signal)); }
    catch { warnings.push('WINDOWS_DISCOVERY_PARTIAL'); }
  }
  signal?.throwIfAborted();
  const found = manualRoot ? inspectWindowsRoots(fs, [manualRoot])
    : await discoverWindowsRuntime(options, fs, new WindowsRegistry(signal), process.env, roots);
  const { installations, issues } = found;
  if (found.truncated || found.registryUnavailable) { warnings.push('WINDOWS_DISCOVERY_PARTIAL'); }
  try {
    const versions = await windowsProductVersions(installations.flatMap((item) => item.statsExecutable ? [item.statsExecutable] : []), signal);
    for (const item of installations) {
      const version = item.statsExecutable ? versions[item.statsExecutable] : undefined;
      if (version) { item.version = version; }
    }
  } catch { warnings.push('WINDOWS_VERSION_UNKNOWN'); }
  return { installations, warnings: [...new Set(warnings)], issues };
}
