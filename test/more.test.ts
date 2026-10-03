import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { upgradePack } from '../src/commands/upgrade.js';
import { PACK_DIR } from '../src/paths.js';
import { claudeTranscriptUsage, claudeStopHook, claudeSessionHook, costReport } from '../src/commands/cost.js';
import { priceFor } from '../src/ledger/pricing.js';
import { buildIndex, queryIndex } from '../src/commands/indexdb.js';
import { renderDashboard, serveDashboard } from '../src/ui/dashboard.js';
import { stats } from '../src/commands/stats.js';
import { detectDrift } from '../src/verify/drift.js';
import { linkedTests } from '../src/verify/coverage.js';
import { appendMemory } from '../src/memory/memory.js';
import { contextPack } from '../src/agents/context.js';
import { start, done, waive, newChange } from '../src/commands/lifecycle.js';
import { explain } from '../src/commands/explain.js';
import { newProject, tmpDir, write, read, git } from './helpers.js';
import { planHabits } from './plan.js';

describe('keel upgrade (WF-7)', () => {
  it('replaces untouched files, merges edited ones, and reports conflicts', () => {
    const p = newProject();
    const pack = tmpDir('keel-pack-');
    fs.cpSync(PACK_DIR, pack, { recursive: true });
    fs.writeFileSync(path.join(pack, 'pack.yaml'), 'name: core\nversion: 0.2.0\n');
    // Upstream edits: one file the user never touched, one the user edited elsewhere, one both edited on the same line.
    const qPath = path.join(pack, 'workflows', 'quick.yaml');
    fs.writeFileSync(qPath, fs.readFileSync(qPath, 'utf8').replace('A bug fix or small change.', 'A bug fix or a small copy or style change.'));
    const fPath = path.join(pack, 'workflows', 'feature.yaml');
    fs.writeFileSync(fPath, fs.readFileSync(fPath, 'utf8').replace('name: Tests first, then code', 'name: Tests first, then the code'));
    const tPath = path.join(pack, 'templates', 'brief.md');
    fs.writeFileSync(tPath, fs.readFileSync(tPath, 'utf8').replace('## Problem', '## The problem'));
    write(p.root, '.keel/workflows/feature.yaml', read(p.root, '.keel/workflows/feature.yaml').replace('version: 0.1.0', 'version: 0.1.0-mine'));
    write(p.root, '.keel/templates/brief.md', read(p.root, '.keel/templates/brief.md').replace('## Problem', '## Pain'));

    const dry = upgradePack(p, { from: pack, dryRun: true });
    expect(read(p.root, '.keel/workflows/quick.yaml')).not.toContain('a small copy');
    expect(dry.files.map((f) => [f.file, f.action]).sort()).toEqual([
      ['.keel/templates/brief.md', 'conflict'],
      ['.keel/workflows/feature.yaml', 'merged'],
      ['.keel/workflows/quick.yaml', 'updated'],
    ]);
    const r = upgradePack(p.reload(), { from: pack });
    expect(r).toMatchObject({ from: '0.1.0', to: '0.2.0' });
    expect(read(p.root, '.keel/workflows/quick.yaml')).toContain('a small copy or style change');
    const feat = read(p.root, '.keel/workflows/feature.yaml');
    expect(feat).toContain('version: 0.1.0-mine');
    expect(feat).toContain('Tests first, then the code');
    expect(read(p.root, '.keel/templates/brief.md')).toMatch(/<<<<<<< yours\n## Pain\n=======\n## The problem\n>>>>>>> new pack/);
    expect(read(p.root, '.keel/keel.yaml')).toMatch(/version: 0\.2\.0/);
    // A second upgrade with the same pack changes nothing (no silent rewrites of resolved files).
    expect(upgradePack(p.reload(), { from: pack }).files.filter((f) => f.action !== 'kept')).toEqual([]);
  });
});

describe('cost ledger (RC-3, RC-4)', () => {
  it('reads Claude Code transcripts once per message and prices them', () => {
    const t = [
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } } },
      { type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } } },
      { type: 'assistant', message: { id: 'm2', model: 'claude-haiku-4-5', usage: { input_tokens: 10, output_tokens: 5 } } },
    ]
      .map((x) => JSON.stringify(x))
      .join('\n');
    const u = claudeTranscriptUsage(t);
    expect(u.get('claude-opus-5-5')).toEqual({ input: 100, output: 50, cacheRead: 1000, cacheWrite: 200 });
    expect(u.get('claude-haiku-4-5')!.input).toBe(10);
    expect(priceFor('claude-opus-5-5[1m]')).toMatchObject({ input: 4, output: 20 });
    expect(priceFor('us.anthropic.claude-sonnet-5-5')).toMatchObject({ input: 2 });
    expect(priceFor('gpt-x')).toBeUndefined();
    expect(priceFor('my-model', { 'my-model': { input: 1, output: 2 } })).toEqual({ input: 1, output: 2 });
  });

  it('Stop hook re-reports cumulative totals without double counting; session hook marks runs', () => {
    const p = newProject();
    planHabits(p);
    start(p, 'ST-001');
    const tr = path.join(p.root, 'transcript.jsonl');
    const line = (id: string, n: number) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: n, output_tokens: n } } });
    claudeSessionHook(p, { session_id: 's1', source: 'startup' });
    claudeSessionHook(p, { session_id: 's2', source: 'startup' });
    fs.writeFileSync(tr, line('a', 1_000_000) + '\n');
    claudeStopHook(p, { session_id: 's1', transcript_path: tr });
    fs.appendFileSync(tr, line('b', 1_000_000) + '\n');
    claudeStopHook(p, { session_id: 's1', transcript_path: tr });
    const r = costReport(p);
    expect(r.tokens).toBe(4_000_000);
    expect(r.usd).toBeCloseTo(24, 5);
    expect(r.groups['ST-001']!.usd).toBeCloseTo(24, 5);
    expect(r.unreported).toEqual(['claude-s2']);
  });
});

