import { createArtifact, setStatus, updateFrontMatter } from '../graph/write.js';
import { recordGate } from '../workflow/gates.js';
import { itemHashes, driftSinceApproval, downstreamOf } from '../workflow/refine.js';
import { route, sensitiveMatch, type RouteDecision, type Track } from '../workflow/router.js';
import { changeTrack, changeWorkflow } from '../workflow/engine.js';
import { lintProject, budgetFor, changeLines } from '../workflow/lint.js';
import { missingStackAdrs } from '../workflow/status.js';
import { computeCoverage, uncoveredFor, type CriterionCoverage } from '../verify/coverage.js';
import { reviewPack, saveReviewPack, filesForItem } from '../verify/review.js';
import { mergeDelta, generateSpec } from '../spec/living.js';
import { estimateStepCost } from '../ledger/ledger.js';
import { changedFiles, diffStat, resolveBase, isGitRepo } from '../util/git.js';
import { currentUser } from '../util/user.js';
import { KeelError } from '../util/errors.js';
import { nowIso, today, truncate } from '../util/text.js';
import { DONE_STATUSES, FILE_TYPES, TYPES, isApproved } from '../model/registry.js';
import type { ArtifactNode, ArtifactType } from '../model/types.js';
import type { Project } from '../project.js';

function need(project: Project, id: string): ArtifactNode {
  const n = project.graph.get(id.toUpperCase());
  if (!n) throw new KeelError(`Unknown artifact ${id}. \`keel status\` lists what exists.`);
  return n;
}

function needTop(project: Project, id: string): ArtifactNode {
  const n = need(project, id);
  if (n.parent) throw new KeelError(`${n.id} is a section of ${n.parent}. Use ${n.parent} instead.`);
  return n;
}

/** Next free IDs for template placeholders. */
export function templateVars(project: Project): Record<string, string> {
  const g = project.graph;
  return {
    next_fr: g.nextId('requirement', 'FR'),
    next_nfr: g.nextId('requirement', 'NFR'),
    next_ac: g.nextId('criterion', 'AC'),
    next_sc: g.nextId('screen', 'SC'),
    next_tk: g.nextId('task', 'TK'),
    description: '',
  };
}

const ADDABLE: ArtifactType[] = ['brief', 'prd', 'screen-map', 'design-tokens', 'adr', 'story'];

/** `keel add <type> "<title>"`: a draft from the template, ready for an agent to fill. */
export function addArtifact(project: Project, type: string, title: string, links: Record<string, string[]> = {}): { id: string; file: string } {
  const t = type as ArtifactType;
  if (t === 'change') throw new KeelError('Use `keel new "<description>"` to start a change; Keel routes it to Quick or Feature.');
  if (t === 'release') throw new KeelError('Use `keel release <version>` to create a release checklist.');
  if (!ADDABLE.includes(t)) throw new KeelError(`Can't add "${type}". Types: ${ADDABLE.join(', ')}.`);
  for (const ids of Object.values(links)) for (const id of ids) need(project, id);
  return createArtifact(project, { type: t, title, links, vars: templateVars(project) });
}

export interface NewChangeResult {
  id: string;
  file: string;
  decision: RouteDecision;
  overridden: boolean;
}

