import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { QuickStartLanguage } from './quickStartState';

const EXAMPLE_REVISION = '1.4.1';

/** Prepare editable examples without modifying the extension or a research folder. */
export async function prepareExample(extensionRoot: string, storageRoot: string, language: QuickStartLanguage): Promise<string> {
  const bundled = path.join(extensionRoot, 'resources', 'examples');
  const directory = path.join(storageRoot, 'examples', EXAMPLE_REVISION);
  await fs.mkdir(directory, { recursive: true });
  const data = path.join(directory, 'spss-studio-example.sav');
  try { await fs.copyFile(path.join(bundled, 'spss-studio-example.sav'), data, constants.COPYFILE_EXCL); }
  catch (error) { if (!isAlreadyPresent(error)) { throw error; } }
  const target = path.join(directory, `example.${language}.sps`);
  try { await fs.access(target); return target; }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error; } }
  const source = await fs.readFile(path.join(bundled, `example.${language}.sps`), 'utf8');
  const reference = "GET FILE='spss-studio-example.sav'.";
  if (source.split(reference).length !== 2) { throw new Error('Invalid bundled SPSS example reference.'); }
  const resolved = data.replaceAll('\\', '/').replaceAll("'", "''");
  try { await fs.writeFile(target, source.replace(reference, `GET FILE='${resolved}'.`), { encoding: 'utf8', flag: 'wx' }); }
  catch (error) { if (!isAlreadyPresent(error)) { throw error; } }
  return target;
}

function isAlreadyPresent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
