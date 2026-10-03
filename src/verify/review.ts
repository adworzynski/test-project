import path from 'node:path';
import { writeText } from '../util/fs.js';
import { commitsWithRefs, changedFiles, resolveBase, isGitRepo } from '../util/git.js';
import { truncate, uniq } from '../util/text.js';
import { computeCoverage, itemCoverage, type CoverageReport } from './coverage.js';
import { budgetFor, changeLines, lintProject } from '../workflow/lint.js';
import { driftSinceApproval, downstreamOf } from '../workflow/refine.js';
import { sensitiveMatch } from '../workflow/router.js';
import { TYPES } from '../model/registry.js';
import type { ArtifactNode } from '../model/types.js';
import type { Project } from '../project.js';

const CHECKS: Record<string, string[]> = {
  brief: ['Is the problem specific, and are the users real people you can reach?', 'Are the success metrics measurable with a number and a time frame?'],
  prd: ['Is the MVP cut small enough to ship?', 'Is every FR user-visible and testable? Are NFRs measurable?'],
  'screen-map': ['Does every screen handle empty, loading, error and offline states?', 'Does every Must FR appear on at least one screen?'],
  'design-tokens': ['Do text/background pairs meet 4.5:1 contrast?'],
  adr: ['Were real alternatives considered?', 'Are the consequences (especially the bad ones) acceptable?'],
  story: ['Is the story small enough for one session?', 'Can each criterion be proven by one automated test?'],
  change: ['Does the delta describe all behavior the code changes?', 'Did you run the app and try the criteria yourself?'],
  release: ['Did you smoke-test the store build on a device?', 'Is the privacy information accurate?'],
};

/** Files touched by commits referencing the item (Keel-Ref) plus, while in progress, the working tree. */
export function filesForItem(project: Project, item: ArtifactNode): string[] {
  if (!isGitRepo(project.root)) return [];
  const files = new Set<string>();
  for (const c of commitsWithRefs(project.root, { withFiles: true })) {
    if (c.refs.includes(item.id)) for (const f of c.files ?? []) files.add(f);
  }
  if (item.status === 'in-progress') for (const f of changedFiles(project.root, resolveBase(project.root))) files.add(f);
  return [...files].filter((f) => !f.startsWith('.keel/')).sort();
}

/** Review pack (VG-7): what changed against the spec, evidence, risks and what to check, in one screen. */
export function reviewPack(project: Project, id: string, coverage: CoverageReport = computeCoverage(project)): string {
  const g = project.graph;
  const n = g.get(id);
  if (!n) throw new Error(`unknown artifact ${id}`);
  const lines: string[] = [];
  const b = budgetFor(project, n);
  const size = n.type === 'change' ? changeLines(project, n) : n.lines;
  lines.push(`## Review pack: ${n.id} ${n.title}`);
  lines.push(
    `${TYPES[n.type]?.label ?? n.type}${n.fm.track ? ` · ${String(n.fm.track)} track` : ''} · status ${n.status} · ${size} lines${b ? ` (budget ${b.limit})` : ''}`,
  );

  // What changed against the spec.
  const delta: string[] = [];
  for (const c of n.children.map((c) => g.get(c)!).filter((c) => c && c.type !== 'task')) {
    if (n.type === 'change') delta.push(`- ADDED ${c.id}: ${truncate(c.title, 70)}`);
  }
  for (const d of g.deltas.get(n.id) ?? []) delta.push(`- ${d.delta === 'modified' ? 'MODIFIED' : 'REMOVED'} ${d.id}: ${truncate(d.title, 70)}`);
  const drift = driftSinceApproval(project, n);
  if (drift) delta.push(`- Edited since approval${drift.items.length ? `: ${drift.items.join(', ')}` : ''}`);
  if (n.type !== 'change' && !drift && n.children.length) {
    const kinds = new Map<string, number>();
    for (const c of n.children) {
      const t = g.get(c)?.type ?? 'item';
      kinds.set(t, (kinds.get(t) ?? 0) + 1);
    }
    const plural: Record<string, string> = { criterion: 'criteria' };
    delta.push(`- Contains ${[...kinds].map(([k, v]) => `${v} ${v === 1 ? k : plural[k] ?? k + 's'}`).join(', ')}`);
  }
  if (delta.length) lines.push('', '**Changed against the spec**', ...delta.slice(0, 8), ...(delta.length > 8 ? [`- … ${delta.length - 8} more`] : []));

  // Evidence for work items.
  const criteria = g.criteriaOf(n.id);
  if (criteria.length) {
    const cov = itemCoverage(project, n, coverage);
    const covered = cov.filter((c) => c && (c.status === 'passed' || c.status === 'waived')).length;
    lines.push('', `**Evidence**: ${covered}/${criteria.length} criteria covered`);
    for (const c of cov.slice(0, 7)) {
      if (!c) continue;
      const label = { passed: 'PASS', failed: 'FAIL', waived: 'WAIVED', untested: 'NO TEST', 'not-run': 'NOT RUN', skipped: 'SKIPPED' }[c.status];
      const t = c.tests[0];
      lines.push(`- [${label}] ${c.id} ${truncate(c.title, 50)}${t ? ` ← ${t.file ?? ''} "${truncate(t.name, 40)}"` : c.waiver ? ` (waived: ${c.waiver.message ?? ''})` : ''}`);
    }
  }

  // Risks and deviations.
  const risks: string[] = [];
  const files = n.type === 'story' || n.type === 'change' ? filesForItem(project, n) : [];
  if (files.length) risks.push(`- Files changed: ${files.length} (${files.slice(0, 4).join(', ')}${files.length > 4 ? ', …' : ''})`);
  const sens = sensitiveMatch(files, project.config);
  if (sens) risks.push(`- Touches sensitive path ${sens.path} (${sens.reason})`);
  for (const e of (n.fm.escalations as { reason: string }[] | undefined) ?? []) risks.push(`- Escalated: ${e.reason}`);
  if (b && size > b.limit) risks.push(`- Over the ${b.key} budget by ${size - b.limit} lines`);
  const own = lintProject(project).filter((d) => d.id === n.id || n.children.includes(d.id ?? ''));
  for (const d of own.slice(0, 3)) risks.push(`- ${d.level === 'error' ? 'Error' : 'Warning'}: ${d.message}`);
  const down = downstreamOf(project, [n.id, ...n.children]);
  if (down.length && drift) risks.push(`- Downstream to re-check: ${down.map((d) => d.id).join(', ')}`);
  if (risks.length) lines.push('', '**Risks and deviations**', ...risks.slice(0, 7));

  const checks = CHECKS[n.type] ?? [];
  if (checks.length) lines.push('', '**What to check**', ...checks.map((c) => `- ${c}`));
  lines.push('', `Approve: \`keel approve ${n.id}\` · Return: \`keel reject ${n.id} -m "<what to change>"\``);
  return lines.join('\n');
}

export function saveReviewPack(project: Project, id: string, text: string): string {
  const file = path.join(project.paths.reviews, `${id}.md`);
  writeText(file, text + '\n');
  return path.relative(project.root, file).split(path.sep).join('/');
}

export function itemsInFiles(project: Project, files: string[]): string[] {
  const g = project.graph;
  const ids: string[] = [];
  for (const f of files) for (const n of g.topLevel()) if (n.file === f) ids.push(n.id);
  return uniq(ids);
}
