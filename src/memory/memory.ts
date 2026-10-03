import path from 'node:path';
import { readTextIf, appendText, exists, writeText } from '../util/fs.js';
import { contentHash } from '../util/hash.js';
import { today } from '../util/text.js';
import type { ArtifactNode } from '../model/types.js';
import type { ProjectPaths } from '../paths.js';

export interface MemoryEntry {
  id: string;
  kind: 'decision' | 'constraint';
  title: string;
  date?: string;
  by?: string;
  source?: string;
  step?: string;
  link?: string;
  text: string;
  line: number;
  file: string;
}

const ENTRY_RE = /^##\s+((?:D|CN)-\d{3,})\s*[:.\-–—]?\s*(.*)$/;
const META_RE = /^\s*-\s+(date|by|source|step|link|agent):\s*(.*)$/i;

export function memoryFiles(paths: ProjectPaths) {
  return {
    decisions: path.join(paths.memory, 'decisions.md'),
    constraints: path.join(paths.memory, 'constraints.md'),
  };
}

export function parseMemory(text: string, file: string, kind: MemoryEntry['kind']): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let cur: MemoryEntry | undefined;
  const flush = () => {
    if (cur) {
      cur.text = cur.text.trim();
      out.push(cur);
    }
  };
  lines.forEach((line, i) => {
    const m = line.match(ENTRY_RE);
    if (m) {
      flush();
      cur = { id: m[1]!, kind, title: m[2]!.trim() || m[1]!, text: '', line: i + 1, file };
      return;
    }
    if (!cur) return;
    if (/^#{1,2}\s/.test(line)) {
      flush();
      cur = undefined;
      return;
    }
    const mm = line.match(META_RE);
    if (mm && !cur.text.trim()) {
      const key = mm[1]!.toLowerCase() as 'date' | 'by' | 'source' | 'step' | 'link' | 'agent';
      if (key === 'agent') cur.source = mm[2]!.trim();
      else cur[key] = mm[2]!.trim();
      return;
    }
    cur.text += line + '\n';
  });
  flush();
  return out;
}

export function loadMemory(paths: ProjectPaths, root: string): MemoryEntry[] {
  const f = memoryFiles(paths);
  const out: MemoryEntry[] = [];
  for (const [kind, file] of [
    ['decision', f.decisions],
    ['constraint', f.constraints],
  ] as const) {
    const text = readTextIf(file);
    if (text) out.push(...parseMemory(text, path.relative(root, file).split(path.sep).join('/'), kind));
  }
  return out;
}

export function memoryToNode(e: MemoryEntry): ArtifactNode {
  return {
    id: e.id,
    type: e.kind,
    title: e.title,
    status: 'active',
    file: e.file,
    line: e.line,
    links: e.link ? { related: e.link.match(/\b[A-Z]{1,3}-\d{3,}\b/g) ?? [] } : {},
    fm: {},
    body: e.text,
    hash: contentHash(e.title + '\n' + e.text),
    children: [],
    lines: e.text.split('\n').length + 1,
  };
}

const HEADERS = {
  decision:
    '# Decisions\n\nProject decisions with their source (ME-1). Every agent sees these through `keel context` and the MCP `get_context` tool. Append with `keel decide` or the `record_decision` MCP tool.\n',
  constraint:
    '# Constraints\n\nRules every agent must follow, usually saved from a correction (ME-2). They appear in each context pack. Add with `keel constrain` or `record_decision` with kind "constraint".\n',
};

export function ensureMemoryFiles(paths: ProjectPaths): void {
  const f = memoryFiles(paths);
  if (!exists(f.decisions)) writeText(f.decisions, HEADERS.decision);
  if (!exists(f.constraints)) writeText(f.constraints, HEADERS.constraint);
}

export interface NewMemory {
  kind: MemoryEntry['kind'];
  title: string;
  text?: string;
  by: string;
  source?: string;
  step?: string;
  link?: string;
}

/** Appends a decision or constraint and returns its new ID. */
export function appendMemory(paths: ProjectPaths, root: string, entry: NewMemory): string {
  ensureMemoryFiles(paths);
  const existing = loadMemory(paths, root).filter((e) => e.kind === entry.kind);
  const prefix = entry.kind === 'decision' ? 'D' : 'CN';
  const max = existing.reduce((m, e) => Math.max(m, Number(e.id.split('-')[1])), 0);
  const id = `${prefix}-${String(max + 1).padStart(3, '0')}`;
  const meta = [`- date: ${today()}`, `- by: ${entry.by}`];
  if (entry.source) meta.push(`- source: ${entry.source}`);
  if (entry.step) meta.push(`- step: ${entry.step}`);
  if (entry.link) meta.push(`- link: ${entry.link}`);
  const title = entry.title.replace(/\s+/g, ' ').trim();
  const body = entry.text?.trim() ? `\n${entry.text.trim()}\n` : '';
  const file = entry.kind === 'decision' ? memoryFiles(paths).decisions : memoryFiles(paths).constraints;
  const prev = readTextIf(file) ?? '';
  appendText(file, `${prev.endsWith('\n\n') ? '' : prev.endsWith('\n') ? '\n' : '\n\n'}## ${id}: ${title}\n${meta.join('\n')}\n${body}`);
  return id;
}
