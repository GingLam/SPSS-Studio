import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';

function existingVSCodeExecutable(): string | undefined {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Visual Studio Code.app/Contents/MacOS/Code']
    : process.platform === 'win32'
      ? [
          path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
          path.join(process.env.ProgramFiles ?? '', 'Microsoft VS Code', 'Code.exe'),
        ]
      : ['/usr/bin/code', '/usr/share/code/code'];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, '../..');
  const temporaryBase = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
  const temporaryRoot = fs.mkdtempSync(path.join(temporaryBase, 'ssx-'));
  const workspacePath = path.join(temporaryRoot, 'workspace');
  const installRoot = path.join(temporaryRoot, 'IBM SPSS Statistics 99');
  const launcherDirectory = path.join(installRoot, 'SPSS Statistics.app', 'Contents', 'bin');
  const launcherPath = path.join(launcherDirectory, 'statisticspython3');
  const capturePath = path.join(temporaryRoot, 'bridge-requests.jsonl');
  const userDataDirectory = path.join(temporaryRoot, 'user-data');
  const extensionsDirectory = path.join(temporaryRoot, 'extensions');

  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(launcherDirectory, { recursive: true });
  fs.mkdirSync(userDataDirectory, { recursive: true });
  fs.mkdirSync(extensionsDirectory, { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'test', 'fixtures', 'fake-spss-launcher.js'), launcherPath);
  fs.chmodSync(launcherPath, 0o755);
  fs.writeFileSync(
    path.join(workspacePath, 'commands.sps'),
    'COMPUTE x = 1.25.\n\nFREQUENCIES VARIABLES=x.\n',
    'utf8',
  );

  process.env.SPSS_STUDIO_TEST_INSTALL_ROOT = installRoot;
  process.env.SPSS_STUDIO_TEST_LAUNCHER = launcherPath;
  process.env.SPSS_STUDIO_FAKE_CAPTURE = capturePath;
  process.env.SPSS_STUDIO_TEST_WORKSPACE = workspacePath;

  try {
    const testOptions: Parameters<typeof runTests>[0] = {
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath: path.join(__dirname, 'suite', 'index'),
      launchArgs: [
        workspacePath,
        '--disable-extensions',
        '--disable-workspace-trust',
        `--user-data-dir=${userDataDirectory}`,
        `--extensions-dir=${extensionsDirectory}`,
      ],
    };
    const vscodeExecutablePath = existingVSCodeExecutable();
    if (vscodeExecutablePath) {
      testOptions.vscodeExecutablePath = vscodeExecutablePath;
    }
    await runTests(testOptions);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Extension Host tests failed: ${message}\n`);
  process.exitCode = 1;
});
