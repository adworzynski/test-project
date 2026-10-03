import path from 'node:path';
import YAML from 'yaml';
import { listDir, readText } from '../util/fs.js';
import { validateWithSchema } from '../schemas.js';
import type { Diagnostic } from '../model/types.js';

export type GateKind = 'none' | 'approval' | 'evidence' | 'checklist';

export interface Step {
  id: string;
  name: string;
  skill?: string;
  produces: string[];
  inputs: string[];
  gate: GateKind;
  done_when: string[];
  foreach: boolean;
  optional: boolean;
  command?: string;
  explain?: string;
  when?: { profile?: string[] };
}

export interface Stage {
  id: string;
  name: string;
  explain?: string;
  steps: Step[];
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  version?: string;
  scope: 'project' | 'change';
  budget?: string;
  stages: Stage[];
  file: string;
}

const DEFAULT_DONE: Record<GateKind, string[]> = {
  none: ['approved', 'accepted', 'in-progress', 'done', 'archived'],
  approval: ['approved', 'accepted', 'in-progress', 'done', 'archived'],
  evidence: ['done', 'archived'],
  checklist: ['done', 'archived'],
};

export function parseWorkflow(text: string, file: string): { workflow?: Workflow; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) {
    for (const e of doc.errors)
      diagnostics.push({ level: 'error', code: 'yaml', message: e.message.split('\n')[0]!, file, line: e.linePos?.[0]?.line });
    return { diagnostics };
  }
  const raw = doc.toJS() as Record<string, unknown>;
  const errs = validateWithSchema('workflow', raw);
  if (errs.length) {
    for (const e of errs) diagnostics.push({ level: 'error', code: 'workflow-schema', message: e, file, line: 1 });
    return { diagnostics };
  }
  const stages = (raw.stages as Record<string, unknown>[]).map((s) => ({
    id: String(s.id),
    name: String(s.name),
    explain: s.explain as string | undefined,
    steps: (s.steps as Record<string, unknown>[]).map((st) => {
      const gate = (st.gate as GateKind) ?? 'none';
      const produces = st.produces === undefined ? [] : Array.isArray(st.produces) ? st.produces.map(String) : [String(st.produces)];
      return {
        id: String(st.id),
        name: String(st.name),
        skill: st.skill as string | undefined,
        produces,
        inputs: ((st.inputs as string[]) ?? []).map(String),
        gate,
        done_when: ((st.done_when as string[]) ?? DEFAULT_DONE[gate]).map(String),
        foreach: Boolean(st.foreach),
        optional: Boolean(st.optional),
        command: st.command as string | undefined,
        explain: st.explain as string | undefined,
        when: st.when as Step['when'],
      } satisfies Step;
    }),
  }));
  const ids = new Set<string>();
  for (const st of stages.flatMap((s) => s.steps)) {
    if (ids.has(st.id)) diagnostics.push({ level: 'error', code: 'workflow-dup-step', message: `duplicate step id "${st.id}"`, file });
    ids.add(st.id);
  }
  return {
    workflow: {
      id: String(raw.id),
      name: String(raw.name),
      description: raw.description as string | undefined,
      version: raw.version as string | undefined,
      scope: raw.scope as Workflow['scope'],
      budget: raw.budget as string | undefined,
      stages,
      file,
    },
    diagnostics,
  };
}

export function loadWorkflows(dir: string): { workflows: Map<string, Workflow>; diagnostics: Diagnostic[] } {
  const workflows = new Map<string, Workflow>();
  const diagnostics: Diagnostic[] = [];
  for (const f of listDir(dir).sort()) {
    if (!/\.ya?ml$/.test(f)) continue;
    const rel = `.keel/workflows/${f}`;
    const { workflow, diagnostics: d } = parseWorkflow(readText(path.join(dir, f)), rel);
    diagnostics.push(...d);
    if (workflow) {
      if (workflows.has(workflow.id))
        diagnostics.push({ level: 'error', code: 'workflow-dup', message: `two workflows use id "${workflow.id}"`, file: rel });
      workflows.set(workflow.id, workflow);
    }
  }
  return { workflows, diagnostics };
}

export function allSteps(w: Workflow): { stage: Stage; step: Step }[] {
  return w.stages.flatMap((stage) => stage.steps.map((step) => ({ stage, step })));
}

export function findStep(w: Workflow, id: string): { stage: Stage; step: Step } | undefined {
  return allSteps(w).find((s) => s.step.id === id);
}
