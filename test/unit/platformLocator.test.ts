import assert from 'node:assert/strict';
import path from 'node:path';
import { locateMacOS } from '../../src/spss/platform/macos';
import type { DirectoryEntry, FileSystemAdapter, RegistryProvider } from '../../src/spss/platform/types';
import { locateWindows } from '../../src/spss/platform/windows';

class FakeFileSystem implements FileSystemAdapter {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();

  public constructor(
    private readonly pathApi: path.PlatformPath,
    directories: string[],
    files: Array<string | [string, string]>,
  ) {
    for (const directory of directories) {
      this.directories.add(this.key(directory));
    }
    for (const file of files) {
      const [filePath, content] = Array.isArray(file) ? file : [file, ''];
      this.files.set(this.key(filePath), content);
      this.addParents(filePath);
    }
  }

  private key(value: string): string {
    const normalized = this.pathApi.normalize(value);
    return this.pathApi === path.win32 ? normalized.toLowerCase() : normalized;
  }

  private addParents(value: string): void {
    let current = this.pathApi.dirname(value);
    while (current !== this.pathApi.dirname(current)) {
      this.directories.add(this.key(current));
      current = this.pathApi.dirname(current);
    }
    this.directories.add(this.key(current));
  }

  public exists(filePath: string): boolean {
    return this.isFile(filePath) || this.isDirectory(filePath);
  }

  public isFile(filePath: string): boolean {
    return this.files.has(this.key(filePath));
  }

  public isDirectory(filePath: string): boolean {
    return this.directories.has(this.key(filePath));
  }

  public readDirectory(directoryPath: string): DirectoryEntry[] {
    const result = new Map<string, DirectoryEntry>();
    const normalizedDirectory = this.key(directoryPath);
    for (const directory of this.directories) {
      if (this.key(this.pathApi.dirname(directory)) === normalizedDirectory && directory !== normalizedDirectory) {
        const name = this.pathApi.basename(directory);
        result.set(name, { name, isDirectory: true, isFile: false });
      }
    }
    for (const file of this.files.keys()) {
      if (this.key(this.pathApi.dirname(file)) === normalizedDirectory) {
        const name = this.pathApi.basename(file);
        result.set(name, { name, isDirectory: false, isFile: true });
      }
    }
    return [...result.values()];
  }

  public readText(filePath: string): string | undefined {
    return this.files.get(this.key(filePath));
  }
}

class FakeRegistry implements RegistryProvider {
  public constructor(private readonly roots: string[]) {}

  public getInstallRoots(): Promise<string[]> {
    return Promise.resolve(this.roots);
  }
}

function macInstallation(root: string, version: string, launcher = true): FakeFileSystem {
  const app = path.posix.join(root, 'SPSS Statistics.app');
  const pythonHome = path.posix.join(root, 'Resources', 'Python3');
  const files: Array<string | [string, string]> = [
    path.posix.join(app, 'Contents', 'MacOS', 'stats'),
    path.posix.join(pythonHome, 'bin', 'python3'),
    [
      path.posix.join(app, 'Contents', 'Info.plist'),
      `<key>CFBundleShortVersionString</key><string>${version}.0.1.0</string>`,
    ],
  ];
  if (launcher) {
    files.push(path.posix.join(app, 'Contents', 'bin', 'statisticspython3'));
  }
  return new FakeFileSystem(path.posix, [root, app, pythonHome, path.posix.join(pythonHome, 'lib', 'python3.8', 'site-packages')], files);
}

