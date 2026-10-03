import path from 'node:path';
import fs from 'node:fs';
import { composeFile, parseFrontMatter } from '../util/frontmatter.js';
import { readText, readTextIf, writeText } from '../util/fs.js';
import { slugify, today } from '../util/text.js';
import { TYPES } from '../model/registry.js';
import { PACK_DIR } from '../paths.js';
import { KeelError } from '../util/errors.js';
import type { ArtifactType } from '../model/types.js';
import type { Project } from '../project.js';

/** Reads a template from the project (.keel/templates) or the bundled pack. */
export function readTemplate(project: Project, name: string): string {
  const local = readTextIf(path.join(project.paths.templates, name));
  if (local !== undefined) return local;
  const bundled = readTextIf(path.join(PACK_DIR, 'templates', name));
  if (bundled === undefined) throw new KeelError(`template ${name} not found`);
  return bundled;
}

/** Fills {{placeholders}} in a template. Unknown placeholders are left as-is. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}

export interface CreateOptions {
  type: ArtifactType;
  title: string;
  id?: string;
  links?: Record<string, string[]>;
  extra?: Record<string, unknown>;
  body?: string;
  template?: string;
  vars?: Record<string, string>;
  status?: string;
  dir?: string;
}

/** Creates a new artifact file from its template; returns its id and repo-relative path. */
export function createArtifact(project: Project, opts: CreateOptions): { id: string; file: string } {
  const def = TYPES[opts.type];
  if (!def?.dir) throw new KeelError(`cannot create an artifact of type ${opts.type}`);
  const g = project.graph;
  const id = opts.id ?? g.nextId(opts.type);
  if (g.get(id)) throw new KeelError(`${id} already exists`);
  const vars: Record<string, string> = {
    id,
    title: opts.title,
    date: today(),
    owner: project.config.owner ?? 'me',
    project: project.config.project,
    ...(opts.vars ?? {}),
  };
  let text: string;
  if (opts.body !== undefined) {
    text = opts.body;
  } else {
    text = fill(readTemplate(project, opts.template ?? def.template!), vars);
  }
  const pf = parseFrontMatter(text);
  const fm: Record<string, unknown> = {
    ...pf.fm,
    id,
    type: opts.type,
    status: opts.status ?? (pf.fm.status as string) ?? (opts.type === 'adr' ? 'proposed' : 'draft'),
    title: opts.title,
    links: { ...((pf.fm.links as Record<string, string[]>) ?? {}), ...(opts.links ?? {}) },
    owner: (pf.fm.owner as string) ?? vars.owner,
    created: today(),
    updated: today(),
    ...(opts.extra ?? {}),
  };
  for (const [k, v] of Object.entries(fm.links as Record<string, string[]>)) if (!v?.length) delete (fm.links as Record<string, string[]>)[k];
  const dir = path.join(project.paths.artifacts, opts.dir ?? def.dir);
  const file = path.join(dir, `${id}-${slugify(opts.title)}.md`);
  writeText(file, composeFile(fm, pf.hasFrontMatter ? pf.body : text));
  project.reload();
  return { id, file: path.relative(project.root, file).split(path.sep).join('/') };
}

/** Updates front-matter fields of an artifact file in place, keeping its body byte-for-byte. */
export function updateFrontMatter(project: Project, file: string, patch: Record<string, unknown>): void {
  const abs = path.join(project.root, file);
  const text = readText(abs);
  const pf = parseFrontMatter(text);
  if (pf.errors.length) throw new KeelError(`${file}:${pf.errors[0]!.line}: ${pf.errors[0]!.message}`);
  const fm = { ...pf.fm };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) delete fm[k];
    else fm[k] = v;
  }
  if (!('updated' in patch)) fm.updated = today();
  writeText(abs, composeFile(fm, pf.body));
  project.reload();
}

export function setStatus(project: Project, id: string, status: string, extra: Record<string, unknown> = {}): void {
  const n = project.graph.get(id);
  if (!n) throw new KeelError(`unknown artifact ${id}`);
  if (n.parent) throw new KeelError(`${id} is a section of ${n.parent}; change the status of ${n.parent} instead`);
  updateFrontMatter(project, n.file, { status, ...extra });
}

/** Replaces a whole file body (used by submit_artifact). */
export function writeArtifactFile(project: Project, file: string, text: string): void {
  writeText(path.join(project.root, file), text.endsWith('\n') ? text : text + '\n');
  project.reload();
}

export function deleteArtifactFile(project: Project, file: string): void {
  fs.rmSync(path.join(project.root, file), { force: true });
  project.reload();
}
