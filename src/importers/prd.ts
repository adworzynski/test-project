import path from 'node:path';
import { exists, readText } from '../util/fs.js';
import { KeelError } from '../util/errors.js';
import { Importer, type ImportReport } from './common.js';
import type { Project } from '../project.js';

/** `keel import prd <file>` (DP-6): quotes an existing PRD, README or wiki export as a source artifact. */
export function importPrdSource(project: Project, file: string): ImportReport {
  const abs = path.resolve(project.root, file);
  if (!exists(abs)) throw new KeelError(`${file} not found.`);
  const rel = path.relative(project.root, abs).split(path.sep).join('/');
  const text = readText(abs);
  const imp = new Importer(project, rel);
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file);
  const quoted = text
    .replace(/\r\n/g, '\n')
    .trimEnd()
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');
  const body = [`# Source: ${title}`, '', `Quoted from [\`${rel}\`](${path.relative(path.join(project.paths.artifacts, 'sources'), abs).split(path.sep).join('/')}). Cite it from the PRD; don't edit the quote.`, '', quoted, ''].join('\n');
  imp.write({ type: 'source', title: `Source: ${title}`, body, from: rel, status: 'approved' });
  return imp.report;
}
