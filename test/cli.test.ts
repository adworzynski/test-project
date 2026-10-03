import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CLI, newProject, write, tmpDir, git, read } from './helpers.js';
import { planHabits } from './plan.js';
import { computeStatus } from '../src/workflow/status.js';
import { createKeelServer } from '../src/mcp/server.js';

function keel(cwd: string, ...args: string[]) {
  const r = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', KEEL_USER: 'tester' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
  if (!fs.existsSync(CLI)) execFileSync('npm', ['run', 'build'], { cwd: path.join(path.dirname(CLI), '..') });
});

describe('CLI', () => {
  it('init detects the stack, writes files and points to discovery', () => {
    const root = tmpDir();
    git(root, 'init', '-q');
    write(root, 'package.json', JSON.stringify({ name: 'shop', dependencies: { expo: '~54.0.0' } }));
    const r = keel(root, 'init');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/solo-mobile profile, expo stack \(detected\)/);
    expect(r.out).toMatch(/keel-discovery/);
    expect(read(root, '.github/workflows/keel.yml')).toMatch(/npx jest --ci --json/);
    expect(keel(root, 'init').code).toBe(1);
  });

  it('status --json matches the MCP get_status result (NV-3)', () => {
    const p = newProject();
    planHabits(p);
    const r = keel(p.root, 'status', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual(JSON.parse(JSON.stringify(computeStatus(p.reload()))));
    expect(createKeelServer(p.root)).toBeTruthy();
  });

  it('status fits one screen without color, next is never empty', () => {
    const p = newProject();
    planHabits(p);
    const s = keel(p.root, 'status');
    expect(s.out.split('\n').length).toBeLessThanOrEqual(40);
    expect(s.out).not.toMatch(/\x1b\[/);
    expect(keel(p.root, 'next').out).toMatch(/^1\. /);
  });

  it('check fails with file and line on a malformed artifact and leaves others intact (NF-8)', () => {
    const p = newProject();
    planHabits(p);
    write(p.root, '.keel/artifacts/stories/ST-009-bad.md', '---\nid: ST-009\ntype: story\nlinks: [oops\n---\n# bad\n');
    const r = keel(p.root, 'check');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/error \.keel\/artifacts\/stories\/ST-009-bad\.md:\d+ /);
    expect(keel(p.root, 'trace', 'ST-001').code).toBe(0);
  });

  it('done exits non-zero with the uncovered criteria', () => {
    const p = newProject();
    planHabits(p);
    keel(p.root, 'start', 'ST-001');
    const r = keel(p.root, 'done', 'ST-001');
    expect(r.code).toBe(2);
    expect(r.err).toContain('AC-001 Saved habit is listed: no linked test');
  });

  it('verify --ci --format markdown fails when finished work lacks evidence', () => {
    const p = newProject();
    planHabits(p);
    keel(p.root, 'start', 'ST-001');
    keel(p.root, 'waive', 'AC-001', '-m', 'manual');
    expect(keel(p.root, 'done', 'ST-001').code).toBe(0);
    keel(p.root, 'waive', 'AC-001', '--revoke');
    const out = path.join(p.root, 'v.md');
    const r = keel(p.root, 'verify', '--ci', '--no-deps', '--format', 'markdown', '--out', out);
    expect(r.code).toBe(1);
    expect(fs.readFileSync(out, 'utf8')).toMatch(/<!-- keel-verify -->\n## Keel verify: ❌ failed/);
    expect(fs.readFileSync(out, 'utf8')).toMatch(/\| AC-001 Saved habit is listed \| ST-001 \| NO TEST \|/);
  });

  it('commit-msg hook adds Keel-Ref for the item in progress', () => {
    const p = newProject();
    planHabits(p);
    keel(p.root, 'start', 'ST-001');
    write(p.root, 'msg.txt', 'Add habit form\n');
    keel(p.root, 'hook', 'commit-msg', 'msg.txt');
    expect(read(p.root, 'msg.txt')).toMatch(/Add habit form\n\nKeel-Ref: ST-001\n/);
  });

  it('context --hook claude never fails, even outside a project', () => {
    const r = spawnSync('node', [CLI, 'context', '--session', '--hook', 'claude'], { cwd: tmpDir(), input: '{"session_id":"x"}', encoding: 'utf8' });
    expect(r.status).toBe(0);
  });

  it('status, next and check stay under 1 s on a 200-artifact project (NF-3)', () => {
    const p = newProject();
    planHabits(p);
    for (let i = 3; i < 200; i++) {
      const id = `ST-${String(i).padStart(3, '0')}`;
      const ac = `AC-${String(i + 100).padStart(3, '0')}`;
      write(p.root, `.keel/artifacts/stories/${id}-s.md`, `---\nid: ${id}\ntype: story\nstatus: approved\ntitle: Story ${i}\nlinks: { implements: [FR-001] }\nui: false\ncriteria: [${ac}]\nowner: t\ncreated: 2026-10-01\nupdated: 2026-10-01\n---\n\n# ${id}\n\n## Acceptance criteria\n\n### ${ac}: Works ${i}\n- Given state ${i}\n- When I act\n- Then it works\n`);
    }
    for (const cmd of ['status', 'next', 'check']) {
      const t0 = Date.now();
      const r = keel(p.root, cmd);
      const ms = Date.now() - t0;
      expect(r.code, r.err).toBe(0);
      expect(ms, `${cmd} took ${ms} ms`).toBeLessThan(1000);
    }
  });
});
