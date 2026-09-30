import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { locateMacOS } from './platform/macos';
import type {
  DirectoryEntry,
  FileSystemAdapter,
  LocatorOptions,
  RegistryProvider,
  SpssInstallation,
} from './platform/types';
import { locateWindows } from './platform/windows';

const execFileAsync = promisify(execFile);

export class NodeFileSystem implements FileSystemAdapter {
  public exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  public isFile(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  public isDirectory(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  }

  public readDirectory(directoryPath: string): DirectoryEntry[] {
    try {
      return fs.readdirSync(directoryPath, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }));
    } catch {
      return [];
    }
  }

  public readText(filePath: string): string | undefined {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return undefined;
    }
  }
}

export class WindowsRegistry implements RegistryProvider {
  public async getInstallRoots(): Promise<string[]> {
    const keys = [
      'HKLM\\SOFTWARE\\IBM\\SPSS\\Statistics',
      'HKLM\\SOFTWARE\\WOW6432Node\\IBM\\SPSS\\Statistics',
      'HKCU\\SOFTWARE\\IBM\\SPSS\\Statistics',
    ];
    const roots = new Set<string>();
    for (const key of keys) {
      try {
        const { stdout } = await execFileAsync('reg.exe', ['query', key, '/s'], {
          windowsHide: true,
          timeout: 10_000,
        });
        for (const line of stdout.split(/\r?\n/u)) {
          const match = line.match(/^\s*(?:InstallPath|InstallDir|Path)\s+REG_\w+\s+(.+)$/iu);
          if (match?.[1]) {
            roots.add(match[1].trim());
          }
        }
      } catch {
        // Missing registry keys are normal on machines without SPSS.
      }
    }
    return [...roots];
  }
}

export interface LocateSpssArguments {
  options?: LocatorOptions;
  platform?: NodeJS.Platform;
  fileSystem?: FileSystemAdapter;
  registry?: RegistryProvider;
  environment?: NodeJS.ProcessEnv;
}

export async function locateSpss(args: LocateSpssArguments = {}): Promise<SpssInstallation | undefined> {
  const platform = args.platform ?? process.platform;
  const fileSystem = args.fileSystem ?? new NodeFileSystem();
  const options = args.options ?? {};
  if (platform === 'darwin') {
    return locateMacOS(options, fileSystem);
  }
  if (platform === 'win32') {
    return locateWindows(
      options,
      fileSystem,
      args.registry ?? new WindowsRegistry(),
      args.environment ?? process.env,
    );
  }
  return undefined;
}

export function launcherWorkingDirectory(installation: SpssInstallation): string {
  if (installation.launchMode === 'ibm-launcher' && process.platform === 'darwin') {
    return path.dirname(installation.pythonLauncher);
  }
  return installation.installRoot;
}