describe('derived SQLite index (AG-6)', () => {
  it('rebuilds identically after deletion', async () => {
    const p = newProject();
    planHabits(p);
    write(p.root, 'test/habit_test.dart', "void main() {\n  // @keel AC-001\n  test('saved habit is listed', () {});\n}\n");
    const q = "SELECT a.id, a.type, a.status, l.rel, l.dst FROM artifacts a LEFT JOIN links l ON l.src = a.id WHERE a.type IN ('story','criterion') ORDER BY a.id, l.rel, l.dst";
    await buildIndex(p);
    const first = await queryIndex(p, q);
    const tests = await queryIndex(p, 'SELECT criterion, name FROM tests');
    expect(tests).toEqual([{ criterion: 'AC-001', name: 'saved habit is listed' }]);
    fs.rmSync(p.paths.index);
    await buildIndex(p);
    expect(await queryIndex(p, q)).toEqual(first);
    expect(first.length).toBeGreaterThan(3);
    await expect(queryIndex(p, 'DELETE FROM artifacts')).rejects.toThrow(/read-only/);
  });
});

describe('dashboard (NV-4)', () => {
  it('renders the board, graph, coverage and cost without network references, fast', async () => {
    const p = newProject();
    planHabits(p);
    const t0 = Date.now();
    const html = renderDashboard(p);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(html).toContain('<h2>Board</h2>');
    expect(html).toContain('ST-001');
    expect(html).toContain('aria-label="Requirements linked to stories');
    expect(html).not.toMatch(/(src|href)="https?:/);
    const server = await serveDashboard(p.root, 0);
    const port = (server.address() as { port: number }).port;
    const body = await new Promise<string>((resolve) => http.get(`http://127.0.0.1:${port}/`, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }));
    server.close();
    expect(body).toContain('<title>Keel · habits</title>');
  });
});

describe('drift check (VG-5)', () => {
  it('flags code linked to a requirement changed without a spec delta or Keel-Ref', () => {
    const p = newProject();
    planHabits(p);
    write(p.root, 'lib/habit_form.dart', '// form');
    write(p.root, 'test/habit_test.dart', "void main() {\n  // @keel AC-001\n  test('saved habit is listed', () {});\n}\n");
    git(p.root, 'add', '-A');
    git(p.root, 'commit', '-qm', 'Habit form\n\nKeel-Ref: ST-001');
    const base = git(p.root, 'rev-parse', 'HEAD').trim();
    // Later, someone edits the form with no change note and no trailer.
    write(p.root, 'lib/habit_form.dart', '// form v2');
    git(p.root, 'commit', '-qam', 'tweak');
    const d = detectDrift(p.reload(), linkedTests(p), base);
    expect(d.filter((x) => x.kind === 'code-without-spec').map((x) => [x.file, x.requirement])).toEqual([['lib/habit_form.dart', 'FR-001']]);
    // Starting a change for it clears the finding.
    const ch = newChange(p, 'Tweak the habit form', { track: 'quick', affects: ['FR-001'] });
    start(p.reload(), ch.id, { force: true });
    expect(detectDrift(p.reload(), linkedTests(p), base).filter((x) => x.kind === 'code-without-spec')).toEqual([]);
  });
});

describe('memory (ME-1, ME-2)', () => {
  it('decisions and constraints reach the next context pack', () => {
    const p = newProject();
    planHabits(p);
    appendMemory(p.paths, p.root, { kind: 'decision', title: 'Store habits in Hive', by: 'tester', source: 'claude-code', step: 'architecture', link: 'ADR-001' });
    appendMemory(p.paths, p.root, { kind: 'constraint', title: 'Never use print(); use the logger', by: 'tester' });
    const pack = contextPack(p.reload(), 'ST-001');
    expect(pack.markdown).toContain('CN-001: Never use print(); use the logger');
    expect(pack.markdown).toContain('D-001');
    const dec = read(p.root, '.keel/memory/decisions.md');
    expect(dec).toMatch(/## D-001: Store habits in Hive\n- date: \d{4}-\d{2}-\d{2}\n- by: tester\n- source: claude-code\n- step: architecture\n- link: ADR-001/);
  });
});

describe('stats and explain (WF-6, NV-5)', () => {
  it('reports lines per change and explains every shipped step', () => {
    const p = newProject();
    planHabits(p);
    start(p, 'ST-001');
    waive(p, 'AC-001', 'manual');
    done(p, 'ST-001');
    newChange(p.reload(), 'Fix crash on empty name', { track: 'quick' });
    const s = stats(p.reload());
    expect(s.changes[0]).toMatchObject({ id: 'CH-001', track: 'quick', budget: 60, over: false });
    expect(s.timeToFirstBriefMinutes).toBeGreaterThanOrEqual(0);
    for (const step of ['brief', 'prd', 'screens', 'architecture', 'stories', 'implement', 'release', 'define', 'note', 'fix'])
      expect(explain(p, step)).toMatch(/›/);
    expect(explain(p, 'gates')).toMatch(/evidence/);
    expect(explain(p)).toMatch(/Quick track/);
  });
});
