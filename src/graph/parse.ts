import { contentHash } from '../util/hash.js';
import { parseFrontMatter } from '../util/frontmatter.js';
import { lineCount } from '../util/fs.js';
import { asArray } from '../util/text.js';
import { SUB_PREFIXES, typeForId, ID_RE } from '../model/registry.js';
import type { ArtifactNode, ArtifactType, Checkbox, DeltaOp, Diagnostic } from '../model/types.js';

export interface ParsedArtifact {
  node?: ArtifactNode;
  /** Sub-items that define new nodes (sections, tasks, ADDED delta items). */
  subs: ArtifactNode[];
  /** Delta items that modify or remove nodes defined elsewhere. */
  deltas: ArtifactNode[];
  checkboxes: Checkbox[];
  diagnostics: Diagnostic[];
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SUB_HEADING_RE = /^(?:~~)?((?:FR|NFR|AC|SC)-\d{3,})(?:~~)?\b\s*(?:\(([^)]*)\))?\s*[:.\-–—]?\s*(.*)$/;
const PRIORITY_RE = /\[(Must|Should|Could|Won'?t)\]|\((Must|Should|Could|Won'?t)\)/i;
const DELTA_RE = /^(ADDED|MODIFIED|REMOVED)\b/i;
const CHECKBOX_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;
const TASK_ID_RE = /^(TK-\d{3,})\b\s*[:.\-–—]?\s*(.*)$/;
const CLAUSE_RE = /^\s*(?:[-*]|\d+[.)])?\s*(?:\*\*|__)?(Given|When|Then|And|But)(?:\*\*|__)?\b[\s:,]*(.*)$/i;

function normPriority(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const v = p.toLowerCase();
  if (v.startsWith('must')) return 'Must';
  if (v.startsWith('should')) return 'Should';
  if (v.startsWith('could')) return 'Could';
  if (v.startsWith('won')) return "Won't";
  return undefined;
}

/** Splits criterion text into Given/When/Then clauses; And/But continue the previous clause. */
export function parseClauses(lines: string[]): { given: string[]; when: string[]; then: string[] } {
  const out = { given: [] as string[], when: [] as string[], then: [] as string[] };
  let last: keyof typeof out | undefined;
  for (const raw of lines) {
    // A single line may hold several clauses: "**Given** x **When** y **Then** z".
    const pieces = raw.split(/(?=(?:\*\*|__)?\b(?:Given|When|Then)\b(?:\*\*|__)?\s)/);
    for (const piece of pieces) {
      const m = piece.match(CLAUSE_RE);
      if (!m) continue;
      const kw = m[1]!.toLowerCase();
      const text = m[2]!.replace(/\*\*|__/g, '').replace(/[,;]\s*$/, '').trim();
      if (kw === 'given' || kw === 'when' || kw === 'then') last = kw;
      if (last && text) out[last].push(text);
    }
  }
  return out;
}

interface Section {
  id: string;
  level: number;
  title: string;
  priority?: string;
  start: number; // index into body lines (heading line)
  end: number; // exclusive
  delta?: DeltaOp;
}

/**
 * Parses one artifact file. Top-level metadata comes from front-matter; sub-items come from
 * headings whose text starts with an ID (`### AC-001: ...`) and from `- [ ] TK-001: ...` tasks.
 */
