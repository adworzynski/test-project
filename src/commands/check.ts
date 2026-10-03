import { lintProject } from '../workflow/lint.js';
import { loadWorkflows } from '../workflow/load.js';
import type { Diagnostic } from '../model/types.js';
import type { Project } from '../project.js';

/** `keel check`: schemas, IDs, links, workflows, lint, budgets (AG-1, WF-1, NF-8). */
export function checkProject(project: Project): Diagnostic[] {
  const wf = loadWorkflows(project.paths.workflows);
  const ds = [...wf.diagnostics, ...project.graph.diagnostics, ...lintProject(project)];
  const seen = new Set<string>();
  return ds
    .filter((d) => {
      const k = `${d.level}|${d.code}|${d.file}|${d.line}|${d.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.level === b.level ? (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) : a.level === 'error' ? -1 : 1));
}
