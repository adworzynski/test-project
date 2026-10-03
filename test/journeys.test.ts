import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { addArtifact, approve, review, start, done, newChange, reject, waive, refine, EvidenceRefusal } from '../src/commands/lifecycle.js';
import { computeStatus, computeNext } from '../src/workflow/status.js';
import { projectTrack } from '../src/workflow/engine.js';
import { computeCoverage } from '../src/verify/coverage.js';
import { verify } from '../src/commands/verify.js';
import { checkProject } from '../src/commands/check.js';
import { createRelease, releaseNotes } from '../src/release/release.js';
import { sessionBrief, contextPack } from '../src/agents/context.js';
import { readGate } from '../src/workflow/gates.js';
import { trace } from '../src/commands/trace.js';
import { newProject, write, read, edit, fileOf, flutterReport, git, PRD_BODY, storyBody, errText } from './helpers.js';
import { planHabits, replaceBody } from './plan.js';
import type { Project } from '../src/project.js';

const next = (p: Project) => computeNext({ project: p.reload(), track: projectTrack(p), coverage: computeCoverage(p) });

describe('J1: new mobile app, idea to store-ready build (Product track)', () => {
  it('walks every step with next always pointing the way', async () => {
    const p = newProject('flutter');
    // NV-2: a fresh project points to the discovery interview.
    expect(next(p)[0]).toMatchObject({ skill: 'keel-discovery' });
    expect(computeStatus(p).phase).toMatchObject({ stage: 'Discovery', status: 'not-started' });

    addArtifact(p, 'brief', 'Habit tracker');
    expect(next(p)[0]!.command).toBe('keel review BR-001 --request');
    review(p, 'BR-001', { request: true });
    expect(next(p)[0]).toMatchObject({ actor: 'human', ref: 'BR-001' });
    reject(p, 'BR-001', 'Add success metrics');
    expect(next(p)[0]!.title).toMatch(/Rework BR-001.*Add success metrics/);
    review(p, 'BR-001', { request: true });
    approve(p, 'BR-001');
    const gate = readGate(p.paths, 'BR-001');
    expect(gate.decisions.map((d) => d.decision)).toEqual(['rejected', 'approved']);
    expect(gate.decisions[1]).toMatchObject({ by: 'tester' });
    expect(gate.decisions[1]!.hash).toMatch(/^sha256:/);

    planHabits2(p);
    expect(computeStatus(p.reload()).phase).toMatchObject({ stage: 'Build' });
    // DP-4 and depends_on: ST-002 can't start before ST-001 is done.
    expect(errText(() => start(p, 'ST-002'))).toMatch(/depends on ST-001/);
    expect(next(p)[0]).toMatchObject({ command: 'keel start ST-001' });
    start(p, 'ST-001');

    // Agent claims done without evidence: refused, naming the criterion (VG-2).
    try {
      done(p, 'ST-001');
      expect.fail('should refuse');
    } catch (e) {
      expect(e).toBeInstanceOf(EvidenceRefusal);
      expect((e as EvidenceRefusal).uncovered.map((c) => c.id)).toEqual(['AC-001']);
    }
    write(p.root, 'test/habit_test.dart', "void main() {\n  // @keel AC-001\n  testWidgets('saved habit is listed', (t) async {});\n}\n");
    flutterReport(p, '.keel/tmp/test-results.jsonl', { 'saved habit is listed': 'failure' });
    let v = await verify(p, { record: true, deps: false });
    expect(v.coverage.byId.get('AC-001')!.status).toBe('failed');
    expect(() => done(p, 'ST-001')).toThrow(EvidenceRefusal);
    flutterReport(p, '.keel/tmp/test-results.jsonl', { 'saved habit is listed': 'success' });
    v = await verify(p, { record: true, deps: false });
    expect(v.coverage.byId.get('AC-001')!.status).toBe('passed');
    expect(done(p, 'ST-001').status).toBe('done');
    git(p.root, 'add', '-A');
    git(p.root, 'commit', '-qm', 'Create habits\n\nKeel-Ref: ST-001');
    expect(trace(p.reload(), 'FR-001').commits).toHaveLength(1);

    start(p, 'ST-002');
    // A human waiver also satisfies the gate, with a reason.
    expect(() => waive(p, 'AC-002', '')).toThrow(/reason/);
    waive(p, 'AC-002', 'Checked manually on a Pixel 8; animation timing is not testable yet');
    expect(done(p, 'ST-002').status).toBe('done');

    // Living spec lists the merged criteria per requirement.
    expect(read(p.root, '.keel/spec/FR-001.md')).toContain('AC-001: Saved habit is listed (ST-001)');

    // Release checklist (RC-1) from the PRD and screens; done refused until every box is ticked.
    const rl = createRelease(p.reload());
    const text = read(p.root, rl.file);
    expect(text).toContain('version: 1.2.0');
    expect(text).toContain('Version 1.2.0 and build 7 set in pubspec.yaml');
    expect(text).toContain('SC-001 Today');
    expect(text).toMatch(/iPhone 6\.9/);
    expect(text).toMatch(/Google Play data safety form/);
    expect(() => done(p.reload(), rl.id)).toThrow(/can't be marked done/);
    write(p.root, rl.file, text.replace(/- \[ \]/g, '- [x]'));
    expect(done(p.reload(), rl.id).status).toBe('done');
    expect(computeStatus(p.reload()).phase).toBeNull();
    expect(next(p)[0]!.title).toMatch(/All caught up/);
    expect(releaseNotes(p)).toContain('_No finished stories');
    expect(checkProject(p).filter((d) => d.level === 'error')).toEqual([]);
  });
});

function planHabits2(p: Project) {
  // Same as planHabits but the brief is already approved.
  addArtifact(p, 'prd', 'Habits PRD', { derived_from: ['BR-001'] });
  replaceBody(p, 'PRD-001', PRD_BODY);
  review(p, 'PRD-001', { request: true });
  approve(p, 'PRD-001');
  addArtifact(p, 'screen-map', 'Habits screens');
  replaceBody(p, 'SM-001', '# SM-001: Habits screens\n\n## Screens\n\n### SC-001: Today\n- Requirements: FR-002\n\n### SC-002: New habit\n- Requirements: FR-001\n');
  addArtifact(p, 'design-tokens', 'Habits tokens');
  addArtifact(p, 'adr', 'State management with Riverpod');
  // Stories can't start before a stack ADR is accepted (DP-4).
  addArtifact(p, 'story', 'Create a habit', { implements: ['FR-001'], screens: ['SC-002'] });
  replaceBody(p, 'ST-001', storyBody('ST-001', 'Create a habit', [{ id: 'AC-001', title: 'Saved habit is listed', given: 'the Today screen', when: 'I create "Read"', then: '"Read" is listed' }]));
  review(p, 'ST-001', { request: true });
  approve(p, 'ST-001');
  expect(errText(() => start(p, 'ST-001'))).toMatch(/stack ADR/);
  for (const id of ['SM-001', 'DT-001', 'ADR-001']) {
    review(p, id, { request: true });
    approve(p, id);
  }
  expect(p.reload().graph.get('ADR-001')!.status).toBe('accepted');
  addArtifact(p, 'story', 'Check off a habit', { implements: ['FR-002'], screens: ['SC-001'], depends_on: ['ST-001'] });
  replaceBody(p, 'ST-002', storyBody('ST-002', 'Check off a habit', [{ id: 'AC-002', title: 'Checked habit shows done', given: 'a habit not done', when: 'I tap it', then: 'it shows done' }]));
  review(p, 'ST-002', { request: true });
  approve(p, 'ST-002');
}

describe('J2: bug fix (Quick track)', () => {
  it('routes Quick, merges the delta into the living spec and archives the change', async () => {
    const p = newProject('flutter');
    planHabits(p);
    start(p, 'ST-001');
    waive(p, 'AC-001', 'covered by manual QA for this test');
    done(p, 'ST-001');

    const ch = newChange(p.reload(), 'Fix crash when a habit name has an emoji', { affects: ['FR-001'] });
    expect(ch.decision.track).toBe('quick');
    expect(ch.decision.reasons[0]).toMatch(/small fix/);
    const file = ch.file;
    edit(p, file, /#### AC-\d+: The bug no longer happens\n- Given …\n- When …\n- Then …/, '#### AC-003: Emoji names save\n- Given the New habit screen\n- When I save "Read 📚"\n- Then "Read 📚" is listed\n\n### MODIFIED\n\n#### AC-001: Saved habit is listed with its emoji\n- Given the Today screen\n- When I create "Read 📚"\n- Then "Read 📚" is listed');
    expect(read(p.root, file).split('\n').length).toBeLessThanOrEqual(60);
    start(p, ch.id);
    // The modified criterion's old waiver/evidence must be renewed after the change started.
    write(p.root, 'test/habit_test.dart', "void main() {\n  // @keel AC-003\n  test('emoji names save', () {});\n  // @keel AC-001\n  test('saved habit is listed', () {});\n}\n");
    flutterReport(p, '.keel/tmp/test-results.jsonl', { 'emoji names save': 'success', 'saved habit is listed': 'success' });
    await verify(p, { record: true, deps: false });
    const r = done(p.reload(), ch.id);
    expect(r.status).toBe('archived');
    expect(r.merged!.join('\n')).toMatch(/modified AC-001/);
    p.reload();
    expect(read(p.root, fileOf(p, 'ST-001'))).toContain('Saved habit is listed with its emoji');
    expect(fileOf(p, ch.id)).toMatch(/changes\/archive\/\d{4}-\d{2}-\d{2}-CH-001/);
    expect(p.graph.get(ch.id)!.fm.archived).toBeTruthy();
    expect(read(p.root, '.keel/spec/FR-001.md')).toContain('AC-003: Emoji names save (CH-001)');
    expect(checkProject(p).filter((d) => d.level === 'error' || d.code === 'changed-since-approval')).toEqual([]);
  });

  it('escalates to Feature when the fix touches a sensitive path, and records the path (WF-4)', () => {
    const p = newProject('flutter');
    planHabits(p);
    const ch = newChange(p, 'Fix typo on the login button');
    expect(ch.decision.track).toBe('quick');
    edit(p, ch.file, /#### AC-\d+: The bug no longer happens\n- Given …\n- When …\n- Then …/, '#### AC-003: Login button says "Log in"\n- Given the login screen\n- When it opens\n- Then the button reads "Log in"');
    start(p, ch.id);
    write(p.root, 'lib/auth/login_button.dart', '// fixed');
    expect(() => done(p, ch.id)).toThrow(/touches lib\/auth\/login_button\.dart/);
    const n = p.reload().graph.get(ch.id)!;
    expect(n.fm.track).toBe('feature');
    expect((n.fm.escalations as { path: string }[])[0]!.path).toBe('lib/auth/login_button.dart');
    expect(n.status).toBe('draft');
    expect(next(p).some((a) => a.title.includes(`${ch.id}`) && a.title.includes('request review'))).toBe(true);
  });

  it('override in one command, but never to Quick across a sensitive path', () => {
    const p = newProject('flutter');
    const f = newChange(p, 'Add weekly summary', { track: 'quick' });
    expect(f.decision.track).toBe('quick');
    expect(f.overridden).toBe(true);
    expect(() => newChange(p, 'Fix token refresh', { track: 'quick', paths: ['lib/auth/token.dart'] })).toThrow(/sensitive path/);
  });
});

describe('AG-4: refine an approved artifact in place', () => {
  it('lists downstream items, flags them needs-review and sends the edited artifact back to review', () => {
    const p = newProject('flutter');
    planHabits(p);
    edit(p, fileOf(p, 'PRD-001'), 'The user can mark a habit done for today.', 'The user can mark a habit done for today and undo it.');
    expect(checkProject(p).some((d) => d.code === 'changed-since-approval' && d.message.includes('FR-002'))).toBe(true);
    const preview = refine(p, 'PRD-001');
    expect(preview[0]!.items).toEqual(['FR-002']);
    expect(preview[0]!.downstream.map((d) => d.id)).toEqual(['ST-002']);
    refine(p, 'PRD-001', { apply: true });
    p.reload();
    expect(p.graph.get('ST-002')!.fm.needs_review).toMatch(/FR-002 changed/);
    expect(p.graph.get('ST-001')!.fm.needs_review).toBeUndefined();
    expect(p.graph.get('PRD-001')!.status).toBe('pending-review');
    approve(p, 'PRD-001');
    approve(p, 'ST-002');
    expect(p.reload().graph.get('ST-002')!.fm.needs_review).toBeUndefined();
  });
});

describe('J4: switch agents mid-story', () => {
  it('any agent gets the same story, criteria, decisions and next step from repo state', () => {
    const p = newProject('flutter');
    planHabits(p);
    start(p, 'ST-001');
    const brief = sessionBrief(p.reload());
    expect(brief).toContain('Current story: ST-001 "Create a habit" (in-progress)');
    expect(brief).toContain('AC-001 Saved habit is listed [untested]');
    const pack = contextPack(p, 'ST-001');
    expect(pack.markdown).toContain('### FR-001: Create a habit');
    expect(pack.markdown).toContain('ADR-001');
    expect(pack.markdown).toContain('Keel-Ref: ST-001');
    expect(pack.tokens).toBeLessThanOrEqual(pack.budget);
    const tiny = contextPack(p, 'ST-001', 200);
    expect(tiny.omitted.length).toBeGreaterThan(0);
  });
});

describe('WF-1: workflows are data', () => {
  it('removing a step changes next without code changes; a broken workflow fails keel check', () => {
    const p = newProject('flutter');
    const wf = path.join(p.paths.workflows, 'product.yaml');
    const text = fs.readFileSync(wf, 'utf8');
    // Drop the discovery stage: the first step becomes the PRD.
    const cut = text.slice(0, text.indexOf('  - id: discovery')) + text.slice(text.indexOf('  - id: planning'));
    fs.writeFileSync(wf, cut);
    expect(next(p)[0]!.skill).toBe('keel-prd');
    fs.writeFileSync(wf, cut.replace('gate: approval', 'gate: sometimes'));
    const ds = checkProject(p.reload());
    expect(ds.some((d) => d.code === 'workflow-schema' && d.file === '.keel/workflows/product.yaml')).toBe(true);
  });
});
