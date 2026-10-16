import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const path of ['schemas', 'operations', 'public']) await cp(path, `dist/${path}`, { recursive: true });
