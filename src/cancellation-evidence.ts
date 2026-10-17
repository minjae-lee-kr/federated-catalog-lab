import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
// Ignore inherited Git paths, configuration and trace destinations. This does not
// sandbox hostile code or authenticate the host that records the evidence.
const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
});
export const projectRoot = fileURLToPath(new URL(import.meta.url.endsWith('.js') ? '../../' : '../', import.meta.url));
export async function sourceEvidence(root = projectRoot) {
  const manifest: { path: string; sha256: string }[] = [];
  async function add(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Source evidence does not follow symbolic links.');
    if (info.isDirectory()) { for (const name of (await readdir(path)).sort()) await add(join(path, name)); }
    else if (info.isFile()) manifest.push({ path: relative(root, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
    else throw new Error('Source evidence requires ordinary files.');
  }
  for (const name of ['src', 'tests', 'public', 'schemas', 'operations', 'scripts', 'docs', '.github', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.json', 'README.md', 'SECURITY.md']) {
    try { await add(join(root, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  manifest.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  let git: { head: string; branch: string; dirty: boolean } | null = null;
  try {
    await lstat(join(root, '.git'));
    const run = (args: string[]) => execute('git', args, { cwd: root, env: gitEnvironment(), windowsHide: true, timeout: 5_000 });
    const top = (await run(['rev-parse', '--show-toplevel'])).stdout.trim();
    const normalized = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    if (normalized(top) !== normalized(root)) throw new Error('Unexpected Git root.');
    const [head, branch, status] = await Promise.all([run(['rev-parse', 'HEAD']), run(['branch', '--show-current']), run(['status', '--porcelain', '--untracked-files=all'])]);
    git = { head: head.stdout.trim(), branch: branch.stdout.trim(), dirty: status.stdout.length > 0 };
  } catch { /* The manifest remains useful when Git is absent. No enclosing repository is queried. */ }
  return { sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), manifest, git };
}
