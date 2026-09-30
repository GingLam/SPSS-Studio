import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { locateSpss } from '../src/spss/spssLocator';

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
  const installation = await locateSpss();
  if (!installation) {
    throw new Error('No IBM SPSS Statistics installation was detected for the real Extension Host test.');
  }
  const projectRoot = path.resolve(__dirname, '../..');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ssx-real-'));
  const workspace = path.join(temporaryRoot, 'workspace');
  const userData = path.join(temporaryRoot, 'user-data');
  const extensions = path.join(temporaryRoot, 'extensions');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(extensions, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'real.sps'), [
    'DATA LIST FREE /id age income.',
    'BEGIN DATA',
    '1 20 3000',
    '2 30 5000',
    '3 40 7000',
    'END DATA.',
    'DATASET NAME ExtensionHostData.',
    'DESCRIPTIVES VARIABLES=age income.',
    'EXAMINE VARIABLES=age',
    '\t/PLOT NONE',
    '\t/CINTERVAL 95.',
  ].join('\n'), 'utf8');

  process.env.SPSS_STUDIO_REAL_INTEGRATION = '1';
  process.env.SPSS_STUDIO_REAL_INSTALL_ROOT = installation.installRoot;
  process.env.SPSS_STUDIO_REAL_LAUNCHER = installation.pythonLauncher;
  process.env.SPSS_STUDIO_REAL_WORKSPACE = workspace;
  try {
    const options: Parameters<typeof runTests>[0] = {
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath: path.join(__dirname, 'suite', 'index'),
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
        `--user-data-dir=${userData}`,
        `--extensions-dir=${extensions}`,
      ],
    };
    const executable = existingVSCodeExecutable();
    if (executable) {
      options.vscodeExecutablePath = executable;
    }
    await runTests(options);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
