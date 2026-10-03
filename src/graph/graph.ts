import path from 'node:path';
import { walk, readText } from '../util/fs.js';
import { parseArtifactText, type ParsedArtifact } from './parse.js';
import { loadMemory, memoryToNode } from '../memory/memory.js';
import { TYPES, FILE_TYPES, ID_RE, typeForId, DONE_STATUSES } from '../model/registry.js';
import { validateWithSchema, hasSchema } from '../schemas.js';
import type { ArtifactNode, ArtifactType, Diagnostic } from '../model/types.js';
import type { ProjectPaths } from '../paths.js';

export interface Edge {
  from: string;
  rel: string;
  to: string;
}

export class Graph {
  readonly nodes = new Map<string, ArtifactNode>();
  /** MODIFIED/REMOVED delta items inside changes, keyed by the change ID. */
  readonly deltas = new Map<string, ArtifactNode[]>();
  readonly files = new Map<string, ParsedArtifact>();
  readonly diagnostics: Diagnostic[] = [];
  private incomingIdx = new Map<string, Edge[]>();

  get(id: string): ArtifactNode | undefined {
    return this.nodes.get(id);
  }

  must(id: string): ArtifactNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`unknown artifact ${id}`);
    return n;
  }

  all(): ArtifactNode[] {
    return [...this.nodes.values()];
  }

  byType(type: ArtifactType): ArtifactNode[] {
    return this.all()
      .filter((n) => n.type === type)
      .sort((a, b) => cmpId(a.id, b.id));
  }

  topLevel(): ArtifactNode[] {
    return this.all().filter((n) => !n.parent && FILE_TYPES.includes(n.type));
  }

  children(id: string, type?: ArtifactType): ArtifactNode[] {
    const n = this.nodes.get(id);
    if (!n) return [];
    return n.children.map((c) => this.nodes.get(c)!).filter((c) => c && (!type || c.type === type));
  }

  outgoing(id: string): Edge[] {
    const n = this.nodes.get(id);
    if (!n) return [];
    const out: Edge[] = [];
    for (const [rel, tos] of Object.entries(n.links)) for (const to of tos) out.push({ from: id, rel, to });
    return out;
  }

  incoming(id: string): Edge[] {
    return this.incomingIdx.get(id) ?? [];
  }

  /** Criteria a work item (story or change) must satisfy: its own plus MODIFIED ones in a change. */
  criteriaOf(id: string): ArtifactNode[] {
    const own = this.children(id, 'criterion');
    const modified = (this.deltas.get(id) ?? []).filter((d) => d.type === 'criterion' && d.delta === 'modified');
    return [...own, ...modified];
  }

  /** Requirements a story implements or a change affects (via links, or via affected criteria). */
  requirementsOf(id: string): ArtifactNode[] {
    const n = this.nodes.get(id);
    if (!n) return [];
    const ids = new Set<string>();
    for (const e of this.outgoing(id)) {
      const t = this.nodes.get(e.to);
      if (t?.type === 'requirement') ids.add(t.id);
      if (t?.type === 'prd') for (const c of t.children) ids.add(c);
    }
    for (const d of this.deltas.get(id) ?? []) if (d.type === 'requirement') ids.add(d.id);
    for (const c of n.children) if (this.nodes.get(c)?.type === 'requirement') ids.add(c);
    return [...ids].map((i) => this.nodes.get(i)).filter(Boolean) as ArtifactNode[];
  }

  /** Work items (stories and changes) that are not finished. */
  activeWork(): ArtifactNode[] {
    return this.all().filter((n) => (n.type === 'story' || n.type === 'change') && !DONE_STATUSES.has(n.status));
  }

  /** Top-level artifact that defines this node (itself for files). */
  owner(id: string): ArtifactNode | undefined {
    const n = this.nodes.get(id);
    if (!n) return undefined;
    return n.parent ? this.nodes.get(n.parent) : n;
  }

  /** Builds the reverse-link index; children count as linking to their parent. */
  index(): void {
    this.incomingIdx.clear();
    const add = (e: Edge) => {
      const arr = this.incomingIdx.get(e.to) ?? [];
      arr.push(e);
      this.incomingIdx.set(e.to, arr);
    };
    for (const n of this.nodes.values()) {
      for (const e of this.outgoing(n.id)) add(e);
    }
  }

  nextId(type: ArtifactType, prefix = TYPES[type].prefix): string {
    let max = 0;
    const re = new RegExp(`^${prefix}-(\\d+)$`);
    const consider = (id: string) => {
      const m = id.match(re);
      if (m) max = Math.max(max, Number(m[1]));
    };
    for (const id of this.nodes.keys()) consider(id);
    for (const ds of this.deltas.values()) for (const d of ds) consider(d.id);
    for (const [, pf] of this.files) {
      // Removed items stay reserved: scan archived change files too (already loaded as files).
      for (const d of pf.deltas) consider(d.id);
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }
}

