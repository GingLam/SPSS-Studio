import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** An OS-owned loopback mutex prevents concurrent setup without leaving stale lock files. */
export async function acquireSetupLock(directory: string): Promise<() => Promise<void>> {
  const normalized = process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory);
  const port = 49152 + createHash('sha256').update(normalized).digest().readUInt16BE(0) % 16000;
  const server = net.createServer((socket) => socket.end());
  server.unref();
  await new Promise<void>((resolve, reject) => {
    server.once('error', (cause) => reject(new Error(`SETUP_LOCK_UNAVAILABLE ${cause.message}`, { cause })));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  return async () => {
    if (server.listening) { await new Promise<void>((resolve) => server.close(() => resolve())); }
  };
}
