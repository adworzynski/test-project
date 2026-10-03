import { changeTrack, projectTrack, type TrackState } from './engine.js';
import { lintProject } from './lint.js';
import { computeCoverage, uncoveredFor, type CoverageReport } from '../verify/coverage.js';
import { summarizeCost } from '../ledger/ledger.js';
import { lastDecision } from './gates.js';
import { DONE_STATUSES, FILE_TYPES, TYPES } from '../model/registry.js';
import { cmpId } from '../graph/graph.js';
import { loadWorkflows } from './load.js';
import type { ArtifactNode } from '../model/types.js';
import type { Project } from '../project.js';

export interface NextAction {
  title: string;
  why: string;
  /** Shell command to run, if any. */
  command?: string;
  /** Agent skill to run, if any. */
  skill?: string;
  actor: 'human' | 'agent';
  ref?: string;
}

export interface WorkItemState {
  id: string;
  type: string;
  title: string;
  status: string;
  track?: string;
  step?: string;
  criteria: number;
  uncovered: string[];
  failing: string[];
}

export interface StatusData {
  project: string;
  profile: string;
  stack: string;
  phase: { workflow: string; stage: string; step: string; status: string } | null;
  track: { stage: string; step: string; name: string; status: string; progress?: { done: number; total: number } }[];
  artifacts: Record<string, Record<string, number>>;
  openGates: { id: string; title: string; type: string }[];
  needsReview: { id: string; reason: string }[];
  blocked: { id: string; reason: string }[];
  active: WorkItemState[];
  coverage: { total: number; covered: number; passed: number; failed: number; untested: number; notRun: number; waived: number; percent: number };
  cost: { usd: number; tokens: number; unreported: number; unknownCost: number };
  checks: { errors: number; warnings: number };
  next: NextAction[];
}

export interface StatusContext {
  project: Project;
  track?: TrackState;
  coverage: CoverageReport;
}

function storyBlockers(project: Project, s: ArtifactNode): string | undefined {
  const deps = (s.links.depends_on ?? []).map((d) => project.graph.get(d)).filter(Boolean) as ArtifactNode[];
  const open = deps.filter((d) => !DONE_STATUSES.has(d.status));
  return open.length ? `waits for ${open.map((d) => d.id).join(', ')}` : undefined;
}

/** Stack ADRs must be accepted before the first story starts (DP-4). */
export function missingStackAdrs(project: Project): boolean {
  if (!project.config.planning.require_stack_adrs) return false;
  return !project.graph.byType('adr').some((a) => a.status === 'accepted');
}

export function workItemState(project: Project, n: ArtifactNode, coverage: CoverageReport): WorkItemState {
  const crit = project.graph.criteriaOf(n.id);
  const unc = uncoveredFor(project, n, coverage);
  const track = n.type === 'change' ? changeTrack(project, n) : undefined;
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    status: n.status,
    track: n.type === 'change' ? String(n.fm.track ?? 'feature') : undefined,
    step: track?.current?.step.id,
    criteria: crit.length,
    uncovered: unc.map((c) => c.id),
    failing: unc.filter((c) => c.status === 'failed').map((c) => c.id),
  };
}

function skillHint(skill?: string): string {
  return skill ? `In your agent, run the ${skill} skill (Claude Code: /${skill})` : '';
}

function firstSentence(text?: string): string | undefined {
  const m = text?.match(/^[^.]*\./);
  return m ? m[0].trim() : undefined;
}

