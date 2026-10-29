#!/usr/bin/env bun

import { runCli } from "./cli.ts";

const exitCode = await runCli(process.argv.slice(2));

// Flush the secret or JSON result before a forced exit cancels buffered pipe writes.
const flush = (stream: NodeJS.WriteStream) =>
  new Promise<void>((resolve, reject) => {
    stream.write("", (error) => (error ? reject(error) : resolve()));
  });
await Promise.all([flush(process.stdout), flush(process.stderr)]);
process.exit(exitCode);