export function cmpId(a: string, b: string): number {
  const [pa, na] = a.split('-');
  const [pb, nb] = b.split('-');
  if (pa !== pb) return pa! < pb! ? -1 : 1;
  return Number(na) - Number(nb);
}

function addDiag(g: Graph, d: Diagnostic) {
  g.diagnostics.push(d);
}

/** Loads every artifact under .keel/artifacts plus the memory logs into a graph and validates it. */
export function loadGraph(paths: ProjectPaths): Graph {
  const g = new Graph();
  const root = paths.root;
  const files = walk(root, paths.artifacts).filter((f) => f.endsWith('.md') && !/(^|\/)README\.md$/i.test(f));
  const definedAt = new Map<string, string>();

  const define = (n: ArtifactNode) => {
    const prev = g.nodes.get(n.id);
    if (prev) {
      addDiag(g, {
        level: 'error',
        code: 'duplicate-id',
        message: `duplicate ID ${n.id} (also defined at ${prev.file}:${prev.line})`,
        file: n.file,
        line: n.line,
        id: n.id,
      });
      return;
    }
    g.nodes.set(n.id, n);
    definedAt.set(n.id, `${n.file}:${n.line}`);
  };

  for (const file of files) {
    let text: string;
    try {
      text = readText(path.join(root, file));
    } catch (e) {
      addDiag(g, { level: 'error', code: 'read', message: String(e), file });
      continue;
    }
    const parsed = parseArtifactText(text, file);
    g.files.set(file, parsed);
    for (const d of parsed.diagnostics) addDiag(g, d);
    const node = parsed.node;
    if (!node) continue;
    validateTopLevel(g, node);
    if (!node.id || !ID_RE.test(node.id)) continue;
    define(node);
    for (const s of parsed.subs) {
      if (node.type === 'change' && !s.delta && s.type !== 'task') s.delta = 'added';
      if (node.type === 'change' && s.delta === 'added' && node.status === 'archived' && s.type === 'requirement') {
        // Requirements added by an archived change were merged into the PRD.
        continue;
      }
      validateSub(g, s, node);
      define(s);
    }
    node.children = parsed.subs.filter((s) => g.nodes.get(s.id) === s).map((s) => s.id);
    if (parsed.deltas.length && node.status !== 'archived') g.deltas.set(node.id, parsed.deltas);
  }

  for (const e of loadMemory(paths, root)) define(memoryToNode(e));

  g.index();
  validateLinks(g);
  return g;
}