/** The 1–3 next actions (NV-2). Never empty. */
export function computeNext(ctx: StatusContext): NextAction[] {
  const { project, track, coverage } = ctx;
  const g = project.graph;
  const actions: NextAction[] = [];
  const push = (a: NextAction) => {
    if (!actions.some((x) => x.title === a.title)) actions.push(a);
  };

  const checks = [...g.diagnostics, ...loadWorkflows(project.paths.workflows).diagnostics].filter((d) => d.level === 'error');
  if (checks.length) {
    const d = checks[0]!;
    push({
      title: `Fix ${checks.length === 1 ? 'an error' : `${checks.length} errors`} in .keel (${d.file ?? ''}${d.line ? ':' + d.line : ''}: ${d.message})`,
      why: 'Keel cannot trust the graph until artifacts are valid.',
      command: 'keel check',
      actor: 'agent',
    });
  }

  // 1. Human gates waiting.
  for (const n of g.topLevel().filter((n) => n.status === 'pending-review').sort((a, b) => cmpId(a.id, b.id))) {
    push({
      title: `Review ${n.id} (${n.title}) and approve or reject it`,
      why: `${TYPES[n.type].label} ${n.id} is waiting at an approval gate.`,
      command: `keel review ${n.id} && keel approve ${n.id}`,
      actor: 'human',
      ref: n.id,
    });
  }
  // 2. Needs review after an upstream refinement.
  for (const n of g.topLevel().filter((n) => n.fm.needs_review)) {
    push({
      title: `Re-check ${n.id}: ${String(n.fm.needs_review)}`,
      why: 'An upstream artifact it depends on changed after approval.',
      command: `keel trace ${n.id} && keel approve ${n.id}`,
      actor: 'human',
      ref: n.id,
    });
  }
  // 3. Rejected work goes back to its author.
  for (const n of g.topLevel().filter((n) => n.status === 'rejected')) {
    const d = lastDecision(project.paths, n.id, ['rejected']);
    push({
      title: `Rework ${n.id} after rejection${d?.message ? `: "${d.message}"` : ''}`,
      why: 'A reviewer returned it.',
      command: `keel review ${n.id} --request`,
      actor: 'agent',
      ref: n.id,
    });
  }
  // 4. Work in progress first.
  const inProgress = g.activeWork().filter((n) => n.status === 'in-progress').sort((a, b) => cmpId(a.id, b.id));
  for (const n of inProgress) {
    const st = workItemState(project, n, coverage);
    if (st.uncovered.length) {
      push({
        title: `Continue ${n.id} (${n.title}): ${st.uncovered.length} of ${st.criteria} criteria lack a passing test (${st.uncovered.slice(0, 4).join(', ')}${st.uncovered.length > 4 ? ', …' : ''})`,
        why: 'Done needs a passing linked test for every criterion.',
        command: `keel context ${n.id}`,
        skill: 'keel-implement',
        actor: 'agent',
        ref: n.id,
      });
    } else {
      push({
        title: `Mark ${n.id} done; every criterion has evidence`,
        why: 'All criteria are covered by passing tests or waivers.',
        command: `keel done ${n.id}`,
        actor: 'agent',
        ref: n.id,
      });
    }
  }
  // 5. Changes not yet started.
  for (const ch of g.byType('change').filter((c) => !DONE_STATUSES.has(c.status) && c.status !== 'in-progress' && c.status !== 'pending-review' && c.status !== 'rejected')) {
    const t = changeTrack(project, ch);
    const step = t?.current?.step;
    if (!step) continue;
    if (ch.status === 'approved') {
      push({ title: `Start ${ch.id} (${ch.title})`, why: `${t!.workflow.name}: the plan is ready.`, command: `keel start ${ch.id}`, skill: 'keel-implement', actor: 'agent', ref: ch.id });
    } else if (step.gate === 'approval') {
      push({
        title: `Finish the change note ${ch.id} and request review`,
        why: `${t!.workflow.name}: ${step.name} ends at an approval gate.`,
        command: `keel review ${ch.id} --request`,
        skill: step.skill,
        actor: 'agent',
        ref: ch.id,
      });
    } else {
      push({
        title: `Finish the change note ${ch.id}, then start it`,
        why: `${t!.workflow.name}: ${step.name}.`,
        command: `keel start ${ch.id}`,
        skill: step.skill,
        actor: 'agent',
        ref: ch.id,
      });
    }
  }
  // 6. The product track.
  const cur = track?.current;
  if (cur) {
    const { step } = cur;
    const drafts = cur.artifacts.filter((a) => a.status === 'draft' || a.status === 'proposed');
    if (step.foreach) {
      const startable = cur.artifacts
        .filter((s) => (s.status === 'approved' || s.status === 'draft') && !storyBlockers(project, s))
        .sort((a, b) => cmpId(a.id, b.id));
      if (missingStackAdrs(project)) {
        push({ title: 'Accept the stack ADRs before the first story', why: 'Stories start only after stack decisions are recorded (DP-4).', skill: 'keel-architecture', command: 'keel add adr "<decision>"', actor: 'agent' });
      } else if (startable[0] && !inProgress.length) {
        push({
          title: `Start ${startable[0].id} (${startable[0].title})`,
          why: `Build: ${cur.progress?.done ?? 0} of ${cur.progress?.total ?? 0} stories done.`,
          command: `keel start ${startable[0].id}`,
          skill: step.skill,
          actor: 'agent',
          ref: startable[0].id,
        });
      }
    } else if (cur.status === 'not-started') {
      const type = step.produces[0] ?? '';
      push({
        title: `${cur.stage.name}: ${step.name}`,
        why: `${firstSentence(step.explain) ?? `Next step of the ${track!.workflow.name}.`} ${step.skill ? skillHint(step.skill) : 'Start a draft from the template'}, or start a draft with the command.`,
        command: type === 'release' ? 'keel release <version>' : `keel add ${type} "<title>"`,
        skill: step.skill,
        actor: 'agent',
      });
    } else if (step.gate === 'checklist') {
      for (const r of cur.artifacts.filter((a) => !DONE_STATUSES.has(a.status))) {
        const open = g.files.get(r.file)?.checkboxes.filter((c) => !c.checked).length ?? 0;
        push({
          title: open ? `Tick the ${open} open items in ${r.id}` : `Mark ${r.id} done`,
          why: 'The release is done only when every checklist item is ticked; the submit step is yours.',
          command: `keel done ${r.id}`,
          skill: step.skill,
          actor: 'human',
          ref: r.id,
        });
      }
    } else if (drafts.length) {
      for (const d of drafts.slice(0, 2))
        push({
          title: `Finish ${d.id} (${d.title}) and request review`,
          why: `${step.name} ends at an approval gate.`,
          command: `keel review ${d.id} --request`,
          skill: step.skill,
          actor: 'agent',
          ref: d.id,
        });
    } else if (cur.status === 'in-progress') {
      const missing = step.produces.filter((t) => !cur.artifacts.some((a) => a.type === t));
      for (const t of missing)
        push({ title: `${step.name}: create the ${TYPES[t as keyof typeof TYPES]?.label ?? t}`, why: `This step produces ${step.produces.join(' and ')}.`, command: `keel add ${t} "<title>"`, skill: step.skill, actor: 'agent' });
    }
  }
  if (!actions.length) {
    if (!project.graph.topLevel().length) {
      push({ title: 'Discovery: one-page brief', why: `${skillHint('keel-discovery')}, or start a draft with the command.`, command: 'keel add brief "<app name>"', skill: 'keel-discovery', actor: 'agent' });
    } else {
      push({
        title: 'All caught up. Start the next change',
        why: 'Nothing is in progress or waiting for review.',
        command: 'keel new "<what you want to change>"',
        skill: 'keel-change',
        actor: 'agent',
      });
    }
  }
  return actions.slice(0, 3);
}

