import path from 'node:path';
import fs from 'node:fs';
import { git } from '../util/git.js';
import { readTextIf, writeText } from '../util/fs.js';
import { KeelError } from '../util/errors.js';
import type { Project } from '../project.js';

const MARK = '# keel commit-msg hook';

/** Installs a commit-msg hook that adds `Keel-Ref:` for the item in progress (F5 fallback where agents lack hooks). */
export function installGitHook(project: Project, force = false): string {
  const dir = git(project.root, ['rev-parse', '--git-path', 'hooks']).stdout.trim();
  if (!dir) throw new KeelError('Not a git repository.');
  const file = path.resolve(project.root, dir, 'commit-msg');
  const prev = readTextIf(file);
  if (prev && !prev.includes(MARK) && !force) throw new KeelError(`${file} already exists and isn't Keel's. Add \`keel hook commit-msg "$1"\` to it, or rerun with --force.`);
  writeText(file, `#!/bin/sh\n${MARK}\ncommand -v keel >/dev/null 2>&1 && keel hook commit-msg "$1" || true\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

/** Adds `Keel-Ref: <id>` to a commit message when exactly one story or change is in progress. */
export function commitMsgHook(project: Project, msgFile: string): string | undefined {
  const text = readTextIf(msgFile) ?? '';
  if (/^Keel-Ref:/m.test(text)) return undefined;
  const active = project.graph.activeWork().filter((n) => n.status === 'in-progress');
  if (active.length !== 1) return undefined;
  const id = active[0]!.id;
  const r = git(project.root, ['interpret-trailers', '--in-place', '--trailer', `Keel-Ref: ${id}`, msgFile]);
  if (!r.ok) fs.appendFileSync(msgFile, `\nKeel-Ref: ${id}\n`);
  return id;
}
