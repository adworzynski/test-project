import { addArtifact, approve, review } from '../src/commands/lifecycle.js';
import { read, write, edit, fileOf, PRD_BODY, storyBody } from './helpers.js';
import type { Project } from '../src/project.js';

export function replaceBody(p: Project, id: string, body: string) {
  const file = fileOf(p, id);
  const text = read(p.root, file);
  const fmEnd = text.indexOf('\n---', 3) + 4;
  write(p.root, file, text.slice(0, fmEnd) + '\n\n' + body);
  p.reload();
}

/** Drives the planning stage of the Product track the way an agent plus a human would. */
export function planHabits(p: Project) {
  addArtifact(p, 'brief', 'Habit tracker');
  replaceBody(p, 'BR-001', '# BR-001: Habit tracker\n\n## Problem\nPeople forget habits.\n\n## Success metrics\n- 30% of users log 5 of 7 days\n');
  review(p, 'BR-001', { request: true });
  approve(p, 'BR-001');
  addArtifact(p, 'prd', 'Habits PRD', { derived_from: ['BR-001'] });
  replaceBody(p, 'PRD-001', PRD_BODY);
  review(p, 'PRD-001', { request: true });
  approve(p, 'PRD-001');
  addArtifact(p, 'screen-map', 'Habits screens');
  replaceBody(p, 'SM-001', '# SM-001: Habits screens\n\n## Screens\n\n### SC-001: Today\n- Purpose: check off habits\n- Requirements: FR-002\n\n### SC-002: New habit\n- Purpose: create a habit\n- Requirements: FR-001\n');
  addArtifact(p, 'design-tokens', 'Habits tokens');
  addArtifact(p, 'adr', 'State management with Riverpod');
  for (const id of ['SM-001', 'DT-001', 'ADR-001']) {
    review(p, id, { request: true });
    approve(p, id);
  }
  addArtifact(p, 'story', 'Create a habit', { implements: ['FR-001'], screens: ['SC-002'] });
  replaceBody(p, 'ST-001', storyBody('ST-001', 'Create a habit', [{ id: 'AC-001', title: 'Saved habit is listed', given: 'the Today screen', when: 'I create "Read"', then: '"Read" is listed' }]));
  addArtifact(p, 'story', 'Check off a habit', { implements: ['FR-002'], screens: ['SC-001'], depends_on: ['ST-001'] });
  replaceBody(p, 'ST-002', storyBody('ST-002', 'Check off a habit', [{ id: 'AC-002', title: 'Checked habit shows done', given: 'a habit not done', when: 'I tap it', then: 'it shows done' }]));
  for (const id of ['ST-001', 'ST-002']) {
    review(p, id, { request: true });
    approve(p, id);
  }
}

