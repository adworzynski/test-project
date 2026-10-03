import { lastDecision } from './gates.js';
import { isApproved } from '../model/registry.js';
import type { ArtifactNode } from '../model/types.js';
import type { Project } from '../project.js';

export interface Drifted {
  artifact: ArtifactNode;
  /** True when the whole file changed (outside or across sub-items). */
  changed: boolean;
  /** Sub-items whose text changed, appeared or disappeared since approval. */
  items: string[];
}

/** Item hashes recorded at approval time, so edits to one requirement can be told apart (AG-4). */
export function itemHashes(project: Project, node: ArtifactNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of node.children) {
    const n = project.graph.get(c);
    if (n && n.type !== 'task') out[c] = n.hash;
  }
  return out;
}

/** Compares an approved artifact with its last approval record. */
export function driftSinceApproval(project: Project, node: ArtifactNode): Drifted | undefined {
  if (node.parent || !isApproved(node.status) || node.status === 'archived') return undefined;
  const d = lastDecision(project.paths, node.id, ['approved']);
  if (!d?.hash) return undefined;
  if (d.hash === node.hash) return undefined;
  const now = itemHashes(project, node);
  const then = d.items ?? {};
  const items = new Set<string>();
  for (const [id, h] of Object.entries(now)) if (then[id] !== h) items.add(id);
  for (const id of Object.keys(then)) if (!(id in now)) items.add(id);
  return { artifact: node, changed: true, items: [...items].sort() };
}

export function allDrifted(project: Project): Drifted[] {
  return project.graph
    .topLevel()
    .map((n) => driftSinceApproval(project, n))
    .filter((d): d is Drifted => !!d);
}

/** Artifacts downstream of the given IDs: anything linking to them, plus their sub-items' dependents. */
export function downstreamOf(project: Project, ids: string[]): ArtifactNode[] {
  const g = project.graph;
  const seen = new Set<string>(ids);
  const out = new Map<string, ArtifactNode>();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of g.incoming(id)) {
      const from = g.owner(e.from);
      if (!from || seen.has(from.id)) continue;
      seen.add(from.id);
      out.set(from.id, from);
      // One more hop for derived artifacts (e.g. PRD → story → change that affects the story).
      if (from.type !== 'story' && from.type !== 'change') queue.push(from.id);
    }
  }
  return [...out.values()];
}
