import { describe, it, expect } from 'vitest';
import { parseArtifactText, parseClauses, stripVolatile } from '../src/graph/parse.js';
import { parseFrontMatter, composeFile } from '../src/util/frontmatter.js';

const STORY = `---
id: ST-014
type: story
status: in-progress
title: Mark a habit done
links: { implements: [FR-007], screens: [SC-003], adr: [ADR-002] }
criteria: [AC-041, AC-042]
owner: adam
created: 2026-10-01
updated: 2026-10-02
---

# ST-014: Mark a habit done

## Acceptance criteria

### AC-041: Tapping marks it done
- Given a habit not done today
- When I tap its checkbox
- And I wait one second
- Then it shows as done

### AC-042: Undo
**Given** a habit done today **When** I tap it again **Then** it is not done

\`\`\`dart
// ### AC-999: inside a code fence is not a criterion
\`\`\`

## Tasks
- [x] TK-010: Write tests
- [ ] Implement
`;

describe('artifact parsing (AG-1, AG-2)', () => {
  it('reads front-matter, sections and tasks', () => {
    const p = parseArtifactText(STORY, 'x.md');
    expect(p.diagnostics).toEqual([]);
    expect(p.node!.id).toBe('ST-014');
    expect(p.node!.links).toEqual({ implements: ['FR-007'], screens: ['SC-003'], adr: ['ADR-002'] });
    const ac = p.subs.filter((s) => s.type === 'criterion');
    expect(ac.map((a) => a.id)).toEqual(['AC-041', 'AC-042']);
    expect(ac[0]!.when).toEqual(['I tap its checkbox', 'I wait one second']);
    expect(ac[1]!.given).toEqual(['a habit done today']);
    expect(ac[1]!.then).toEqual(['it is not done']);
    const tasks = p.subs.filter((s) => s.type === 'task');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.checked).toBe(true);
    expect(p.checkboxes).toHaveLength(2);
  });

  it('reports YAML errors with the file line (NF-8)', () => {
    const p = parseArtifactText('---\nid: ST-001\ntype: story\nlinks: [unclosed\n---\n# x\n', 'bad.md');
    expect(p.node).toBeUndefined();
    expect(p.diagnostics[0]).toMatchObject({ level: 'error', code: 'yaml', file: 'bad.md' });
    expect(p.diagnostics[0]!.line).toBeGreaterThanOrEqual(4);
  });

  it('flags a file without front-matter', () => {
    expect(parseArtifactText('# hello', 'a.md').diagnostics[0]!.code).toBe('no-front-matter');
  });

  it('tracks delta context in changes', () => {
    const text = `---\nid: CH-001\ntype: change\nstatus: draft\ntrack: quick\nlinks: {}\nowner: a\ncreated: 2026-10-01\nupdated: 2026-10-01\n---\n\n# CH-001: Fix\n\n## Delta\n\n### ADDED\n\n#### AC-010: New\n- When x\n- Then y\n\n### MODIFIED\n\n#### FR-002: Changed [Should]\nNew text.\n\n### REMOVED\n\n#### AC-003: Obsolete\n`;
    const p = parseArtifactText(text, 'c.md');
    expect(p.subs.map((s) => [s.id, s.delta])).toEqual([['AC-010', 'added']]);
    expect(p.deltas.map((s) => [s.id, s.delta])).toEqual([
      ['FR-002', 'modified'],
      ['AC-003', 'removed'],
    ]);
    expect(p.deltas[0]!.priority).toBe('Should');
  });

  it('parses requirement priority and kind', () => {
    const p = parseArtifactText(`---\nid: PRD-001\ntype: prd\nstatus: draft\nlinks: {}\nowner: a\ncreated: 2026-10-01\nupdated: 2026-10-01\n---\n\n### FR-001: Create [Must]\nx\n\n### NFR-001 (Should): Fast start\ny\n`, 'p.md');
    expect(p.subs.map((s) => [s.id, s.kind, s.priority, s.title])).toEqual([
      ['FR-001', 'FR', 'Must', 'Create'],
      ['NFR-001', 'NFR', 'Should', 'Fast start'],
    ]);
  });

  it('hash ignores status and updated, so approval does not change it', () => {
    const a = parseArtifactText(STORY, 'x.md').node!.hash;
    const b = parseArtifactText(STORY.replace('status: in-progress', 'status: done').replace('updated: 2026-10-02', 'updated: 2026-12-01'), 'x.md').node!.hash;
    const c = parseArtifactText(STORY.replace('Tapping marks it done', 'Tapping marks it as done'), 'x.md').node!.hash;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(stripVolatile('---\nstatus: x\n---\nstatus: body line\n')).toContain('status: body line');
  });

  it('splits inline Given/When/Then clauses', () => {
    expect(parseClauses(['1. **Given** a, **When** b, **Then** c'])).toEqual({ given: ['a'], when: ['b'], then: ['c'] });
  });

  it('writes front-matter in a stable order (NF-9)', () => {
    const out = composeFile({ updated: '2026-10-02', title: 'T', id: 'ST-001', links: { implements: ['FR-001'] }, type: 'story', zeta: 1, status: 'draft' }, '# body');
    expect(out.split('\n').slice(1, 8)).toEqual(['id: ST-001', 'type: story', 'status: draft', 'title: T', 'links:', '  implements: [FR-001]', 'updated: 2026-10-02']);
    expect(parseFrontMatter(out).fm.zeta).toBe(1);
  });
});
