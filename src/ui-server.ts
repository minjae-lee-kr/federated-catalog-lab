import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { loadOperations } from './schema.ts';
import { sampleSkus } from './data.ts';
import { parseScenario } from './scenarios.ts';
import { closeHttpServer } from './shutdown.ts';

const assets: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

export async function startUi(gatewayUrl: string, port = 0) {
  const operations = loadOperations();
  const server = createServer(async (request, response) => {
    const address = server.address() as AddressInfo;
    const allowedHosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
    if (!allowedHosts.includes(request.headers.host ?? '')) {
      response.writeHead(403).end('Unexpected host');
      return;
    }
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const asset = assets[request.url ?? ''];
      if (request.method === 'GET' && asset) {
        response.writeHead(200, { 'content-type': asset[1] });
        response.end(await readFile(new URL(`../public/${asset[0]}`, import.meta.url)));
        return;
      }
      if (request.method === 'GET' && request.url === '/operations') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(operations));
        return;
      }
      if (request.method === 'POST' && request.url === '/run') {
        const origin = request.headers.origin;
        if (origin && origin !== `http://${request.headers.host}`) {
          response.writeHead(403).end('Cross-origin requests are not allowed');
          return;
        }
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
          response.writeHead(415).end('Expected application/json');
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 32768) { response.writeHead(413).end('Request too large'); return; }
          chunks.push(chunk);
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(key => !['scenario', 'operation', 'duplicates'].includes(key))) throw new Error('Invalid request shape');
        const { scenario, operation, duplicates } = body as Record<string, unknown>;
        if (typeof operation !== 'string' || !Object.hasOwn(operations, operation)) throw new Error('Unknown operation');
        if (duplicates !== undefined && typeof duplicates !== 'boolean') throw new Error('duplicates must be a boolean');
        const result = await fetch(gatewayUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-lab-scenario': parseScenario(scenario) },
          body: JSON.stringify({ query: operations[operation], variables: { skus: duplicates ? [...sampleSkus, sampleSkus[0]] : sampleSkus } }),
          signal: AbortSignal.timeout(5000),
        });
        response.writeHead(result.status, { 'content-type': 'application/json' });
        response.end(await result.text());
        return;
      }
      response.writeHead(404).end('Not found');
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed' }));
    }
  });
  server.requestTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, resolve);
  });
  const address = server.address() as AddressInfo;
  let stopPromise: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    stop: () => stopPromise ??= closeHttpServer(server),
  };
}
