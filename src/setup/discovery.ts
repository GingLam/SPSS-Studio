import { locateSpss, WindowsRegistry } from '../spss/spssLocator';
import { windowsCandidateRoots, type WindowsInstallationIssue } from '../spss/platform/windows';
import type { LocatorOptions, SpssInstallation } from '../spss/platform/types';
import { windowsDiscoveryRoots, windowsProductVersions } from '../spss/windowsSystemInfo';
import { windowsDiskDiscovery } from '../spss/windowsDiskDiscovery';

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
  const warnings: string[] = [];
  const roots: string[] = [];
  let disk: Awaited<ReturnType<typeof windowsDiskDiscovery>> | undefined;
  if (!manualRoot) {
    const hints = await Promise.allSettled([windowsDiscoveryRoots(signal), windowsDiskDiscovery(signal),
      windowsCandidateRoots(options, new WindowsRegistry(signal), process.env)]);
    if (hints[0].status === 'fulfilled') { roots.push(...hints[0].value); }
    else { warnings.push('WINDOWS_POWERSHELL_UNAVAILABLE'); }
    if (hints[1].status === 'fulfilled') { disk = hints[1].value; }
    else { warnings.push('WINDOWS_DISCOVERY_PARTIAL'); }
    if (hints[2].status === 'fulfilled') {
      roots.push(...hints[2].value.roots);
      if (hints[2].value.registryUnavailable) { warnings.push('WINDOWS_REGISTRY_UNAVAILABLE'); }
    } else { warnings.push('WINDOWS_REGISTRY_UNAVAILABLE'); }
  }
  signal?.throwIfAborted();
  // All candidate-directory I/O, including manual/obsolete paths, is bounded too.
  const found = await windowsDiskDiscovery(signal, { roots: manualRoot ? [manualRoot] : roots });
  const { installations, issues } = found;
  for (const item of disk?.installations ?? []) {
    if (!installations.some((existing) => existing.pythonLauncher.toLowerCase() === item.pythonLauncher.toLowerCase())) { installations.push(item); }
  }
  for (const issue of disk?.issues ?? []) {
    if (!issues.some((existing) => existing.installRoot.toLowerCase() === issue.installRoot.toLowerCase())) { issues.push(issue); }
  }
  // A partial scan must not claim that a complete installation is missing components.
  const incomplete = issues.filter((issue) => !installations.some((item) => item.installRoot.toLowerCase() === issue.installRoot.toLowerCase()));
  if (disk?.truncated) { warnings.push('WINDOWS_DISCOVERY_PARTIAL'); }
  if (found.truncated) { warnings.push('WINDOWS_DISCOVERY_PARTIAL'); }
  try {
    if (!installations.length) { return { installations, warnings: [...new Set(warnings)], issues: incomplete }; }
    const versions = await windowsProductVersions(installations.flatMap((item) => item.statsExecutable ? [item.statsExecutable] : []), signal);
    for (const item of installations) {
      const version = item.statsExecutable ? versions[item.statsExecutable] : undefined;
      if (version) { item.version = version; }
    }
  } catch { warnings.push('WINDOWS_VERSION_UNKNOWN'); }
  return { installations, warnings: [...new Set(warnings)], issues: incomplete };
}
