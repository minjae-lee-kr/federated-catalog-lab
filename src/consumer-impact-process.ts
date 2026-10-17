import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';

export interface ToolCommand { executable: string; args: string[] }

/** One owned process tree, bounded output and lifetime. Never invokes a shell. */
export function runTool(command: ToolCommand, options: {
  label: string; cwd: string; input?: string; timeoutMs: number;
  signal?: AbortSignal; maxOutputBytes?: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (options.signal?.aborted) return Promise.reject(new Error(`${options.label}: aborted`));
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: options.cwd, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let failure: Error | undefined;
    let stdout = '', stderr = '', bytes = 0;
    const stop = (reason: string) => {
      if (failure) return;
      failure = new Error(`${options.label}: ${reason}`);
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
        } else process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The child may have exited between the timeout and termination request.
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => stop('timed out'), options.timeoutMs);
    const abort = () => stop('aborted');
    options.signal?.addEventListener('abort', abort, { once: true });
    const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 1_048_576)) { stop('output limit exceeded'); return; }
      if (stream === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', chunk => collect(chunk, 'stdout'));
    child.stderr.on('data', chunk => collect(chunk, 'stderr'));
    child.stdin.on('error', () => { /* early process exit is handled by close */ });
    child.on('error', error => { failure = new Error(`${options.label}: could not start (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (signal || code === null) reject(new Error(`${options.label}: terminated without an exit code`));
      else resolve({ exitCode: code, stdout, stderr });
    });
    child.stdin.end(options.input ?? '');
    if (options.signal?.aborted) abort();
  });
}
