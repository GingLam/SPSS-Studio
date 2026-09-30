import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(projectRoot, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const outputPath = path.join(distDirectory, `${manifest.name}-${manifest.version}.vsix`);
const vsceExecutable = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vsce.cmd' : 'vsce',
);

fs.mkdirSync(distDirectory, { recursive: true });
const result = spawnSync(vsceExecutable, ['package', '--allow-missing-repository', '--out', outputPath], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
});
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
