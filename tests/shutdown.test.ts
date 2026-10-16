import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { startLab } from '../src/lab.ts';
import { startUi } from '../src/ui-server.ts';

async function incompleteRequest(url: string, path: string) {
  const address = new URL(url);
  const socket = createConnection({ host: address.hostname, port: Number(address.port) });
  socket.on('error', () => undefined);
  await once(socket, 'connect');
  socket.write(`POST ${path} HTTP/1.1\r\nHost: ${address.host}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{`);
  await delay(20);
  return socket;
}

it('bounds GraphQL shutdown when a client leaves a request body incomplete', async () => {
  const lab = await startLab();
  const socket = await incompleteRequest(lab.url, '/');
  try {
    await Promise.race([
      Promise.all([lab.stop(), lab.stop()]),
      delay(2500).then(() => { throw new Error('Shutdown exceeded the one-second grace plus scheduling tolerance'); }),
    ]);
  } finally { socket.destroy(); await lab.stop(); }
});

it('bounds explorer shutdown with a partial body and supports repeated cleanup', async () => {
  const lab = await startLab();
  const ui = await startUi(lab.url);
  const socket = await incompleteRequest(ui.url, '/run');
  try {
    await Promise.race([
      Promise.all([ui.stop(), ui.stop()]),
      delay(2500).then(() => { throw new Error('Explorer shutdown exceeded the grace period'); }),
    ]);
  } finally { socket.destroy(); await ui.stop(); await lab.stop(); }
});
