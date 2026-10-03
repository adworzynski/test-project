import path from 'node:path';
import { listDir, readText, removeFile, writeText, moveFile } from '../util/fs.js';
import { composeFile, parseFrontMatter } from '../util/frontmatter.js';
import { today } from '../util/text.js';
import { DONE_STATUSES } from '../model/registry.js';
import { cmpId } from '../graph/graph.js';
import { KeelError } from '../util/errors.js';
import { recordGate } from '../workflow/gates.js';
import { itemHashes } from '../workflow/refine.js';
import type { ArtifactNode } from '../model/types.js';
import type { Project } from '../project.js';

/** Shifts every heading in a section so its first heading has `level` hashes. */
export function relevel(sectionText: string, level: number): string {
  const lines = sectionText.split('\n');
  const m = lines[0]!.match(/^(#{1,6})\s/);
  if (!m) return sectionText;
  const shift = level - m[1]!.length;
  let inFence = false;
  return lines
    .map((l) => {
      if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
      if (inFence) return l;
      return l.replace(/^(#{1,6})(\s)/, (_, h: string, sp: string) => '#'.repeat(Math.min(6, Math.max(1, h.length + shift))) + sp);
    })
    .join('\n');
}

function headingLevel(text: string): number {
  return text.match(/^(#{1,6})\s/)?.[1]!.length ?? 3;
}

interface Edit {
  file: string;
  /** 1-based start line and line count of the section to replace (count 0 = insert). */
  line: number;
  count: number;
  text: string | null;
}

/** Applies edits bottom-up per file so earlier line numbers stay valid. */
function applyEdits(project: Project, edits: Edit[]) {
  const byFile = new Map<string, Edit[]>();
  for (const e of edits) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  for (const [file, es] of byFile) {
    const abs = path.join(project.root, file);
    const lines = readText(abs).split('\n');
    for (const e of es.sort((a, b) => b.line - a.line)) {
      const replacement = e.text === null ? [] : e.text.split('\n');
      lines.splice(e.line - 1, e.count, ...replacement);
    }
    writeText(abs, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
  }
}

/** Where ADDED requirements go: the first PRD's matching section, or a new requirements PRD. */
function prdInsertPoint(project: Project, kind: 'FR' | 'NFR'): { file: string; line: number; level: number } | undefined {
  const prd = project.graph.byType('prd').find((p) => !p.fm.imported) ?? project.graph.byType('prd')[0];
  if (!prd) return undefined;
  const lines = readText(path.join(project.root, prd.file)).split('\n');
  const want = kind === 'FR' ? /^##\s+Functional requirements/i : /^##\s+Non-functional requirements/i;
  let start = lines.findIndex((l) => want.test(l));
  if (start === -1) return { file: prd.file, line: lines.length + 1, level: 3 };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i]!)) { end = i; break; }
  while (end > start + 1 && !lines[end - 1]!.trim()) end--;
  return { file: prd.file, line: end + 1, level: 3 };
}

/**
 * Merges a change's delta into the artifacts that define the affected items (AG-3):
 * ADDED requirements go to the PRD, ADDED criteria stay with the (archived) change,
 * MODIFIED sections replace the original text, REMOVED sections are deleted.
 */
export function mergeDelta(project: Project, change: ArtifactNode): string[] {
  const g = project.graph;
  const log: string[] = [];
  const edits: Edit[] = [];
  const fmCriteriaRemovals = new Map<string, string[]>();
  for (const d of g.deltas.get(change.id) ?? []) {
    const target = g.get(d.id);
    if (!target) throw new KeelError(`${change.id} ${d.delta === 'modified' ? 'modifies' : 'removes'} ${d.id}, which does not exist`);
    if (d.delta === 'modified') {
      edits.push({ file: target.file, line: target.line, count: target.lines, text: relevel(d.body, headingLevel(target.body)) });
      log.push(`modified ${d.id} in ${target.file}`);
    } else {
      edits.push({ file: target.file, line: target.line, count: target.lines, text: null });
      if (target.type === 'criterion' && target.parent) fmCriteriaRemovals.set(target.parent, [...(fmCriteriaRemovals.get(target.parent) ?? []), d.id]);
      log.push(`removed ${d.id} from ${target.file}`);
    }
  }
  const addedReqs = change.children.map((c) => g.get(c)!).filter((n) => n?.type === 'requirement');
  for (const r of addedReqs) {
    const at = prdInsertPoint(project, r.kind ?? 'FR');
    if (!at) {
      log.push(`kept ${r.id} in ${change.id} (no PRD to merge into)`);
      continue;
    }
    edits.push({ file: at.file, line: at.line, count: 0, text: '\n' + relevel(r.body, at.level) });
    log.push(`added ${r.id} to ${at.file}`);
  }
  applyEdits(project, edits);
  for (const [owner, ids] of fmCriteriaRemovals) {
    const n = g.get(owner);
    if (!n || !Array.isArray(n.fm.criteria)) continue;
    const abs = path.join(project.root, n.file);
    const pf = parseFrontMatter(readText(abs));
    pf.fm.criteria = (pf.fm.criteria as string[]).filter((c) => !ids.includes(String(c)));
    pf.fm.updated = today();
    writeText(abs, composeFile(pf.fm, pf.body));
  }
  // Archive the change with a date.
  const abs = path.join(project.root, change.file);
  const pf = parseFrontMatter(readText(abs));
  pf.fm.status = 'archived';
  pf.fm.archived = today();
  pf.fm.updated = today();
  writeText(abs, composeFile(pf.fm, pf.body));
  const archived = path.join(project.paths.artifacts, 'changes', 'archive', `${today()}-${path.basename(change.file)}`);
  moveFile(abs, archived);
  log.push(`archived ${change.id} to ${path.relative(project.root, archived).split(path.sep).join('/')}`);
  project.reload();
  // The approved change's delta is now part of these artifacts: record it as their new approved baseline.
  const owners = new Set(edits.map((e) => e.file));
  for (const n of project.graph.topLevel()) {
    if (!owners.has(n.file) || n.id === change.id) continue;
    recordGate(project.paths, n.id, { decision: 'approved', by: 'keel', hash: n.hash, items: itemHashes(project, n), message: `merged delta of ${change.id}` });
  }
  return log;
}

const SPEC_README = `# Living spec

Generated by Keel: one file per requirement with the acceptance criteria that are true of the
product today (from done stories and merged changes). Don't edit these files. Change the PRD,
stories or changes, then run \`keel spec\` (Keel also regenerates it on \`keel done\`).
`;

/** Rebuilds .keel/spec/ from the graph. Returns the files written or removed. */
export function generateSpec(project: Project): { written: string[]; removed: string[] } {
  const g = project.graph;
  const dir = project.paths.spec;
  const written: string[] = [];
  const removed: string[] = [];
  const merged = (n: ArtifactNode | undefined) => !!n && DONE_STATUSES.has(n.status);
  const byReq = new Map<string, ArtifactNode[]>();
  const unlinked: ArtifactNode[] = [];
  for (const c of g.byType('criterion')) {
    const owner = c.parent ? g.get(c.parent) : undefined;
    if (!merged(owner)) continue;
    const reqs = g.requirementsOf(owner!.id);
    if (!reqs.length) unlinked.push(c);
    for (const r of reqs) byReq.set(r.id, [...(byReq.get(r.id) ?? []), c]);
  }
  if (writeText(path.join(dir, 'README.md'), SPEC_README)) written.push('README.md');
  const keep = new Set(['README.md']);
  for (const r of g.byType('requirement')) {
    const prd = r.parent ? g.get(r.parent) : undefined;
    const crit = (byReq.get(r.id) ?? []).sort((a, b) => cmpId(a.id, b.id));
    const body = r.body.split('\n').slice(1).join('\n').trim();
    const parts = [
      `<!-- Generated by keel spec. Edit ${prd?.id ?? 'the PRD'}, stories and changes, not this file. -->`,
      `# ${r.id}: ${r.title}${r.priority ? ` [${r.priority}]` : ''}`,
      '',
      `Source: ${prd ? `${prd.id} (${prd.file})` : r.file}`,
      '',
      body || '_No description._',
      '',
      '## Acceptance criteria',
      '',
    ];
    if (!crit.length) parts.push('_None merged yet._', '');
    for (const c of crit) {
      parts.push(`### ${c.id}: ${c.title} (${c.parent})`);
      for (const gv of c.given ?? []) parts.push(`- Given ${gv}`);
      for (const w of c.when ?? []) parts.push(`- When ${w}`);
      for (const t of c.then ?? []) parts.push(`- Then ${t}`);
      parts.push('');
    }
    const name = `${r.id}.md`;
    keep.add(name);
    if (writeText(path.join(dir, name), parts.join('\n').trimEnd() + '\n')) written.push(name);
  }
  if (unlinked.length) {
    const parts = ['<!-- Generated by keel spec. -->', '# Criteria not linked to a requirement', ''];
    for (const c of unlinked.sort((a, b) => cmpId(a.id, b.id))) parts.push(`- ${c.id}: ${c.title} (${c.parent})`);
    keep.add('unlinked.md');
    if (writeText(path.join(dir, 'unlinked.md'), parts.join('\n') + '\n')) written.push('unlinked.md');
  }
  for (const f of listDir(dir)) {
    if (f.endsWith('.md') && !keep.has(f)) {
      removeFile(path.join(dir, f));
      removed.push(f);
    }
  }
  return { written, removed };
}
