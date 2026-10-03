// Marks the CLI entry point executable after tsc emits it.
import { chmodSync, existsSync } from 'node:fs';

const cli = new URL('../dist/cli.js', import.meta.url);
if (existsSync(cli)) chmodSync(cli, 0o755);