export function computeStatus(project: Project): StatusData {
  const g = project.graph;
  const track = projectTrack(project);
  const coverage = computeCoverage(project);
  const ctx: StatusContext = { project, track, coverage };

  const artifacts: StatusData['artifacts'] = {};
  for (const n of g.topLevel()) {
    if (!FILE_TYPES.includes(n.type)) continue;
    (artifacts[n.type] ??= {})[n.status] = ((artifacts[n.type] ?? {})[n.status] ?? 0) + 1;
  }
  const blocked: StatusData['blocked'] = [];
  for (const s of g.byType('story')) {
    if (DONE_STATUSES.has(s.status)) continue;
    const b = storyBlockers(project, s);
    if (b) blocked.push({ id: s.id, reason: b });
  }
  for (const n of g.topLevel().filter((n) => n.status === 'rejected')) blocked.push({ id: n.id, reason: 'rejected at review' });
  const active = g
    .activeWork()
    .filter((n) => n.status === 'in-progress' || n.type === 'change')
    .sort((a, b) => cmpId(a.id, b.id))
    .map((n) => workItemState(project, n, coverage));
  for (const a of active) if (a.failing.length) blocked.push({ id: a.id, reason: `failing tests for ${a.failing.join(', ')}` });

  const lint = [...g.diagnostics, ...lintProject(project), ...loadWorkflows(project.paths.workflows).diagnostics];
  const cost = summarizeCost(project);
  const t = coverage.totals;
  return {
    project: project.config.project,
    profile: project.config.profile,
    stack: project.config.stack,
    phase: track?.current
      ? { workflow: track.workflow.id, stage: track.current.stage.name, step: track.current.step.name, status: track.current.status }
      : null,
    track: (track?.steps ?? []).map((s) => ({ stage: s.stage.name, step: s.step.id, name: s.step.name, status: s.status, progress: s.progress })),
    artifacts,
    openGates: g
      .topLevel()
      .filter((n) => n.status === 'pending-review')
      .map((n) => ({ id: n.id, title: n.title, type: n.type })),
    needsReview: g
      .topLevel()
      .filter((n) => n.fm.needs_review)
      .map((n) => ({ id: n.id, reason: String(n.fm.needs_review) })),
    blocked,
    active,
    coverage: {
      total: t.total,
      covered: t.covered,
      passed: t.passed,
      failed: t.failed,
      untested: t.untested,
      notRun: t['not-run'] + t.skipped,
      waived: t.waived,
      percent: t.total ? Math.round((t.covered / t.total) * 100) : 0,
    },
    cost: { usd: Number(cost.usd.toFixed(4)), tokens: cost.tokens, unreported: cost.unreported.length, unknownCost: cost.unknownCost },
    checks: { errors: lint.filter((d) => d.level === 'error').length, warnings: lint.filter((d) => d.level === 'warning').length },
    next: computeNext(ctx),
  };
}
