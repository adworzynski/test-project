import path from 'node:path';
import { createArtifact } from '../graph/write.js';
import { recordGate } from '../workflow/gates.js';
import { itemHashes } from '../workflow/refine.js';
import { writeText } from '../util/fs.js';
import { truncate } from '../util/text.js';
import type { ArtifactType } from '../model/types.js';
import type { Project } from '../project.js';

export interface ImportReport {
  source: string;
  created: { id: string; type: string; title: string; file: string; from: string }[];
  mapping: { from: string; to: string }[];
  unlinked: string[];
  notes: string[];
  skipped: string[];
  reportFile?: string;
}

/** Allocates Keel IDs and writes imported artifacts with provenance (`imported: true`, `source:`). */
export class Importer {
  readonly report: ImportReport;
  private counters = new Map<string, number>();

  constructor(
    readonly project: Project,
    source: string,
  ) {
    this.report = { source, created: [], mapping: [], unlinked: [], notes: [], skipped: [] };
  }

  /** Next ID for a prefix, continuing after what the project already has. */
  next(prefix: string, type: ArtifactType): string {
    if (!this.counters.has(prefix)) {
      const n = Number(this.project.graph.nextId(type, prefix).split('-')[1]);
      this.counters.set(prefix, n);
    }
    const n = this.counters.get(prefix)!;
    this.counters.set(prefix, n + 1);
    return `${prefix}-${String(n).padStart(3, '0')}`;
  }

  map(from: string, to: string) {
    this.report.mapping.push({ from, to });
  }

  write(opts: {
    type: ArtifactType;
    title: string;
    body: string;
    from: string;
    status: string;
    links?: Record<string, string[]>;
    extra?: Record<string, unknown>;
    id?: string;
  }): { id: string; file: string } {
    const id = opts.id ?? this.next(TYPE_PREFIX[opts.type]!, opts.type);
    const links: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(opts.links ?? {})) if (v.length) links[k] = [...new Set(v)];
    const r = createArtifact(this.project, {
      type: opts.type,
      id,
      title: truncate(opts.title.replace(/\s+/g, ' ').trim(), 90),
      body: opts.body,
      links,
      status: opts.status,
      extra: { imported: true, source: opts.from, ...(opts.extra ?? {}) },
    });
    this.report.created.push({ id: r.id, type: opts.type, title: opts.title, file: r.file, from: opts.from });
    return r;
  }

  /** Imported planning artifacts were already in use; record a baseline approval so later edits are detected. */
  baseline(ids: string[]) {
    this.project.reload();
    for (const id of ids) {
      const n = this.project.graph.get(id);
      if (!n) continue;
      recordGate(this.project.paths, id, { decision: 'approved', by: 'keel import', hash: n.hash, items: itemHashes(this.project, n), message: `imported from ${this.report.source}` });
    }
  }

  writeReport(name: string): string {
    const r = this.report;
    const lines = [
      `# Import report: ${name}`,
      '',
      `Source: \`${r.source}\``,
      '',
      `## Created (${r.created.length})`,
      '',
      '| Keel ID | Type | Title | From |',
      '| --- | --- | --- | --- |',
      ...r.created.map((c) => `| ${c.id} | ${c.type} | ${c.title.replace(/\|/g, '/')} | \`${c.from}\` |`),
      '',
      `## ID mapping (${r.mapping.length})`,
      '',
      ...r.mapping.map((m) => `- ${m.from} → ${m.to}`),
      '',
      `## Could not link (${r.unlinked.length})`,
      '',
      ...(r.unlinked.length ? r.unlinked.map((u) => `- ${u}`) : ['Everything was linked.']),
      '',
      `## Notes`,
      '',
      ...(r.notes.length ? r.notes.map((u) => `- ${u}`) : ['None.']),
      '',
      `## Not imported (${r.skipped.length})`,
      '',
      ...(r.skipped.length ? r.skipped.map((u) => `- ${u}`) : ['Nothing was skipped.']),
      '',
    ];
    const file = path.join(this.project.paths.keel, `import-report-${name}.md`);
    writeText(file, lines.join('\n'));
    r.reportFile = path.relative(this.project.root, file).split(path.sep).join('/');
    return r.reportFile;
  }
}

const TYPE_PREFIX: Partial<Record<ArtifactType, string>> = {
  brief: 'BR',
  prd: 'PRD',
  'screen-map': 'SM',
  'design-tokens': 'DT',
  adr: 'ADR',
  story: 'ST',
  change: 'CH',
  release: 'RL',
  source: 'SRC',
};

/** Splits acceptance-criteria text into separate criteria: numbered items or Given-led blocks. */
export function splitCriteria(text: string): string[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  const items: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    const t = cur.join('\n').trim();
    if (t) items.push(t);
    cur = [];
  };
  for (const l of lines) {
    const trimmed = l.trim();
    if (!trimmed || /^(-{3,}|\*{3,})$/.test(trimmed)) continue;
    const numbered = /^\d+[.)]\s+/.test(trimmed);
    const startsGiven = /^(?:[-*]\s*)?(?:\*\*|__)?Given\b/i.test(trimmed);
    if (numbered || (startsGiven && cur.some((c) => /\b(Then)\b/i.test(c)))) flush();
    if (numbered && !cur.length) {
      cur.push(trimmed.replace(/^\d+[.)]\s+/, ''));
      continue;
    }
    if (/^[-*]\s+(?!\*\*|__|Given|When|Then|And|But)/i.test(trimmed) && !cur.length) {
      // A bullet list of plain criteria: each bullet is one criterion.
      items.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }
    cur.push(trimmed);
  }
  flush();
  return items;
}

/** Renders one criterion section from free text, keeping Given/When/Then when present. */
export function criterionSection(id: string, text: string, level = 3): { md: string; structured: boolean } {
  const clean = text.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  // Given/When/Then may be lowercase mid-sentence ("Given x, when y, then z"); And/But only capitalized.
  const parts = clean.split(/(?=\b(?:[Gg]iven|[Ww]hen|[Tt]hen|And|But)\b)/);
  const clauses = parts
    .map((p) => p.trim())
    .filter((p) => /^(Given|When|Then|And|But)\b/i.test(p))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  const structured = clauses.some((c) => /^When\b/i.test(c)) && clauses.some((c) => /^Then\b/i.test(c));
  const thenText = clauses.find((c) => /^Then\b/i.test(c))?.replace(/^Then\s+/i, '');
  const title = truncate((thenText ?? clean).replace(/[.,;]+$/, ''), 70);
  const hashes = '#'.repeat(level);
  const body = structured ? clauses.map((c) => `- ${c.replace(/[,;]\s*$/, '')}`).join('\n') : `- Then ${clean}`;
  return { md: `${hashes} ${id}: ${title}\n${body}\n`, structured };
}

/** Pulls `FR1`, `FR-001`, `NFR2` references out of text, normalized as e.g. FR1. */
export function frRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(N?FR)[-_ ]?0*(\d+)\b/g)].map((m) => `${m[1]}${m[2]}`))];
}

export function firstWords(text: string, n = 8): string {
  const w = text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().split(' ');
  return w.slice(0, n).join(' ').replace(/[.,;:]+$/, '') + (w.length > n ? '…' : '');
}
