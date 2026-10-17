import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const local = createRequire(import.meta.url);
const canonical = createRequire(new URL("../../package.json", import.meta.url));
const resolve = (name) =>
  name.startsWith("react") ? local.resolve(name) : canonical.resolve(name);
const result = await build({
  entryPoints: [fileURLToPath(new URL("app.jsx", import.meta.url))],
  outfile: fileURLToPath(new URL("app.js", import.meta.url)),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  minifySyntax: true,
  sourcemap: false,
  metafile: true,
  plugins: [
    {
      name: "fixed-dependencies",
      setup(build) {
        build.onResolve(
          { filter: /^(react(?:-dom)?(?:\/.*)?|@apollo\/client(?:\/.*)?)$/ },
          (args) => ({ path: resolve(args.path) }),
        );
      },
    },
  ],
});
const bytes = await readFile(new URL("app.js", import.meta.url));
await writeFile(
  new URL("build-receipt.json", import.meta.url),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      mode: "production",
      minifySyntax: true,
      strictMode: false,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      inputs: Object.keys(result.metafile.inputs).length,
      note: "Only app.js is served. No source maps; dependency resolution uses experiment React and the existing pinned Apollo installation.",
    },
    null,
    2,
  ) + "\n",
);
