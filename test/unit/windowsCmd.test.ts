import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BridgeManager } from '../../src/spss/bridgeManager';

// Real CMD execution, not a fake spawner. Deliberately skipped on macOS.
(process.platform === 'win32' ? describe : describe.skip)('real Windows CMD bridge transport', () => {
  for (const call of [false, true]) {
  it(`runs ${call ? 'IBM-style CALL' : 'direct'} launchers with Unicode, spaces, ampersands and exclamation marks`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ssx-cmd-'));
    try {
      const directory = path.join(root, 'SPSS 中文 & test!');
      await fs.mkdir(directory);
      const launcher = path.join(directory, 'statisticspython3.bat');
      const script = path.join(directory, 'bridge 中文.js');
      await fs.writeFile(launcher, `@echo off\r\n${call ? 'call ' : ''}"%SPSS_STUDIO_NODE%" %*\r\n`);
      await fs.writeFile(script, `const rl = require('node:readline').createInterface({input:process.stdin});
rl.on('line', line => { const q=JSON.parse(line); process.stdout.write(JSON.stringify({id:q.id,ok:true,errorLevel:0,output:'中文',warnings:[],error:null,durationMs:0,engineAlive:q.op!=='shutdown'})+'\\n'); if(q.op==='shutdown') rl.close(); });`);
      const manager = new BridgeManager({ startupTimeoutMs: 5000, executionTimeoutMs: 5000,
        environment: { ...process.env, SPSS_STUDIO_NODE: process.execPath } });
      try {
        const response = await manager.start({ installRoot: directory, pythonLauncher: launcher, launchMode: 'ibm-launcher', environment: {} }, script);
        assert.equal(response.output, '中文');
        await manager.stop(true);
      } finally { await manager.stop(); }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  }
});
