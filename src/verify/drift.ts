import { commitsWithRefs, changedFiles } from '../util/git.js';
import { matcher } from '../util/fs.js';
import { DONE_STATUSES } from '../model/registry.js';
import type { LinkedTest } from './scan.js';
import type { Project } from '../project.js';

export interface DriftFinding {
  kind: 'code-without-spec' | 'orphan-requirement';
  message: string;
  file?: string;
  requirement?: string;
}

/** Maps code and test files to the requirements they serve, from tests, Keel-Ref commits and `files:` globs. */
export function fileRequirementMap(project: Project, linked: LinkedTest[]): Map<string, Set<string>> {
  const g = project.graph;
  const map = new Map<string, Set<string>>();
  const add = (file: string, itemId: string | undefined) => {
    if (!itemId) return;
    const item = g.owner(itemId);
    if (!item) return;
    for (const r of g.requirementsOf(item.id)) {
      const s = map.get(file) ?? new Set<string>();
      s.add(r.id);
      map.set(file, s);
    }
  };
  for (const t of linked) for (const ac of t.criteria) add(t.file, g.get(ac)?.parent);
  for (const c of commitsWithRefs(project.root, { withFiles: true })) for (const ref of c.refs) for (const f of c.files ?? []) if (!f.startsWith('.keel/')) add(f, ref);
  return map;
}

/**
 * Drift check (VG-5): code linked to a requirement changed with no spec delta and no Keel-Ref to open
 * work; requirements with neither code nor tests once building has started. Advisory by default.
 */
export function detectDrift(project: Project, linked: LinkedTest[], base?: string): DriftFinding[] {
  const g = project.graph;
  const out: DriftFinding[] = [];
  const map = fileRequirementMap(project, linked);
  // `files:` globs on stories and changes also link code to requirements.
  const globbed: { match: (f: string) => boolean; reqs: string[] }[] = [];
  for (const n of [...g.byType('story'), ...g.byType('change')]) {
    const files = (n.fm.files as string[] | undefined) ?? [];
    if (files.length) globbed.push({ match: matcher(files), reqs: g.requirementsOf(n.id).map((r) => r.id) });
  }
  const changed = base ? changedFiles(project.root, base) : changedFiles(project.root);
  const specTouched = changed.some((f) => f.startsWith('.keel/artifacts/') || f.startsWith('.keel/spec/'));
  const rangeRefs = new Set(base ? commitsWithRefs(project.root, { range: `${base}..HEAD` }).flatMap((c) => c.refs) : []);
  for (const n of g.activeWork()) if (n.status === 'in-progress') rangeRefs.add(n.id);
  const coveredReqs = new Set<string>();
  for (const ref of rangeRefs) for (const r of g.requirementsOf(ref)) coveredReqs.add(r.id);
  if (!specTouched) {
    for (const f of changed) {
      if (f.startsWith('.keel/')) continue;
      const reqs = new Set(map.get(f) ?? []);
      for (const gl of globbed) if (gl.match(f)) gl.reqs.forEach((r) => reqs.add(r));
      const uncovered = [...reqs].filter((r) => !coveredReqs.has(r));
      if (uncovered.length)
        out.push({
          kind: 'code-without-spec',
          file: f,
          requirement: uncovered[0],
          message: `${f} changed; it is linked to ${uncovered.join(', ')}, but there is no spec delta and no Keel-Ref to open work for it. Start a change (keel new) or add a Keel-Ref trailer.`,
        });
    }
  }
  const building = [...g.byType('story'), ...g.byType('change')].some((s) => DONE_STATUSES.has(s.status));
  if (building) {
    const withEvidence = new Set<string>();
    for (const set of map.values()) for (const r of set) withEvidence.add(r);
    for (const r of g.byType('requirement')) {
      if (r.kind !== 'FR' || r.priority === "Won't" || r.priority === 'Could') continue;
      if (!withEvidence.has(r.id))
        out.push({ kind: 'orphan-requirement', requirement: r.id, message: `${r.id} (${r.title}) has no linked code or tests yet.` });
    }
  }
  return out;
}
