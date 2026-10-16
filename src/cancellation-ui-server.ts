import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { closeHttpServer } from './shutdown.ts';
import { runCancellationExperiment } from './cancellation-experiment.ts';

const assets: Record<string, [string, string]> = {
  '/': ['debt.html', 'text/html; charset=utf-8'],
  '/debt.css': ['debt.css', 'text/css; charset=utf-8'],
  '/debt.js': ['debt.js', 'text/javascript; charset=utf-8'],
  '/debt-live.js': ['debt-live.js', 'text/javascript; charset=utf-8'],
};
export async function startCancellationUi(port = 0) {
  let active: Promise<unknown> | undefined;
  let closing = false;
  const server = createServer(async (request, response) => {
    const address = server.address() as AddressInfo;
    const host = request.headers.host;
    const send = (status: number, value: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value));
    };
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (![ `127.0.0.1:${address.port}`, `localhost:${address.port}` ].includes(host ?? '')) return send(403, { error: 'LOCAL_ONLY' });
    if (request.headers.origin && request.headers.origin !== `http://${host}`) return send(403, { error: 'ORIGIN_FORBIDDEN' });
    try {
      const asset = assets[request.url ?? ''];
      if (request.method === 'GET' && asset) {
        const content = await readFile(new URL(`../public/${asset[0]}`, import.meta.url));
        response.writeHead(200, { 'content-type': asset[1] }); response.end(content); return;
      }
      if (request.method !== 'POST' || request.url !== '/experiment') return send(404, { error: 'NOT_FOUND' });
      if (closing) return send(503, { error: 'CLOSING' });
      if (active) return send(409, { error: 'EXPERIMENT_RUNNING' });
      if (request.headers['content-type'] !== 'application/json') return send(415, { error: 'JSON_REQUIRED' });
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += chunk.length; if (size > 1_024) return send(413, { error: 'BODY_TOO_LARGE' });
        chunks.push(chunk);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) return send(400, { error: 'FIXED_EXPERIMENT_ONLY' });
      // Recheck after body reading: two concurrent requests may both reach the first check.
      if (active) return send(409, { error: 'EXPERIMENT_RUNNING' });
      active = runCancellationExperiment();
      try { send(200, await active); }
      finally { active = undefined; }
    } catch { send(500, { error: 'EXPERIMENT_FAILED' }); }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let close: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    stop() {
      closing = true;
      return close ??= (async () => { await closeHttpServer(server); await active?.catch(() => undefined); })();
    },
  };
}
