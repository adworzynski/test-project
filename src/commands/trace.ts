import { commitsWithRefs, prNumber, isGitRepo, type Commit } from '../util/git.js';
import { readGate, type GateDecision } from '../workflow/gates.js';
import { computeCoverage, type CriterionCoverage } from '../verify/coverage.js';
import { KeelError } from '../util/errors.js';
import { uniq } from '../util/text.js';
import type { Project } from '../project.js';

export interface TraceNode {
  id: string;
  type: string;
  title: string;
  status: string;
  rel: string;
  depth: number;
}

export interface TraceResult {
  id: string;
  type: string;
  title: string;
  status: string;
  file: string;
  line: number;
  upstream: TraceNode[];
  downstream: TraceNode[];
  criteria: CriterionCoverage[];
  commits: Commit[];
  prs: number[];
  gates: GateDecision[];
}

/** `keel trace <id>` (AG-5): upstream intent, downstream work, criteria with tests, commits and PRs. */
export function trace(project: Project, rawId: string): TraceResult {
  const g = project.graph;
  const id = rawId.toUpperCase();
  const n = g.get(id);
  if (!n) throw new KeelError(`Unknown artifact ${rawId}`);
  const upstream: TraceNode[] = [];
  const seenUp = new Set([id]);
  const up = (cur: string, depth: number) => {
    if (depth > 4) return;
    const node = g.get(cur)!;
    const targets: { to: string; rel: string }[] = [];
    if (node.parent) targets.push({ to: node.parent, rel: 'in' });
    for (const e of g.outgoing(cur)) targets.push({ to: e.to, rel: e.rel });
    for (const t of targets) {
      const tn = g.get(t.to);
      if (!tn || seenUp.has(tn.id)) continue;
      seenUp.add(tn.id);
      upstream.push({ id: tn.id, type: tn.type, title: tn.title, status: tn.status, rel: t.rel, depth });
      up(tn.id, depth + 1);
    }
  };
  up(id, 1);
  const downstream: TraceNode[] = [];
  const seenDown = new Set([id]);
  const down = (cur: string, depth: number) => {
    if (depth > 3) return;
    const node = g.get(cur)!;
    const sources: { from: string; rel: string }[] = node.children.map((c) => ({ from: c, rel: 'contains' }));
    for (const e of g.incoming(cur)) sources.push({ from: e.from, rel: e.rel });
    for (const s of sources) {
      const sn = g.get(s.from);
      if (!sn || seenDown.has(sn.id)) continue;
      seenDown.add(sn.id);
      downstream.push({ id: sn.id, type: sn.type, title: sn.title, status: sn.status, rel: s.rel, depth });
      if (sn.type !== 'criterion' && sn.type !== 'task') down(sn.id, depth + 1);
    }
  };
  down(id, 1);
  // Which work items' commits belong to this artifact.
  const items = new Set<string>();
  if (n.type === 'story' || n.type === 'change') items.add(n.id);
  if (n.parent && ['story', 'change'].includes(g.get(n.parent)?.type ?? '')) items.add(n.parent);
  for (const d of downstream) if (d.type === 'story' || d.type === 'change') items.add(d.id);
  const commits = isGitRepo(project.root) ? commitsWithRefs(project.root).filter((c) => c.refs.some((r) => items.has(r) || r === id)) : [];
  const coverage = computeCoverage(project);
  const critIds = n.type === 'criterion' ? [n.id] : [...items].flatMap((i) => g.criteriaOf(i).map((c) => c.id));
  return {
    id,
    type: n.type,
    title: n.title,
    status: n.status,
    file: n.file,
    line: n.line,
    upstream,
    downstream,
    criteria: uniq(critIds).map((c) => coverage.byId.get(c)!).filter(Boolean),
    commits,
    prs: uniq(commits.map((c) => prNumber(c.subject)).filter((x): x is number => x !== undefined)),
    gates: readGate(project.paths, n.parent && !['criterion'].includes(n.type) ? n.parent : id).decisions,
  };
}

export function renderTrace(t: TraceResult): string {
  const out = [`${t.id} ${t.type} · ${t.status} · ${t.title}`, `  ${t.file}:${t.line}`];
  if (t.upstream.length) {
    out.push('', 'Upstream (why it exists):');
    for (const u of t.upstream) out.push(`${'  '.repeat(u.depth)}${u.rel} → ${u.id} ${u.type} · ${u.status} · ${u.title}`);
  }
  if (t.downstream.length) {
    out.push('', 'Downstream (what depends on it):');
    for (const d of t.downstream.slice(0, 40)) out.push(`${'  '.repeat(d.depth)}${d.id} ${d.type} · ${d.status} · ${d.title} (${d.rel})`);
    if (t.downstream.length > 40) out.push(`  … ${t.downstream.length - 40} more`);
  }
  if (t.criteria.length) {
    out.push('', 'Criteria and tests:');
    for (const c of t.criteria) {
      out.push(`  ${c.id} [${c.status}] ${c.title}`);
      for (const x of c.tests.slice(0, 3)) out.push(`    ${x.status} ${x.file ?? ''}${x.line ? ':' + x.line : ''} "${x.name}"`);
    }
  }
  out.push('', `Commits (${t.commits.length}):`);
  for (const c of t.commits.slice(0, 15)) out.push(`  ${c.sha.slice(0, 8)} ${c.date.slice(0, 10)} ${c.subject}`);
  if (t.prs.length) out.push(`PRs: ${t.prs.map((p) => '#' + p).join(', ')}`);
  if (t.gates.length) {
    out.push('', 'Gate decisions:');
    for (const d of t.gates) out.push(`  ${d.at} ${d.decision} by ${d.by}${d.message ? `: ${d.message}` : ''}`);
  }
  return out.join('\n');
}