function validateTopLevel(g: Graph, n: ArtifactNode) {
  const type = n.type;
  const def = TYPES[type];
  if (!def || !def.dir) {
    addDiag(g, {
      level: 'error',
      code: 'type',
      message: `unknown or non-file artifact type "${n.fm.type ?? ''}"`,
      file: n.file,
      line: 1,
      id: n.id,
    });
    return;
  }
  const schemaName = hasSchema(type) ? type : 'artifact';
  for (const err of validateWithSchema(schemaName, n.fm)) {
    addDiag(g, { level: 'error', code: 'schema', message: `front-matter ${err}`, file: n.file, line: 1, id: n.id });
  }
  const idType = typeForId(n.id);
  if (idType && idType !== type) {
    addDiag(g, {
      level: 'error',
      code: 'id-prefix',
      message: `ID ${n.id} does not match type ${type} (expected ${def.prefix}-NNN)`,
      file: n.file,
      line: 1,
      id: n.id,
    });
  }
  const declared = n.fm.criteria;
  if (Array.isArray(declared)) {
    const parsedAc = new Set(
      (g.files.get(n.file)?.subs ?? []).filter((s) => s.type === 'criterion').map((s) => s.id),
    );
    for (const ac of declared.map(String)) {
      if (!parsedAc.has(ac))
        addDiag(g, {
          level: 'error',
          code: 'criteria-mismatch',
          message: `front-matter lists ${ac} but the body has no "### ${ac}: ..." section`,
          file: n.file,
          line: 1,
          id: n.id,
        });
    }
    for (const ac of parsedAc) {
      if (!declared.map(String).includes(ac))
        addDiag(g, {
          level: 'warning',
          code: 'criteria-mismatch',
          message: `${ac} is defined in the body but missing from front-matter criteria`,
          file: n.file,
          line: 1,
          id: n.id,
        });
    }
  }
}

function validateSub(g: Graph, s: ArtifactNode, parent: ArtifactNode) {
  const allowed = TYPES[parent.type]?.contains ?? [];
  if (!allowed.includes(s.type)) {
    addDiag(g, {
      level: 'warning',
      code: 'misplaced-item',
      message: `${s.id} (${s.type}) is not expected inside a ${parent.type}`,
      file: s.file,
      line: s.line,
      id: s.id,
    });
  }
  const data: Record<string, unknown> = { id: s.id, title: s.title, parent: parent.id };
  if (s.type === 'requirement') {
    data.kind = s.kind;
    if (s.priority) data.priority = s.priority;
  }
  if (s.type === 'criterion') Object.assign(data, { given: s.given, when: s.when, then: s.then });
  if (s.type === 'task') data.checked = s.checked;
  if (s.type === 'criterion') {
    // Missing Given/When/Then is a lint warning (DP-5), not a hard schema error.
    if (!s.when?.length || !s.then?.length) {
      addDiag(g, {
        level: 'warning',
        code: 'criterion-format',
        message: `${s.id} should have Given/When/Then lines (at least When and Then)`,
        file: s.file,
        line: s.line,
        id: s.id,
      });
    }
    return;
  }
  for (const err of validateWithSchema(s.type, data)) {
    addDiag(g, { level: 'error', code: 'schema', message: `${s.id} ${err}`, file: s.file, line: s.line, id: s.id });
  }
}

function validateLinks(g: Graph) {
  for (const n of g.nodes.values()) {
    for (const e of g.outgoing(n.id)) {
      if (!g.nodes.has(e.to)) {
        const removed = [...g.deltas.values()].flat().some((d) => d.id === e.to && d.delta === 'removed');
        addDiag(g, {
          level: 'error',
          code: 'broken-link',
          message: `${n.id} links (${e.rel}) to ${e.to}, which does not exist${removed ? ' (removed by a change)' : ''}`,
          file: n.file,
          line: n.line,
          id: n.id,
        });
      }
    }
  }
  for (const [chId, ds] of g.deltas) {
    for (const d of ds) {
      if (!g.nodes.has(d.id)) {
        addDiag(g, {
          level: 'error',
          code: 'delta-target',
          message: `${chId} ${d.delta === 'modified' ? 'modifies' : 'removes'} ${d.id}, which does not exist`,
          file: d.file,
          line: d.line,
          id: chId,
        });
      }
    }
  }
}
