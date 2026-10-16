import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HeaderMap } from '@apollo/server';
import type { ApolloServer, BaseContext } from '@apollo/server';
import { closeHttpServer } from './shutdown.ts';

/** A deliberately narrow POST-only adapter, using Apollo's public HTTP integration API. */
export async function startGraphQLHttp<T extends BaseContext>(
  apollo: ApolloServer<T>,
  context: (request: IncomingMessage) => Promise<T>,
  port = 0,
) {
  const http = createServer(async (request, response) => {
    const address = http.address() as AddressInfo;
    const allowedHosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
    if (!allowedHosts.includes(request.headers.host ?? '')) { response.writeHead(403).end('Unexpected host'); return; }
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { response.writeHead(403).end('Cross-origin requests are not allowed'); return; }
    if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }).end('Use a JSON POST request'); return; }
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') { response.writeHead(415).end('Expected application/json'); return; }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 32768) { response.writeHead(413).end('Request too large'); return; }
        chunks.push(chunk);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { response.writeHead(400).end('Invalid JSON'); return; }
      const headers = new HeaderMap();
      for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const result = await apollo.executeHTTPGraphQLRequest({
        httpGraphQLRequest: { method: 'POST', headers, search: '', body },
        context: () => context(request),
      });
      for (const [name, value] of result.headers) response.setHeader(name, value);
      response.statusCode = result.status ?? 200;
      if (result.body.kind === 'complete') response.end(result.body.string);
      else { for await (const part of result.body.asyncIterator) response.write(part); response.end(); }
    } catch {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ errors: [{ message: 'Local HTTP adapter failed.' }] }));
    }
  });
  http.requestTimeout = 10000;
  http.headersTimeout = 5000;
  await apollo.start();
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen({ host: '127.0.0.1', port }, resolve);
    });
  } catch (error) { await apollo.stop(); throw error; }
  const address = http.address() as AddressInfo;
  let stopPromise: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    stop() {
      stopPromise ??= (async () => {
        await closeHttpServer(http);
        await apollo.stop();
      })();
      return stopPromise;
    },
  };
}
