import { readGate } from '../workflow/gates.js';
import { budgetFor, changeLines } from '../workflow/lint.js';
import type { Project } from '../project.js';

export interface StatsResult {
  changes: { id: string; track: string; status: string; lines: number; budget?: number; over: boolean }[];
  byType: Record<string, { files: number; lines: number }>;
  totalLines: number;
  timeToFirstBriefMinutes?: number;
}

/** `keel stats` (WF-6 and the PRD's success metrics): generated Markdown per change and per type. */
export function stats(project: Project): StatsResult {
  const g = project.graph;
  const byType: StatsResult['byType'] = {};
  let total = 0;
  for (const n of g.topLevel()) {
    const t = (byType[n.type] ??= { files: 0, lines: 0 });
    t.files++;
    t.lines += n.lines;
    total += n.lines;
  }
  const changes = g.byType('change').map((c) => {
    const lines = changeLines(project, c);
    const b = budgetFor(project, c);
    return { id: c.id, track: String(c.fm.track ?? ''), status: c.status, lines, budget: b?.limit, over: !!b && lines > b.limit };
  });
  let timeToFirstBriefMinutes: number | undefined;
  const init = project.config.initialized;
  const firstBrief = g
    .byType('brief')
    .map((b) => readGate(project.paths, b.id).decisions.find((d) => d.decision === 'approved')?.at)
    .filter(Boolean)
    .sort()[0];
  if (init && firstBrief) timeToFirstBriefMinutes = Math.round((Date.parse(firstBrief) - Date.parse(init)) / 60000);
  return { changes, byType, totalLines: total, timeToFirstBriefMinutes };
}