export function parseArtifactText(text: string, file: string): ParsedArtifact {
  const diagnostics: Diagnostic[] = [];
  const pf = parseFrontMatter(text);
  for (const e of pf.errors) diagnostics.push({ level: 'error', code: 'yaml', message: e.message, file, line: e.line });
  if (!pf.hasFrontMatter && !pf.errors.length) {
    diagnostics.push({ level: 'error', code: 'no-front-matter', message: 'artifact has no YAML front-matter', file, line: 1 });
  }
  const result: ParsedArtifact = { subs: [], deltas: [], checkboxes: [], diagnostics };
  if (pf.errors.length || !pf.hasFrontMatter) return result;

  const fm = pf.fm;
  const id = String(fm.id ?? '');
  const type = String(fm.type ?? '') as ArtifactType;
  const links: Record<string, string[]> = {};
  if (fm.links && typeof fm.links === 'object' && !Array.isArray(fm.links)) {
    for (const [rel, v] of Object.entries(fm.links as Record<string, unknown>)) links[rel] = asArray(v);
  }
  const bodyLines = pf.body.split('\n');
  const titleFromBody = bodyLines.find((l) => /^#\s+/.test(l))?.replace(/^#\s+/, '').replace(new RegExp(`^${id}\\s*[:.\\-–—]?\\s*`), '');
  const node: ArtifactNode = {
    id,
    type,
    title: String(fm.title ?? titleFromBody ?? id),
    status: String(fm.status ?? ''),
    file,
    line: 1,
    links,
    fm,
    body: pf.body,
    hash: contentHash(stripVolatile(text)),
    children: [],
    lines: lineCount(text),
  };
  result.node = node;

  // Pass 1: find headings, track fenced code, collect sub-item sections and delta context.
  const sections: Section[] = [];
  const headingStack: { level: number; text: string }[] = [];
  let inFence = false;
  const headings: { idx: number; level: number }[] = [];
  bodyLines.forEach((line, idx) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    const hm = line.match(HEADING_RE);
    if (hm) {
      const level = hm[1]!.length;
      const htext = hm[2]!;
      headings.push({ idx, level });
      while (headingStack.length && headingStack[headingStack.length - 1]!.level >= level) headingStack.pop();
      const sm = htext.match(SUB_HEADING_RE);
      if (sm) {
        const delta = headingStack
          .map((h) => h.text.match(DELTA_RE)?.[1]?.toLowerCase())
          .filter(Boolean)
          .pop() as DeltaOp | undefined;
        const rest = sm[3] ?? '';
        const priority = normPriority(sm[2]) ?? normPriority(rest.match(PRIORITY_RE)?.[1] ?? rest.match(PRIORITY_RE)?.[2]);
        const title = rest.replace(PRIORITY_RE, '').replace(/~~/g, '').trim() || sm[1]!;
        sections.push({ id: sm[1]!, level, title, priority, start: idx, end: bodyLines.length, delta });
      }
      headingStack.push({ level, text: htext });
      return;
    }
    const cb = line.match(CHECKBOX_RE);
    if (cb) {
      const checked = cb[1] !== ' ';
      const txt = cb[2]!.trim();
      const tm = txt.match(TASK_ID_RE);
      result.checkboxes.push({ text: tm ? tm[2]! : txt, checked, line: pf.bodyLine + idx, id: tm?.[1] });
    }
  });
  // Section ends at the next heading of the same or higher level.
  for (const s of sections) {
    const next = headings.find((h) => h.idx > s.start && h.level <= s.level);
    s.end = next ? next.idx : bodyLines.length;
  }

  for (const s of sections) {
    const sectionLines = bodyLines.slice(s.start, s.end);
    while (sectionLines.length && !sectionLines[sectionLines.length - 1]!.trim()) sectionLines.pop();
    const subType = typeForId(s.id)!;
    const sub: ArtifactNode = {
      id: s.id,
      type: subType,
      title: s.title,
      status: node.status,
      file,
      line: pf.bodyLine + s.start,
      parent: id,
      links: {},
      fm: {},
      body: sectionLines.join('\n'),
      hash: contentHash(sectionLines.slice(1).join('\n') + '\n' + s.title),
      children: [],
      delta: s.delta,
      lines: sectionLines.length,
    };
    if (subType === 'requirement') {
      sub.kind = s.id.startsWith('NFR') ? 'NFR' : 'FR';
      sub.priority = s.priority;
    }
    if (subType === 'criterion') Object.assign(sub, parseClauses(sectionLines.slice(1)));
    // Inline links inside a section: "Links: FR-001, SC-002" or "Implements: FR-001".
    for (const l of sectionLines.slice(1)) {
      const lm = l.match(/^\s*[-*]?\s*(?:\*\*)?(links?|implements|screens|affects)(?:\*\*)?\s*:\s*(.+)$/i);
      if (lm) {
        const rel = lm[1]!.toLowerCase().startsWith('link') ? 'related' : lm[1]!.toLowerCase();
        const ids = (lm[2]!.match(/\b[A-Z]{1,3}-\d{3,}\b/g) ?? []).filter((x) => ID_RE.test(x));
        if (ids.length) sub.links[rel] = [...(sub.links[rel] ?? []), ...ids];
      }
    }
    if (s.delta === 'modified' || s.delta === 'removed') result.deltas.push(sub);
    else result.subs.push(sub);
  }

  for (const cb of result.checkboxes) {
    if (!cb.id) continue;
    result.subs.push({
      id: cb.id,
      type: 'task',
      title: cb.text,
      status: cb.checked ? 'done' : 'todo',
      checked: cb.checked,
      file,
      line: cb.line,
      parent: id,
      links: {},
      fm: {},
      body: cb.text,
      hash: contentHash(cb.text),
      children: [],
      lines: 1,
    });
  }
  node.children = result.subs.map((s) => s.id);
  return result;
}

/** Hash input without front-matter fields Keel rewrites itself (status and lifecycle dates), so approving doesn't change the hash. */
export function stripVolatile(text: string): string {
  const src = text.replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return src;
  const end = src.indexOf('\n---', 3);
  if (end === -1) return src;
  const fm = src
    .slice(0, end)
    .split('\n')
    .filter((l) => !/^(status|updated|needs_review|archived|released|started):/.test(l))
    .join('\n');
  return fm + src.slice(end);
}

export function isSubPrefix(prefix: string): boolean {
  return prefix in SUB_PREFIXES;
}
