import { DONE_STATUSES } from '../model/registry.js';
import { allDrifted } from './refine.js';
import type { Diagnostic, ArtifactNode } from '../model/types.js';
import type { Project } from '../project.js';

const VAGUE = /\b(fast|quick(ly)?|easy|easily|intuitive|user[- ]friendly|seamless(ly)?|robust|etc\.?|and so on|as needed|appropriate(ly)?|properly|nice|good|simple)\b/i;
const PLACEHOLDER_HEADING = /^#{1,6}\s+.*(<[a-z][^>]{0,40}>|…\s*$|\bTODO\b)/m;

/** Lines a change produced: its own file plus ADRs created for it (WF-6, `keel stats`). */
export function changeLines(project: Project, change: ArtifactNode): number {
  const created = String(change.fm.created ?? '');
  let lines = change.lines;
  for (const id of change.links.adr ?? []) {
    const adr = project.graph.get(id);
    if (adr && String(adr.fm.created ?? '') >= created) lines += adr.lines;
  }
  return lines;
}

export function budgetFor(project: Project, n: ArtifactNode): { key: string; limit: number } | undefined {
  const lines = project.config.budgets.lines;
  if (n.type === 'change') {
    const key = String(n.fm.track ?? 'feature');
    return lines[key] ? { key, limit: lines[key]! } : undefined;
  }
  const keyByType: Record<string, string> = { brief: 'brief', prd: 'prd', story: 'story', adr: 'adr', 'screen-map': 'screens', 'design-tokens': 'tokens' };
  const key = keyByType[n.type];
  return key && lines[key] ? { key, limit: lines[key]! } : undefined;
}

/** Project-level checks beyond schema and links: story lint, coverage of requirements, budgets, drift since approval. */
export function lintProject(project: Project): Diagnostic[] {
  const g = project.graph;
  const out: Diagnostic[] = [];
  const cfg = project.config;
  const stories = g.byType('story');
  const hasScreens = g.byType('screen').length > 0;

  for (const s of stories) {
    const imported = !!s.fm.imported;
    const n = g.criteriaOf(s.id).length;
    if (n < 1 || n > 7) {
      out.push({
        level: imported ? 'warning' : 'error',
        code: 'story-criteria-count',
        message: `${s.id} has ${n} acceptance criteria; stories need 1–7 (split it or add criteria)`,
        file: s.file,
        line: s.line,
        id: s.id,
      });
    }
    for (const c of g.criteriaOf(s.id)) {
      const clauses = [...(c.given ?? []), ...(c.when ?? []), ...(c.then ?? [])];
      if (clauses.some((x) => /^(…|\.\.\.)$/.test(x.trim())) || c.title === 'Observable behavior')
        out.push({
          level: s.status === 'draft' ? 'warning' : 'error',
          code: 'criterion-placeholder',
          message: `${c.id} still has template text; write a real Given/When/Then`,
          file: c.file,
          line: c.line,
          id: c.id,
        });
      const text = [...clauses, c.title].join(' ');
      const m = text.match(VAGUE);
      if (m)
        out.push({
          level: 'warning',
          code: 'criterion-vague',
          message: `${c.id} uses "${m[0]}", which is hard to test; state a measurable outcome`,
          file: c.file,
          line: c.line,
          id: c.id,
        });
    }
    if (cfg.planning.require_screens && hasScreens && s.fm.ui !== false && !(s.links.screens ?? []).length) {
      out.push({
        level: 'warning',
        code: 'story-no-screen',
        message: `${s.id} changes UI but links no screen (add links.screens, or set ui: false)`,
        file: s.file,
        line: s.line,
        id: s.id,
      });
    }
    for (const dep of s.links.depends_on ?? []) {
      if (dep === s.id) out.push({ level: 'error', code: 'self-dependency', message: `${s.id} depends on itself`, file: s.file, line: s.line, id: s.id });
    }
  }

  for (const ch of g.byType('change').filter((c) => c.status !== 'archived')) {
    for (const c of g.criteriaOf(ch.id)) {
      const clauses = [...(c.given ?? []), ...(c.when ?? []), ...(c.then ?? [])];
      if (clauses.some((x) => /^(…|\.\.\.)$/.test(x.trim())) || /^(The bug no longer happens|Observable behavior)$/.test(c.title))
        out.push({
          level: ch.status === 'draft' ? 'warning' : 'error',
          code: 'criterion-placeholder',
          message: `${c.id} still has template text; write a real Given/When/Then`,
          file: c.file,
          line: c.line,
          id: c.id,
        });
    }
  }

  // DP-2: every Must/Should FR needs a story (or a change) by the end of planning.
  if (stories.length) {
    const implemented = new Set<string>();
    for (const n of [...stories, ...g.byType('change')]) for (const r of g.requirementsOf(n.id)) implemented.add(r.id);
    for (const r of g.byType('requirement')) {
      if (r.kind !== 'FR' || r.priority === "Won't" || r.priority === 'Could') continue;
      if (!implemented.has(r.id))
        out.push({ level: 'warning', code: 'requirement-no-story', message: `${r.id} (${r.title}) has no linked story`, file: r.file, line: r.line, id: r.id });
    }
  }

  // WF-6 budgets.
  for (const n of g.topLevel()) {
    if (n.fm.imported) continue;
    const b = budgetFor(project, n);
    if (!b) continue;
    const lines = n.type === 'change' ? changeLines(project, n) : n.lines;
    if (lines > b.limit)
      out.push({
        level: 'warning',
        code: 'over-budget',
        message: `${n.id} is ${lines} lines; the ${b.key} budget is ${b.limit}. Summarize or split it`,
        file: n.file,
        line: 1,
        id: n.id,
      });
  }

  for (const n of g.topLevel()) {
    if (DONE_STATUSES.has(n.status) || n.fm.imported) continue;
    const m = n.body.match(PLACEHOLDER_HEADING);
    if (m && n.status !== 'draft')
      out.push({ level: 'warning', code: 'placeholder', message: `${n.id} still has template placeholder text: "${m[0].trim()}"`, file: n.file, id: n.id });
  }

  for (const d of allDrifted(project)) {
    out.push({
      level: 'warning',
      code: 'changed-since-approval',
      message: `${d.artifact.id} changed after approval${d.items.length ? ` (${d.items.join(', ')})` : ''}; run \`keel refine ${d.artifact.id}\``,
      file: d.artifact.file,
      line: 1,
      id: d.artifact.id,
    });
  }

  for (const n of g.topLevel()) {
    if (n.fm.needs_review)
      out.push({ level: 'warning', code: 'needs-review', message: `${n.id} needs review: ${n.fm.needs_review}`, file: n.file, line: 1, id: n.id });
  }
  return out;
}
