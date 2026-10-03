import { allSteps, type Stage, type Step, type Workflow } from './load.js';
import { TYPES } from '../model/registry.js';
import type { ArtifactNode, ArtifactType } from '../model/types.js';
import type { Project } from '../project.js';

export type StepStatus = 'done' | 'pending-review' | 'in-progress' | 'not-started' | 'skipped';

export interface StepState {
  stage: Stage;
  step: Step;
  status: StepStatus;
  artifacts: ArtifactNode[];
  progress?: { done: number; total: number };
}

export interface TrackState {
  workflow: Workflow;
  steps: StepState[];
  current?: StepState;
  done: boolean;
  /** The change this track runs for (change-scoped workflows). */
  subject?: ArtifactNode;
}

function producedArtifacts(project: Project, types: string[], subject?: ArtifactNode): ArtifactNode[] {
  if (subject) return types.includes(subject.type) ? [subject] : [];
  return types.flatMap((t) => (TYPES[t as ArtifactType] ? project.graph.byType(t as ArtifactType) : [])).filter((n) => !n.parent);
}

function stepStatus(project: Project, step: Step, artifacts: ArtifactNode[], subject?: ArtifactNode): StepStatus {
  if (step.when?.profile && !step.when.profile.includes(project.config.profile)) return 'skipped';
  const types = subject ? [subject.type] : step.produces;
  const missing = types.filter((t) => !artifacts.some((a) => a.type === t));
  if (!artifacts.length) return 'not-started';
  if (missing.length) return 'in-progress';
  if (artifacts.every((a) => step.done_when.includes(a.status))) return 'done';
  if (artifacts.some((a) => a.status === 'pending-review')) return 'pending-review';
  return 'in-progress';
}

export function evaluate(project: Project, workflow: Workflow, subject?: ArtifactNode): TrackState {
  const steps: StepState[] = allSteps(workflow).map(({ stage, step }) => {
    const artifacts = producedArtifacts(project, step.produces, subject);
    const status = stepStatus(project, step, artifacts, subject);
    const st: StepState = { stage, step, status, artifacts };
    if (step.foreach) st.progress = { done: artifacts.filter((a) => step.done_when.includes(a.status)).length, total: artifacts.length };
    return st;
  });
  if (!subject) {
    // A step nobody started, while later steps have work, was skipped (imports, brownfield, or by choice).
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      if (s.status !== 'not-started') continue;
      if (s.step.optional || steps.slice(i + 1).some((l) => l.status !== 'not-started' && l.status !== 'skipped')) s.status = 'skipped';
    }
  } else {
    // For a change, a later step that is done implies the earlier ones are done too.
    let laterDone = false;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (laterDone && steps[i]!.status !== 'done') steps[i]!.status = 'done';
      if (steps[i]!.status === 'done') laterDone = true;
    }
  }
  const current = steps.find((s) => s.status !== 'done' && s.status !== 'skipped');
  return { workflow, steps, current, done: !current, subject };
}

/** The project-scoped track (normally "product"). */
export function projectTrack(project: Project): TrackState | undefined {
  const wfs = [...project.workflows.values()].filter((w) => w.scope === 'project');
  const wf = wfs.find((w) => w.id === 'product') ?? wfs[0];
  return wf ? evaluate(project, wf) : undefined;
}

export function changeWorkflow(project: Project, change: ArtifactNode): Workflow | undefined {
  const track = String(change.fm.track ?? 'feature');
  return project.workflows.get(track) ?? [...project.workflows.values()].find((w) => w.scope === 'change');
}

export function changeTrack(project: Project, change: ArtifactNode): TrackState | undefined {
  const wf = changeWorkflow(project, change);
  return wf ? evaluate(project, wf, change) : undefined;
}

/** The step that owns a given artifact type in the project track, for skill and explain lookups. */
export function stepForType(project: Project, type: ArtifactType): { workflow: Workflow; step: Step; stage: Stage } | undefined {
  for (const wf of project.workflows.values()) {
    for (const s of allSteps(wf)) if (s.step.produces.includes(type) && !s.step.foreach) return { workflow: wf, ...s };
  }
  return undefined;
}

/** Which gate applies to finishing a work item: the gate of the current/next evidence step. */
export function gateFor(project: Project, item: ArtifactNode): Step['gate'] {
  if (item.type === 'release') return 'checklist';
  if (item.type === 'story' || item.type === 'change') return 'evidence';
  return 'approval';
}
