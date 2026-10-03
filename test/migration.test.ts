import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { importBmad } from '../src/importers/bmad.js';
import { importSpecKit } from '../src/importers/speckit.js';
import { importPrdSource } from '../src/importers/prd.js';
import { exportSpecKit } from '../src/exporters/speckit.js';
import { checkProject } from '../src/commands/check.js';
import { computeStatus } from '../src/workflow/status.js';
import { approve, review, newChange } from '../src/commands/lifecycle.js';
import { newProject, FIXTURES, read, write, edit } from './helpers.js';

function copyFixture(name: string, root: string) {
  fs.cpSync(path.join(FIXTURES, name), root, { recursive: true });
}

describe('J3: bring an existing BMAD project (MG-1)', () => {
  it('imports brief, PRD, architecture, epics, stories and sprint status with links and a report', () => {
    const p = newProject('flutter');
    copyFixture('bmad-v6', p.root);
    const r = importBmad(p);
    const types = r.created.map((c) => c.type);
    expect(types.filter((t) => t === 'brief')).toHaveLength(1);
    expect(types.filter((t) => t === 'prd')).toHaveLength(1);
    expect(types.filter((t) => t === 'adr')).toHaveLength(1);
    expect(types.filter((t) => t === 'story')).toHaveLength(3);
    p.reload();
    const g = p.graph;
    expect(g.byType('requirement').map((x) => x.id)).toEqual(['FR-001', 'FR-002', 'FR-003', 'FR-004', 'NFR-001', 'NFR-002']);
    const st1 = g.byType('story').find((s) => s.fm.bmad === '1.1')!;
    expect(st1.status).toBe('done');
    expect(st1.links.implements).toEqual(['FR-001']);
    expect(g.criteriaOf(st1.id)).toHaveLength(2);
    expect(g.criteriaOf(st1.id)[0]!.when).toEqual(['I add "Milk" expiring tomorrow']);
    const st2 = g.byType('story').find((s) => s.fm.bmad === '1.2')!;
    expect(st2.status).toBe('in-progress');
    // Story 1.2 names no FR; the epic coverage map links it (and the report says it's approximate).
    expect(st2.links.implements).toEqual(['FR-001', 'FR-002', 'FR-004']);
    expect(r.notes.join('\n')).toMatch(/coverage map \(approximate\)/);
    expect(g.byType('story').find((s) => s.fm.bmad === '2.1')!.links.implements).toEqual(['FR-003']);
    expect(g.byType('adr')[0]!.status).toBe('accepted');
    // No manual fixes needed: no errors.
    expect(checkProject(p).filter((d) => d.level === 'error')).toEqual([]);
    expect(read(p.root, '.keel/import-report-bmad.md')).toContain('## ID mapping');
    // keel status shows the real state: done story without tests is uncovered.
    const s = computeStatus(p);
    expect(s.artifacts.story).toMatchObject({ done: 1, 'in-progress': 1, draft: 1 });
    expect(s.coverage.covered).toBe(0);
    // Backlog stories are still drafts, so planning isn't finished; the screens step was skipped.
    expect(s.phase).toMatchObject({ stage: 'Planning', step: 'Stories with acceptance criteria' });
    expect(s.track.find((t) => t.step === 'screens')!.status).toBe('skipped');
  });

  it('records a baseline approval so later edits to imported planning artifacts are detected', () => {
    const p = newProject('flutter');
    copyFixture('bmad-v6', p.root);
    importBmad(p);
    const prd = p.reload().graph.byType('prd')[0]!;
    edit(p, prd.file, 'Users can scan a barcode to prefill an item.', 'Users can scan a barcode or QR code to prefill an item.');
    expect(checkProject(p).some((d) => d.code === 'changed-since-approval' && d.message.includes('FR-002'))).toBe(true);
  });
});

describe('J3: bring an existing Spec Kit project (MG-2) and export back (MG-3)', () => {
  it('imports constitution, specs, plans and tasks', () => {
    const p = newProject('expo');
    copyFixture('speckit', p.root);
    const r = importSpecKit(p);
    p.reload();
    const g = p.graph;
    expect(read(p.root, '.keel/agents/constitution.md')).toContain('Library-First');
    expect(read(p.root, 'AGENTS.md')).toContain('Library-First');
    const stories = g.byType('story');
    expect(stories.map((s) => [s.title, s.status, s.fm.priority])).toEqual([
      ['Create an album', 'done', 'Must'],
      ['Reorder albums', 'approved', 'Should'],
      ['Share by link', 'draft', 'Must'],
    ]);
    expect(g.criteriaOf(stories[0]!.id).map((c) => c.then?.[0])).toEqual(['"Summer" appears in the album list', 'an error says the name is taken']);
    expect(stories[0]!.links.implements).toEqual(['FR-001', 'FR-002', 'FR-003']);
    expect(g.byType('adr').map((a) => a.title)).toEqual(['Technical plan: Photo Albums']);
    expect(g.byType('adr')[0]!.body).toContain('Language/Version: TypeScript 5.6');
    expect(r.skipped.join('\n')).toMatch(/checklists\/requirements\.md/);
    expect(r.mapping).toContainEqual({ from: '002-sharing/FR-001', to: 'FR-004' });
    expect(r.mapping).toContainEqual({ from: '001-photo-albums/SC-001', to: 'NFR-001' });
    expect(checkProject(p).filter((d) => d.level === 'error')).toEqual([]);
  });

  it('exports a Feature change as a Spec Kit feature folder', () => {
    const p = newProject('expo');
    copyFixture('speckit', p.root);
    importSpecKit(p);
    const ch = newChange(p.reload(), 'Add album cover photos', { track: 'feature', affects: ['FR-001'] });
    edit(p, ch.file, /#### AC-\d+: Observable behavior\n- Given …\n- When …\n- Then …/, '#### AC-010: Cover photo shows in the list\n- Given an album with photos\n- When I pick a cover\n- Then the list shows that photo');
    const r = exportSpecKit(p.reload(), ch.id);
    expect(r.dir).toBe('specs/003-add-album-cover-photos');
    const spec = read(p.root, `${r.dir}/spec.md`);
    expect(spec).toContain('# Feature Specification: Add album cover photos');
    expect(spec).toContain('1. **Given** an album with photos, **When** I pick a cover, **Then** the list shows that photo <!-- Keel AC-010 -->');
    expect(spec).toContain('<!-- Keel FR-001 -->');
    expect(read(p.root, `${r.dir}/tasks.md`)).toMatch(/- \[ \] T001 \[US1\] Write a failing test for AC-010 .*`@keel AC-010`/);
    expect(read(p.root, `${r.dir}/plan.md`)).toContain('## Summary');
    // Running the exporter again reuses the folder.
    expect(exportSpecKit(p, ch.id).dir).toBe(r.dir);
  });
});

describe('DP-6: import an existing PRD as quoted source', () => {
  it('quotes the file with a link to it', () => {
    const p = newProject('flutter');
    write(p.root, 'docs/old-prd.md', '# Old PRD\n\n### FR-001: Not a Keel requirement\nText.\n');
    const r = importPrdSource(p, 'docs/old-prd.md');
    const text = read(p.root, r.created[0]!.file);
    expect(text).toContain('> ### FR-001: Not a Keel requirement');
    expect(text).toContain('`docs/old-prd.md`');
    // Quoted headings are not parsed as requirements.
    expect(p.reload().graph.byType('requirement')).toHaveLength(0);
    review(p, r.created[0]!.id);
    expect(() => approve(p, r.created[0]!.id)).not.toThrow();
  });
});
