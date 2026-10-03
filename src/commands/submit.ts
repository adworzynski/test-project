import path from 'node:path';
import { parseFrontMatter, composeFile } from '../util/frontmatter.js';
import { readTextIf, writeText, removeFile } from '../util/fs.js';
import { createArtifact } from '../graph/write.js';
import { budgetFor, changeLines, lintProject } from '../workflow/lint.js';
import { review, start, done } from './lifecycle.js';
import { TYPES } from '../model/registry.js';
import { KeelError } from '../util/errors.js';
import { today } from '../util/text.js';
import type { ArtifactType } from '../model/types.js';
import type { Project } from '../project.js';

export interface SubmitArgs {
  markdown?: string;
  type?: string;
  id?: string;
  title?: string;
  status?: string;
}

export interface SubmitResult {
  id: string;
  file: string;
  status: string;
  warnings: string[];
  review?: string;
  merged?: string[];
}

const PROTECTED = ['id', 'type', 'status', 'created', 'owner'];

/**
 * MCP submit_artifact: writes an artifact an agent drafted, validating schema, links and budget
 * before keeping it (a rejected write restores the previous file, NF-8). Status moves go through
 * the same gates as the CLI: agents can request review, start, or ask for done; never approve.
 */
export function submitArtifact(project: Project, args: SubmitArgs): SubmitResult {
  let id = args.id?.toUpperCase();
  let file: string | undefined;
  if (args.markdown !== undefined) {
    const pf = parseFrontMatter(args.markdown);
    if (pf.errors.length) throw new KeelError(`Front-matter is not valid YAML (line ${pf.errors[0]!.line}): ${pf.errors[0]!.message}`);
    id = id ?? (pf.fm.id ? String(pf.fm.id).toUpperCase() : undefined);
    const existing = id ? project.graph.get(id) : undefined;
    if (existing?.parent) throw new KeelError(`${id} is a section of ${existing.parent}; submit ${existing.parent} instead.`);
    let previous: string | undefined;
    if (existing) {
      file = existing.file;
      previous = readTextIf(path.join(project.root, file));
      const fm: Record<string, unknown> = { ...existing.fm, ...pf.fm };
      for (const k of PROTECTED) if (existing.fm[k] !== undefined) fm[k] = existing.fm[k];
      fm.updated = today();
      writeText(path.join(project.root, file), composeFile(fm, pf.hasFrontMatter ? pf.body : args.markdown));
    } else {
      const type = (args.type ?? pf.fm.type) as ArtifactType | undefined;
      if (!type || !TYPES[type]?.dir) throw new KeelError(`Say which artifact type this is (type: ${Object.values(TYPES).filter((t) => t.dir).map((t) => t.type).join(', ')}).`);
      if (type === 'change') throw new KeelError('Start changes with `keel new "<description>"` so the router picks the track; then submit the filled-in note with its id.');
      const body = pf.hasFrontMatter ? pf.body : args.markdown;
      const title = args.title ?? (pf.fm.title as string | undefined) ?? body.match(/^#\s+(?:[A-Z]+-\d+\s*[:.-]?\s*)?(.+)$/m)?.[1]?.trim();
      if (!title) throw new KeelError('Give the artifact a title (front-matter title or a "# Heading").');
      const fmExtra: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(pf.fm)) if (!PROTECTED.includes(k) && k !== 'title' && k !== 'links' && k !== 'updated') fmExtra[k] = v;
      const r = createArtifact(project, {
        type,
        title,
        id: id && !project.graph.get(id) ? id : undefined,
        links: (pf.fm.links as Record<string, string[]>) ?? {},
        extra: fmExtra,
        body: composeFile({ title }, body),
      });
      id = r.id;
      file = r.file;
    }
    project.reload();
    const n = project.graph.get(id!);
    const errs = project.graph.diagnostics.filter((d) => d.level === 'error' && d.file === file);
    const b = n ? budgetFor(project, n) : undefined;
    const size = n ? (n.type === 'change' ? changeLines(project, n) : n.lines) : 0;
    const overBudget = n && b && size > b.limit && !n.fm.imported;
    if (errs.length || overBudget || !n) {
      if (previous !== undefined) writeText(path.join(project.root, file!), previous);
      else removeFile(path.join(project.root, file!));
      project.reload();
      if (overBudget)
        throw new KeelError(`${id} would be ${size} lines, over the ${b!.key} budget of ${b!.limit}. Summarize or split it and submit again.`);
      throw new KeelError(`${id ?? 'The artifact'} was not saved; fix these problems:`, 1, errs.map((d) => `${d.line ? `line ${d.line}: ` : ''}${d.message}`));
    }
  }
  if (!id) throw new KeelError('Pass markdown to save, or an id with a status.');
  const node = project.graph.get(id);
  if (!node) throw new KeelError(`Unknown artifact ${id}`);
  let reviewPack: string | undefined;
  let merged: string[] | undefined;
  if (args.status && args.status !== node.status) {
    switch (args.status) {
      case 'pending-review':
        reviewPack = review(project, id, { request: true }).pack;
        break;
      case 'in-progress':
        start(project, id);
        break;
      case 'done':
        merged = done(project, id).merged;
        break;
      case 'approved':
      case 'accepted':
        throw new KeelError(`Only a person approves gates. Ask the user to review ${id} and run \`keel approve ${id}\`.`);
      default:
        throw new KeelError(`Agents can set status to pending-review, in-progress or done, not ${args.status}.`);
    }
  }
  project.reload();
  const fin = project.graph.get(id) ?? node;
  const warnings = lintProject(project)
    .filter((d) => d.id === id || fin.children.includes(d.id ?? ''))
    .map((d) => d.message);
  return { id, file: fin.file, status: fin.status, warnings, review: reviewPack, merged };
}