describe('macOS SPSS locator', () => {
  it('detects the current unversioned application layout', () => {
    const root = '/Applications/IBM SPSS Statistics';
    const result = locateMacOS({}, macInstallation(root, '31'));
    assert.ok(result);
    assert.equal(result.version, '31.0.1.0');
    assert.equal(result.installRoot, root);
  });

  it('selects the highest valid version and preserves paths with spaces', () => {
    const roots = ['/Applications/IBM SPSS Statistics 27', '/Applications/IBM SPSS Statistics 32'];
    const allDirectories = [
      '/Applications',
      ...roots.flatMap((root) => [root, `${root}/SPSS Statistics.app`, `${root}/SPSS Statistics.app/Contents`, `${root}/SPSS Statistics.app/Contents/bin`, `${root}/SPSS Statistics.app/Contents/MacOS`, `${root}/Resources/Python3`, `${root}/Resources/Python3/bin`]),
    ];
    const allFiles: Array<string | [string, string]> = roots.flatMap((root, index) => [
      `${root}/SPSS Statistics.app/Contents/bin/statisticspython3`,
      `${root}/SPSS Statistics.app/Contents/MacOS/stats`,
      `${root}/Resources/Python3/bin/python3`,
      [`${root}/SPSS Statistics.app/Contents/Info.plist`, `<key>CFBundleShortVersionString</key><string>${index === 0 ? '27.0.1.0' : '32.0.0.0'}</string>`] as [string, string],
    ]);
    const fake = new FakeFileSystem(path.posix, allDirectories, allFiles);
    const result = locateMacOS({}, fake);
    assert.ok(result);
    assert.equal(result.version, '32.0.0.0');
    assert.equal(result.launchMode, 'ibm-launcher');
    assert.match(result.pythonLauncher, /IBM SPSS Statistics 32/u);
  });

  it('honors an explicit installation path', () => {
    const root = '/Custom/IBM SPSS Statistics 29';
    const result = locateMacOS({ explicitInstallPath: root }, macInstallation(root, '29'));
    assert.ok(result);
    assert.equal(result.installRoot, root);
    assert.equal(result.version, '29.0.1.0');
  });

  it('uses bundled Python only when the IBM launcher is missing', () => {
    const root = '/Applications/IBM SPSS Statistics 28';
    const result = locateMacOS({}, macInstallation(root, '28', false));
    assert.ok(result);
    assert.equal(result.launchMode, 'direct-python');
    assert.equal(result.pythonHome, `${root}/Resources/Python3`);
  });

  it('rejects an installation with neither launcher nor bundled Python', () => {
    const root = '/Applications/IBM SPSS Statistics 27';
    const app = `${root}/SPSS Statistics.app`;
    const fake = new FakeFileSystem(path.posix, [root, app], [
      `${app}/Contents/MacOS/stats`,
      [`${app}/Contents/Info.plist`, '<key>CFBundleShortVersionString</key><string>27.0.1.0</string>'],
    ]);
    assert.equal(locateMacOS({}, fake), undefined);
  });
});

describe('Windows SPSS locator', () => {
  it('discovers a versioned installation under Program Files without registry data', async () => {
    const root = 'C:\\Program Files\\IBM\\SPSS Statistics\\31';
    const fake = new FakeFileSystem(path.win32, [root], [
      `${root}\\statisticspython3.bat`, `${root}\\stats.exe`,
    ]);
    const result = await locateWindows(
      {},
      fake,
      new FakeRegistry([]),
      { ProgramFiles: 'C:\\Program Files' },
    );
    assert.ok(result);
    assert.equal(result.version, '31');
  });

  it('selects the highest registry installation with statisticspython3.bat', async () => {
    const root30 = 'C:\\Program Files\\IBM\\SPSS Statistics\\30';
    const root32 = 'C:\\Program Files\\IBM\\SPSS Statistics\\32';
    const fake = new FakeFileSystem(path.win32, [root30, root32], [
      `${root30}\\statisticspython3.bat`, `${root30}\\stats.exe`,
      `${root32}\\statisticspython3.bat`, `${root32}\\stats.exe`,
    ]);
    const result = await locateWindows({}, fake, new FakeRegistry([root30, root32]), {});
    assert.ok(result);
    assert.equal(result.version, '32');
    assert.equal(result.pythonLauncher, `${root32}\\statisticspython3.bat`);
  });

  it('honors explicit paths and supports direct Python fallback', async () => {
    const root = 'D:\\Research Tools\\IBM SPSS Statistics 31';
    const fake = new FakeFileSystem(path.win32, [`${root}\\Python3`], [
      `${root}\\stats.exe`, `${root}\\Python3\\python.exe`,
    ]);
    const result = await locateWindows({ explicitInstallPath: root }, fake, new FakeRegistry([]), {});
    assert.ok(result);
    assert.equal(result.launchMode, 'direct-python');
    assert.equal(result.pythonHome, `${root}\\Python3`);
  });

  it('returns undefined when SPSS is not installed', async () => {
    const fake = new FakeFileSystem(path.win32, [], []);
    const result = await locateWindows({}, fake, new FakeRegistry([]), { ProgramFiles: 'C:\\Program Files' });
    assert.equal(result, undefined);
  });
});
