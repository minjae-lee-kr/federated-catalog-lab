import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
export async function sourceEvidence() {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
  const run = async (args) =>
    (
      await execute("git", args, {
        cwd: root,
        env,
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout;
  const [head, branch, status, files] = await Promise.all([
    run(["rev-parse", "HEAD"]),
    run(["branch", "--show-current"]),
    run(["status", "--porcelain", "--untracked-files=all"]),
    run(["ls-files", "-z"]),
  ]);
  const manifest = [];
  for (const path of files.split("\0").filter(Boolean).sort()) {
    if (path.startsWith("/") || path.includes("..") || path.includes("\\"))
      throw new Error("Unexpected tracked path");
    const target = new URL("../../" + path, import.meta.url);
    if (!(await lstat(target)).isFile())
      throw new Error("Only regular tracked source files are supported");
    const bytes = await readFile(target);
    manifest.push({
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return {
    sha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    manifest,
    git: { head: head.trim(), branch: branch.trim(), dirty: status.length > 0 },
  };
}
