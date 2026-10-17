import { codegen } from '@graphql-codegen/core';
import * as operations from '@graphql-codegen/typescript-operations';
import { parse } from 'graphql';

// Isolated so a failed or hung generator is a failed experiment, with a timeout
// and process cleanup owned by the parent. The worker never writes source files.
try {
  let input = '';
  for await (const chunk of process.stdin) input += String(chunk);
  const request = JSON.parse(input) as { schema: string; documents: Record<string, string>; config: Record<string, unknown> };
  const schema = parse(request.schema);
  const generated: Record<string, string> = {};
  for (const [name, source] of Object.entries(request.documents)) {
    generated[name] = await codegen({
      filename: `${name}.generated.ts`, schema,
      documents: [{ location: `${name}.graphql`, document: parse(source) }],
      config: request.config,
      plugins: [{ operations: {} }], pluginMap: { operations },
    });
  }
  process.stdout.write(JSON.stringify(generated));
} catch {
  console.error('Operation type generation failed.');
  process.exitCode = 1;
}
