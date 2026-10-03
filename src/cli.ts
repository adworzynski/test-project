#!/usr/bin/env node
import { Command } from 'commander';
import { Project } from './project.js';
import { KeelError } from './util/errors.js';
import { c } from './util/output.js';
import { pkgVersion } from './paths.js';
import { registerCommands } from './commands/register.js';

const program = new Command();
program
  .name('keel')
  .description('Keel: one traceable artifact graph from idea to release, for any coding agent.')
  .version(pkgVersion())
  .option('-C, --cwd <dir>', 'run as if started in <dir>')
  .showHelpAfterError();

const cwd = (): string => program.opts().cwd ?? process.cwd();
registerCommands(program, { cwd, openProject: () => Project.open(cwd()) });

function printError(e: unknown): number {
  if (e instanceof KeelError) {
    console.error(`${c.red('error')} ${e.message}`);
    for (const d of e.details) console.error(`  - ${d}`);
    return e.exitCode;
  }
  if (process.env.KEEL_DEBUG && e instanceof Error) console.error(e.stack);
  else console.error(`${c.red('error')} ${e instanceof Error ? e.message : String(e)}`);
  return 1;
}

program.parseAsync(process.argv).catch((e) => {
  process.exitCode = printError(e);
});
