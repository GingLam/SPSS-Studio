export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FileSystemAdapter {
  exists(filePath: string): boolean;
  isFile(filePath: string): boolean;
  isDirectory(filePath: string): boolean;
  readDirectory(directoryPath: string): DirectoryEntry[];
  readText(filePath: string): string | undefined;
}

export interface RegistryProvider {
  getInstallRoots(): Promise<string[]>;
}

export interface LocatorOptions {
  explicitInstallPath?: string;
  explicitPythonLauncherPath?: string;
}

export interface SpssInstallation {
  version?: string;
  installRoot: string;
  statsExecutable?: string;
  pythonLauncher: string;
  pythonHome?: string;
  launchMode: 'ibm-launcher' | 'direct-python';
  environment: Record<string, string>;
}
