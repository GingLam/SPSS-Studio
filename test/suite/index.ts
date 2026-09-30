import path from 'node:path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ color: true, timeout: 30_000 });
  if (process.env.SPSS_STUDIO_REAL_INTEGRATION === '1') {
    mocha.addFile(path.resolve(__dirname, 'realSpss.extension.test.js'));
  } else {
    mocha.addFile(path.resolve(__dirname, 'spssStudio.extension.test.js'));
  }
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${String(failures)} Extension Host test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
