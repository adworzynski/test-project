import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initProject, type InitOptions } from '../src/commands/init.js';
import { Project } from '../src/project.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, 'fixtures');
export const CLI = path.join(HERE, '..', 'dist', 'cli.js');

process.env.KEEL_USER = 'tester';

export function tmpDir(prefix = 'keel-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function git(root: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.name=tester', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

export function write(root: string, rel: string, text: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

export function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

export function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

export type Stack = 'flutter' | 'expo';

/** A fresh git repo with a minimal app manifest and `keel init` already run. */
export function newProject(stack: Stack = 'flutter', opts: InitOptions = {}): Project {
  const root = tmpDir();
  git(root, 'init', '-q', '-b', 'main');
  if (stack === 'flutter') write(root, 'pubspec.yaml', 'name: habits\nversion: 1.2.0+7\ndependencies:\n  flutter:\n    sdk: flutter\n');
  else write(root, 'package.json', JSON.stringify({ name: 'habits-expo', version: '1.0.0', dependencies: { expo: '~54.0.0', react: '19.1.0' } }, null, 2));
  initProject(root, { ci: false, ...opts });
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return new Project(root);
}

/** Replaces the first match of `find` in a project file. */
export function edit(project: Project, rel: string, find: string | RegExp, replace: string) {
  const p = path.join(project.root, rel);
  const s = fs.readFileSync(p, 'utf8');
  const out = s.replace(find, replace);
  if (out === s) throw new Error(`edit: pattern not found in ${rel}: ${find}`);
  fs.writeFileSync(p, out);
  project.reload();
}

export function fileOf(project: Project, id: string): string {
  const n = project.reload().graph.get(id);
  if (!n) throw new Error(`no ${id}`);
  return n.file;
}

/** Writes a Flutter --machine report with the given tests (name → pass/fail). */
export function flutterReport(project: Project, file: string, tests: Record<string, 'success' | 'failure'>, suite = 'test/habit_test.dart') {
  const lines = [JSON.stringify({ suite: { id: 0, platform: 'vm', path: suite }, type: 'suite', time: 0 })];
  let id = 10;
  for (const [name, result] of Object.entries(tests)) {
    id++;
    lines.push(JSON.stringify({ test: { id, name, suiteID: 0, groupIDs: [] }, type: 'testStart', time: id }));
    lines.push(JSON.stringify({ testID: id, result, skipped: false, hidden: false, type: 'testDone', time: id + 1 }));
  }
  write(project.root, file, lines.join('\n') + '\n');
}

export const PRD_BODY = `# PRD-001: Habits PRD

## Scope
- MVP: create habits and check them off.

## Functional requirements

### FR-001: Create a habit [Must]
The user can create a habit with a name.

### FR-002: Check off a habit [Must]
The user can mark a habit done for today.

## Non-functional requirements

### NFR-001: Cold start [Must]
Cold start under 2 s on a mid-range phone.
`;

export function storyBody(id: string, title: string, criteria: { id: string; title: string; given: string; when: string; then: string }[]) {
  return [
    `# ${id}: ${title}`,
    '',
    `As a user, I want to ${title.toLowerCase()}, so that I build habits.`,
    '',
    '## Acceptance criteria',
    '',
    ...criteria.flatMap((c) => [`### ${c.id}: ${c.title}`, `- Given ${c.given}`, `- When ${c.when}`, `- Then ${c.then}`, '']),
  ].join('\n');
}

/** Message plus details of the error a function throws (KeelError keeps reasons in details). */
export function errText(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const d = (e as { details?: string[] }).details ?? [];
    return [(e as Error).message, ...d].join('\n');
  }
  throw new Error('expected an error');
}