/** `keel new`: route a change (WF-3) and create its note from the track's template. */
export function newChange(
  project: Project,
  description: string,
  opts: { track?: Track; paths?: string[]; title?: string; affects?: string[] } = {},
): NewChangeResult {
  if (!description.trim()) throw new KeelError('Describe the change, e.g. keel new "Fix crash when a habit name has an emoji".');
  let paths = opts.paths ?? [];
  let lines: Map<string, number> | undefined;
  let inferredPaths = false;
  if (!paths.length && isGitRepo(project.root)) {
    paths = changedFiles(project.root).filter((f) => !f.startsWith('.keel/'));
    if (paths.length) {
      lines = diffStat(project.root);
      inferredPaths = true;
    }
  }
  const decision = route({ description, paths, lines, inferredPaths }, project.config);
  let track = decision.track;
  let overridden = false;
  if (opts.track && opts.track !== track) {
    if (decision.escalation && opts.track === 'quick')
      throw new KeelError(`Can't force Quick: ${decision.escalation.path} is a sensitive path (${decision.escalation.reason}).`);
    decision.reasons.push(`overridden to ${opts.track} by ${currentUser(project.root)}`);
    track = opts.track;
    overridden = true;
  }
  decision.track = track;
  for (const a of opts.affects ?? []) need(project, a);
  const title = opts.title ?? truncate(description.split(/[.\n]/)[0]!.trim(), 70);
  const { id, file } = createArtifact(project, {
    type: 'change',
    title,
    template: track === 'quick' ? 'change-quick.md' : 'change-feature.md',
    vars: { ...templateVars(project), description: description.trim() },
    links: opts.affects?.length ? { affects: opts.affects.map((a) => a.toUpperCase()) } : {},
    extra: {
      track,
      route: { track, reasons: decision.reasons, override: overridden },
      ...(decision.escalation ? { escalations: [{ from: 'quick', to: 'feature', reason: decision.escalation.reason, path: decision.escalation.path, at: nowIso() }] } : {}),
      ...(paths.length ? { files: paths.slice(0, 20) } : {}),
    },
  });
  return { id, file, decision, overridden };
}

/** `keel route <id>`: override the track in one command, or re-check a Quick change against its diff (WF-4). */
export function rerouteChange(project: Project, id: string, opts: { track?: Track } = {}): { track: Track; escalated?: { path: string; reason: string }; changed: boolean } {
  const ch = needTop(project, id);
  if (ch.type !== 'change') throw new KeelError(`${ch.id} is not a change.`);
  const current = String(ch.fm.track ?? 'feature') as Track;
  if (opts.track) {
    const files = filesForItem(project, ch);
    const sens = sensitiveMatch([...files, ...((ch.fm.files as string[]) ?? [])], project.config);
    if (opts.track === 'quick' && sens) throw new KeelError(`Can't move ${ch.id} to Quick: it touches ${sens.path} (${sens.reason}).`);
    if (opts.track === current) return { track: current, changed: false };
    const r = (ch.fm.route as Record<string, unknown>) ?? {};
    updateFrontMatter(project, ch.file, {
      track: opts.track,
      route: { ...r, track: opts.track, override: true, reasons: [...((r.reasons as string[]) ?? []), `overridden to ${opts.track} by ${currentUser(project.root)}`] },
    });
    return { track: opts.track, changed: true };
  }
  const esc = escalateIfSensitive(project, ch);
  return { track: esc ? 'feature' : current, escalated: esc, changed: !!esc };
}

/** Moves a Quick change to Feature when its files touch a sensitive path; returns the match. */
export function escalateIfSensitive(project: Project, ch: ArtifactNode): { path: string; reason: string } | undefined {
  if (String(ch.fm.track ?? '') !== 'quick') return undefined;
  const files = [...filesForItem(project, ch), ...((ch.fm.files as string[]) ?? [])];
  const sens = sensitiveMatch(files, project.config);
  if (!sens) return undefined;
  const escalations = [...((ch.fm.escalations as unknown[]) ?? []), { from: 'quick', to: 'feature', reason: sens.reason, path: sens.path, at: nowIso() }];
  // A Feature change needs plan approval before building; send it back to review.
  const featureWf = project.workflows.get('feature');
  const needsApproval = featureWf?.stages[0]?.steps[0]?.gate === 'approval';
  updateFrontMatter(project, ch.file, {
    track: 'feature',
    escalations,
    ...(needsApproval && ch.status !== 'approved' ? { status: 'draft' } : {}),
  });
  return sens;
}

