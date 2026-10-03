import path from 'node:path';
import YAML from 'yaml';
import { readTextIf, writeText } from '../util/fs.js';
import { nowIso } from '../util/text.js';
import type { ProjectPaths } from '../paths.js';

export interface GateDecision {
  decision: 'approved' | 'rejected' | 'waived' | 'done' | 'reviewed';
  by: string;
  at: string;
  /** Hash of the artifact (or criterion) at decision time. */
  hash?: string;
  /** Hashes of sub-items (requirements, criteria) at decision time, for refine (AG-4). */
  items?: Record<string, string>;
  message?: string;
  evidence?: string;
}

export interface GateRecord {
  id: string;
  decisions: GateDecision[];
}

function gateFile(paths: ProjectPaths, id: string) {
  return path.join(paths.gates, `${id}.yaml`);
}

export function readGate(paths: ProjectPaths, id: string): GateRecord {
  const text = readTextIf(gateFile(paths, id));
  if (!text) return { id, decisions: [] };
  const raw = (YAML.parse(text) ?? {}) as Partial<GateRecord>;
  return { id, decisions: raw.decisions ?? [] };
}

/** Appends a decision; gate records are append-only history stored in git (WF-5). */
export function recordGate(paths: ProjectPaths, id: string, d: Omit<GateDecision, 'at'> & { at?: string }): GateDecision {
  const rec = readGate(paths, id);
  const full: GateDecision = { ...d, at: d.at ?? nowIso() };
  for (const k of Object.keys(full) as (keyof GateDecision)[]) if (full[k] === undefined) delete full[k];
  rec.decisions.push(full);
  writeText(gateFile(paths, id), YAML.stringify({ id, decisions: rec.decisions }, { lineWidth: 0 }));
  return full;
}

export function lastDecision(paths: ProjectPaths, id: string, kinds?: GateDecision['decision'][]): GateDecision | undefined {
  const rec = readGate(paths, id);
  for (let i = rec.decisions.length - 1; i >= 0; i--) {
    const d = rec.decisions[i]!;
    if (!kinds || kinds.includes(d.decision)) return d;
  }
  return undefined;
}

/** Active waiver for a criterion (VG-2): the latest waived decision, unless revoked by a later one. */
export function activeWaiver(paths: ProjectPaths, criterionId: string): GateDecision | undefined {
  const d = lastDecision(paths, criterionId, ['waived', 'rejected']);
  return d?.decision === 'waived' ? d : undefined;
}
