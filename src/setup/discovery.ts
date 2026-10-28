import path from 'node:path';
import { NodeFileSystem, locateSpss, WindowsRegistry } from '../spss/spssLocator';
import { discoverWindowsInstallations } from '../spss/platform/windows';
import type { LocatorOptions, SpssInstallation } from '../spss/platform/types';
import { windowsDiscoveryRoots, windowsProductVersions } from '../spss/windowsSystemInfo';

export interface DiscoveryResult {
  installations: SpssInstallation[];
  warnings: string[];
}

export async function discoverRuntime(options: LocatorOptions, manualRoot?: string, signal?: AbortSignal): Promise<DiscoveryResult> {
  signal?.throwIfAborted();
  if (process.platform !== 'win32') {
    const found = await locateSpss({ options: manualRoot ? { explicitInstallPath: manualRoot } : options });
    return { installations: found ? [found] : [], warnings: [] };
  }
  if (manualRoot) {
    const found = await locateSpss({ options: { explicitInstallPath: manualRoot } });
    if (found?.statsExecutable) {
      try {
        const versions = await windowsProductVersions([found.statsExecutable], signal);
        const version = versions[found.statsExecutable];
        if (version) { found.version = version; }
      } catch { /* Version metadata is optional; actual execution remains decisive. */ }
    }
    return { installations: found ? [found] : [], warnings: [] };
  }
  const fs = new NodeFileSystem();
  const warnings: string[] = [];
  const roots: string[] = [];
  if (manualRoot) { roots.push(manualRoot); }
  try { roots.push(...await windowsDiscoveryRoots(signal)); }
  catch { warnings.push('WINDOWS_DISCOVERY_PARTIAL'); }
  // Expand only known candidate trees: never recursively scan whole drives.
  const expanded = new Set(roots);
  let frontier = roots;
  for (let depth = 0; depth < 3; depth += 1) {
    signal?.throwIfAborted();
    const next: string[] = [];
    for (const root of frontier.slice(0, 200)) {
      for (const entry of fs.readDirectory(root).slice(0, 100)) {
        if (entry.isDirectory && /SPSS|Statistics|IBM|^\d{2}(?:\.\d+)*$/iu.test(entry.name)) {
          const child = path.win32.join(root, entry.name);
          if (!expanded.has(child)) { expanded.add(child); next.push(child); }
        }
      }
    }
    frontier = next;
  }
  const installations = await discoverWindowsInstallations(
    manualRoot ? { explicitInstallPath: manualRoot } : options,
    fs, new WindowsRegistry(signal), process.env, [...expanded],
  );
  try {
    const versions = await windowsProductVersions(installations.flatMap((item) => item.statsExecutable ? [item.statsExecutable] : []), signal);
    for (const item of installations) {
      const version = item.statsExecutable ? versions[item.statsExecutable] : undefined;
      if (version) { item.version = version; }
    }
  } catch { warnings.push('WINDOWS_VERSION_UNKNOWN'); }
  return { installations, warnings };
}