/** `keel review <id> [--request]`: build the review pack; with request, move to pending-review. */
export function review(project: Project, id: string, opts: { request?: boolean } = {}): { pack: string; file?: string; status: string } {
  const n = needTop(project, id);
  if (opts.request) {
    if (!['draft', 'rejected', 'proposed', 'approved', 'accepted', 'pending-review'].includes(n.status) && !n.fm.needs_review)
      throw new KeelError(`${n.id} is ${n.status}; only drafts and returned artifacts go to review.`);
    const errors = lintProject(project).filter((d) => d.level === 'error' && (d.id === n.id || n.children.includes(d.id ?? '')));
    const graphErrors = project.graph.diagnostics.filter((d) => d.level === 'error' && d.file === n.file);
    if (errors.length || graphErrors.length)
      throw new KeelError(`${n.id} has errors to fix before review:`, 1, [...graphErrors, ...errors].map((d) => `${d.file ?? ''}${d.line ? ':' + d.line : ''} ${d.message}`));
    const b = budgetFor(project, n);
    const size = n.type === 'change' ? changeLines(project, n) : n.lines;
    if (b && size > b.limit && !n.fm.imported)
      throw new KeelError(`${n.id} is ${size} lines, over the ${b.key} budget of ${b.limit}. Summarize or split it, then request review again.`);
    setStatus(project, n.id, 'pending-review');
  }
  const pack = reviewPack(project, n.id);
  const file = opts.request ? saveReviewPack(project, n.id, pack) : undefined;
  return { pack, file, status: project.graph.get(n.id)!.status };
}

/** `keel approve <id>` (WF-5): records who, when and the artifact hash; sets the approved status. */
export function approve(project: Project, id: string, opts: { message?: string; force?: boolean } = {}): { id: string; status: string; by: string; hash: string } {
  const n = needTop(project, id);
  if (DONE_STATUSES.has(n.status)) {
    if (!n.fm.needs_review) throw new KeelError(`${n.id} is already ${n.status}.`);
  }
  if (n.type === 'change' || n.type === 'story') {
    const errs = lintProject(project).filter((d) => d.level === 'error' && (d.id === n.id || n.children.includes(d.id ?? '')));
    if (errs.length && !opts.force)
      throw new KeelError(`${n.id} can't be approved yet:`, 1, errs.map((e) => e.message).concat('Use --force to approve anyway.'));
  }
  const by = currentUser(project.root);
  recordGate(project.paths, n.id, { decision: 'approved', by, hash: n.hash, items: itemHashes(project, n), message: opts.message });
  const keep = ['in-progress', 'done', 'archived', 'accepted'].includes(n.status) && n.fm.needs_review;
  const status = keep ? n.status : TYPES[n.type].approvedStatus;
  updateFrontMatter(project, n.file, { status, needs_review: null });
  if (n.type === 'prd') generateSpec(project);
  return { id: n.id, status, by, hash: n.hash };
}

export function reject(project: Project, id: string, message: string): { id: string; by: string } {
  if (!message?.trim()) throw new KeelError('Say what to change: keel reject <id> -m "<reason>".');
  const n = needTop(project, id);
  const by = currentUser(project.root);
  recordGate(project.paths, n.id, { decision: 'rejected', by, hash: n.hash, message });
  setStatus(project, n.id, 'rejected');
  return { id: n.id, by };
}

/** `keel waive AC-…` (VG-2): a human accepts a criterion without an automated test, with a reason. */
export function waive(project: Project, id: string, reason: string, opts: { revoke?: boolean } = {}): { id: string; by: string } {
  const c = need(project, id);
  if (c.type !== 'criterion') throw new KeelError(`${c.id} is not an acceptance criterion; only criteria can be waived.`);
  const by = currentUser(project.root);
  if (opts.revoke) {
    recordGate(project.paths, c.id, { decision: 'rejected', by, message: reason || 'waiver revoked' });
    return { id: c.id, by };
  }
  if (!reason?.trim()) throw new KeelError('A waiver needs a reason: keel waive AC-… -m "<why no automated test>".');
  recordGate(project.paths, c.id, { decision: 'waived', by, hash: c.hash, message: reason });
  return { id: c.id, by };
}

/** Pre-run estimate for a work item's build step, from past runs in the ledger (RC-4). */
export function costEstimate(project: Project, id: string): { step: string; usd: number; over: boolean } | undefined {
  const n = project.graph.get(id.toUpperCase());
  if (!n) return undefined;
  const step = n.type === 'change' ? changeTrack(project, n)?.steps.find((s) => s.step.gate === 'evidence')?.step.id : 'implement';
  const usd = step ? estimateStepCost(project, step) : undefined;
  if (!step || usd === undefined) return undefined;
  return { step, usd, over: usd > project.config.budgets.cost_warn_usd };
}

export interface StartResult {
  id: string;
  warnings: string[];
  costEstimate?: number;
}

