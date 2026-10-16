import type { Server } from 'node:http';

/** Stop accepting work, allow a short grace period, then close our remaining connections. */
export function closeHttpServer(server: Server, graceMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    timer.unref();
    server.close(error => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}