/** `keel start <id>`: checks a story or change may begin, then marks it in-progress. */
export function start(project: Project, id: string, opts: { force?: boolean } = {}): StartResult {
  const n = needTop(project, id);
  const warnings: string[] = [];
  if (n.type !== 'story' && n.type !== 'change') throw new KeelError(`Only stories and changes are started; ${n.id} is a ${n.type}.`);
  if (n.status === 'in-progress') return { id: n.id, warnings: [`${n.id} is already in progress.`] };
  if (DONE_STATUSES.has(n.status)) throw new KeelError(`${n.id} is already ${n.status}.`);
  const problems: string[] = [];
  if (n.status === 'pending-review') problems.push(`${n.id} is waiting for review; approve it first (keel approve ${n.id}).`);
  if (n.type === 'story') {
    if (n.status !== 'approved') problems.push(`${n.id} is ${n.status}; stories start after approval (keel approve ${n.id}).`);
    if (missingStackAdrs(project)) problems.push('No accepted stack ADR yet (DP-4). Run the keel-architecture skill and approve the ADRs first.');
    const open = (n.links.depends_on ?? []).filter((d) => !DONE_STATUSES.has(project.graph.get(d)?.status ?? ''));
    if (open.length) problems.push(`${n.id} depends on ${open.join(', ')}, not done yet.`);
  } else {
    const wf = changeWorkflow(project, n);
    const first = wf?.stages[0]?.steps[0];
    if (first?.gate === 'approval' && n.status !== 'approved') problems.push(`${n.id} is on the ${wf!.name}, which needs plan approval first (keel review ${n.id} --request, then keel approve ${n.id}).`);
  }
  if (problems.length && !opts.force) throw new KeelError(`Can't start ${n.id}:`, 1, [...problems, 'Use --force to start anyway.']);
  if (problems.length) warnings.push(...problems.map((p) => `forced: ${p}`));
  const est = costEstimate(project, n.id);
  const costEstimateUsd = est?.usd;
  if (est?.over) warnings.push(`Past runs of the ${est.step} step averaged $${est.usd.toFixed(2)}, above your $${project.config.budgets.cost_warn_usd} warning threshold.`);
  setStatus(project, n.id, 'in-progress', { started: nowIso() });
  return { id: n.id, warnings, costEstimate: costEstimateUsd };
}

export interface DoneResult {
  id: string;
  status: string;
  merged?: string[];
  review?: string;
}

export class EvidenceRefusal extends KeelError {
  constructor(
    readonly id: string,
    readonly uncovered: CriterionCoverage[],
  ) {
    super(
      `${id} can't be marked done: ${uncovered.length} criteri${uncovered.length === 1 ? 'on has' : 'a have'} no passing linked test.`,
      2,
      uncovered.map((c) => `${c.id} ${c.title}: ${c.status === 'failed' ? 'test failing' : c.status === 'not-run' ? 'linked test not run' : c.status === 'skipped' ? 'test skipped' : 'no linked test'}`).concat(
        'Tag a test with `@keel <AC-id>`, run `keel verify --run --record`, then try again. Only a human can waive: `keel waive <AC-id> -m "<reason>"`.',
      ),
    );
  }
}

/** `keel done <id>`: the evidence gate (VG-2) for stories and changes, the checklist gate for releases. */
export function done(project: Project, id: string): DoneResult {
  const n = needTop(project, id);
  const g = project.graph;
  if (DONE_STATUSES.has(n.status)) throw new KeelError(`${n.id} is already ${n.status}.`);
  const by = currentUser(project.root);
  if (n.type === 'story' || n.type === 'change') {
    if (n.status !== 'in-progress') throw new KeelError(`${n.id} is ${n.status}; start it first (keel start ${n.id}).`);
    if (n.type === 'change') {
      const esc = escalateIfSensitive(project, n);
      if (esc) {
        const nn = project.graph.get(n.id)!;
        throw new KeelError(`${n.id} touches ${esc.path} (${esc.reason}), so Keel moved it to the Feature track.`, 1, [
          nn.status === 'draft' ? `Add a short design section, then keel review ${n.id} --request and keel approve ${n.id}.` : 'Continue on the Feature track.',
        ]);
      }
    }
    const coverage = computeCoverage(project);
    const crit = g.criteriaOf(n.id);
    if (!crit.length) throw new KeelError(`${n.id} has no acceptance criteria, so nothing proves it works. Add at least one "### AC-…" section.`);
    const unc = uncoveredFor(project, n, coverage);
    if (unc.length) throw new EvidenceRefusal(n.id, unc);
    recordGate(project.paths, n.id, {
      decision: 'done',
      by,
      hash: n.hash,
      evidence: crit.map((c) => `${c.id}:${coverage.byId.get(c.id)?.status}`).join(' '),
    });
    const pack = reviewPack(project, n.id, coverage);
    const reviewFile = saveReviewPack(project, n.id, pack);
    if (n.type === 'change') {
      const merged = mergeDelta(project, g.get(n.id)!);
      generateSpec(project);
      return { id: n.id, status: 'archived', merged, review: reviewFile };
    }
    setStatus(project, n.id, 'done');
    generateSpec(project);
    return { id: n.id, status: 'done', review: reviewFile };
  }
  if (n.type === 'release') {
    const open = (g.files.get(n.file)?.checkboxes ?? []).filter((c) => !c.checked);
    const problems: string[] = [];
    if (open.length) problems.push(...open.map((c) => `[ ] ${c.text} (line ${c.line})`));
    const unfinished = [...g.byType('story'), ...g.byType('change')].filter((s) => !DONE_STATUSES.has(s.status));
    if (unfinished.length) problems.push(`Unfinished: ${unfinished.map((s) => s.id).join(', ')}`);
    const coverage = computeCoverage(project);
    const unc = coverage.criteria.filter((c) => c.status !== 'passed' && c.status !== 'waived');
    if (unc.length) problems.push(`Criteria without passing evidence: ${unc.map((c) => c.id).join(', ')}`);
    if (problems.length) throw new KeelError(`${n.id} can't be marked done yet:`, 2, problems);
    recordGate(project.paths, n.id, { decision: 'done', by, hash: n.hash, message: `released ${String(n.fm.version ?? '')}` });
    setStatus(project, n.id, 'done', { released: today() });
    return { id: n.id, status: 'done' };
  }
  throw new KeelError(`${n.id} is a ${TYPES[n.type].label}; it finishes with an approval (keel approve ${n.id}), not keel done.`);
}

export interface RefineResult {
  artifact: string;
  items: string[];
  downstream: { id: string; title: string; type: string }[];
  tests: { criterion: string; file?: string; name: string }[];
  applied: boolean;
}

/** `keel refine [<id>] [--apply]` (AG-4): impact preview of an in-place edit, then flags downstream for review. */
export function refine(project: Project, id?: string, opts: { apply?: boolean } = {}): RefineResult[] {
  const g = project.graph;
  const targets = id ? [needTop(project, id)] : g.topLevel().filter((n) => isApproved(n.status));
  const out: RefineResult[] = [];
  const coverage = computeCoverage(project);
  for (const n of targets) {
    const d = driftSinceApproval(project, n);
    if (!d) continue;
    const roots = d.items.length ? d.items : [n.id];
    const down = downstreamOf(project, roots).filter((x) => x.id !== n.id && FILE_TYPES.includes(x.type));
    const tests: RefineResult['tests'] = [];
    for (const x of down)
      for (const c of g.criteriaOf(x.id)) for (const t of coverage.byId.get(c.id)?.tests ?? []) tests.push({ criterion: c.id, file: t.file, name: t.name });
    if (opts.apply) {
      const reason = `${roots.join(', ')} changed on ${today()}`;
      for (const x of down) updateFrontMatter(project, x.file, { needs_review: reason });
      setStatus(project, n.id, 'pending-review');
    }
    out.push({ artifact: n.id, items: d.items, downstream: down.map((x) => ({ id: x.id, title: x.title, type: x.type })), tests, applied: !!opts.apply });
  }
  if (id && !out.length) {
    const n = needTop(project, id);
    if (!isApproved(n.status)) throw new KeelError(`${n.id} is ${n.status}; refine applies to approved artifacts. Edit it freely until it is approved.`);
  }
  return out;
}

export { resolveBase };
