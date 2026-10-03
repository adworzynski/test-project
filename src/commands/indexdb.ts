import fs from 'node:fs';
import path from 'node:path';
import { walk } from '../util/fs.js';
import { linkedTests, loadEvidence } from '../verify/coverage.js';
import { cmpId } from '../graph/graph.js';
import { KeelError } from '../util/errors.js';
import { createRequire } from 'node:module';
import type { Project } from '../project.js';

type Db = {
  exec(sql: string): void;
  prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): Record<string, unknown>[] };
  close(): void;
};

async function openSqlite(file: string, readOnly = false): Promise<Db> {
  type Ctor = new (f: string, o?: { readOnly?: boolean }) => Db;
  let DatabaseSync: Ctor;
  const orig = process.emitWarning;
  // node:sqlite prints an ExperimentalWarning on load; keep CLI output clean.
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (String(typeof w === 'string' ? w : w.message).includes('SQLite')) return;
    return (orig as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    // node:sqlite is a prefix-only builtin; require() resolves it in every loader.
    DatabaseSync = (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: Ctor }).DatabaseSync;
  } catch {
    throw new KeelError('The SQLite index needs Node.js 22.5 or newer (node:sqlite). Everything else works without it.');
  } finally {
    process.emitWarning = orig;
  }
  return readOnly ? new DatabaseSync(file, { readOnly: true }) : new DatabaseSync(file);
}

/** `keel index` (AG-6): rebuilds .keel/index.sqlite from the files. Derived, git-ignored, never the source of truth. */
export async function buildIndex(project: Project): Promise<{ file: string; artifacts: number; links: number; tests: number }> {
  const file = project.paths.index;
  fs.rmSync(file, { force: true });
  const db = await openSqlite(file);
  const g = project.graph;
  db.exec(`
    CREATE TABLE artifacts (id TEXT PRIMARY KEY, type TEXT, status TEXT, title TEXT, file TEXT, line INTEGER, parent TEXT, priority TEXT, kind TEXT, lines INTEGER);
    CREATE TABLE links (src TEXT, rel TEXT, dst TEXT);
    CREATE TABLE criteria (id TEXT PRIMARY KEY, owner TEXT, title TEXT, given TEXT, "when" TEXT, "then" TEXT);
    CREATE TABLE tests (file TEXT, line INTEGER, name TEXT, kind TEXT, criterion TEXT);
    CREATE TABLE evidence (criterion TEXT PRIMARY KEY, status TEXT, at TEXT);
    CREATE INDEX links_src ON links(src); CREATE INDEX links_dst ON links(dst);
  `);
  const nodes = g.all().sort((a, b) => cmpId(a.id, b.id));
  const insA = db.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insL = db.prepare('INSERT INTO links VALUES (?,?,?)');
  const insC = db.prepare('INSERT INTO criteria VALUES (?,?,?,?,?,?)');
  let links = 0;
  db.exec('BEGIN');
  for (const n of nodes) {
    insA.run(n.id, n.type, n.status, n.title, n.file, n.line, n.parent ?? null, n.priority ?? null, n.kind ?? null, n.lines);
    for (const e of g.outgoing(n.id).sort((a, b) => a.rel.localeCompare(b.rel) || cmpId(a.to, b.to))) {
      insL.run(e.from, e.rel, e.to);
      links++;
    }
    if (n.type === 'criterion') insC.run(n.id, n.parent ?? null, n.title, (n.given ?? []).join('\n'), (n.when ?? []).join('\n'), (n.then ?? []).join('\n'));
  }
  const tests = linkedTests(project).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const insT = db.prepare('INSERT INTO tests VALUES (?,?,?,?,?)');
  for (const t of tests) for (const c of t.criteria) insT.run(t.file, t.line, t.name, t.kind, c);
  const latest = new Map<string, { status: string; at: string }>();
  for (const ev of loadEvidence(project)) for (const [ac, v] of Object.entries(ev.criteria)) latest.set(ac, { status: v.status, at: ev.at });
  const insE = db.prepare('INSERT INTO evidence VALUES (?,?,?)');
  for (const [ac, v] of [...latest].sort((a, b) => cmpId(a[0], b[0]))) insE.run(ac, v.status, v.at);
  db.exec('COMMIT');
  db.close();
  return { file: path.relative(project.root, file), artifacts: nodes.length, links, tests: tests.length };
}

function indexIsStale(project: Project): boolean {
  if (!fs.existsSync(project.paths.index)) return true;
  const built = fs.statSync(project.paths.index).mtimeMs;
  for (const dir of [project.paths.artifacts, project.paths.memory, project.paths.evidence]) {
    for (const f of walk(project.root, dir)) if (fs.statSync(path.join(project.root, f)).mtimeMs > built) return true;
  }
  return false;
}

/** `keel query "<sql>"`: read-only SQL over the index, rebuilt first when stale. */
export async function queryIndex(project: Project, sql: string): Promise<Record<string, unknown>[]> {
  if (!/^\s*(select|with|pragma\s+table_info)\b/i.test(sql)) throw new KeelError('Only SELECT queries are allowed; the index is read-only.');
  if (indexIsStale(project)) await buildIndex(project);
  const db = await openSqlite(project.paths.index, true);
  try {
    return db.prepare(sql).all();
  } catch (e) {
    throw new KeelError(`Query failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    db.close();
  }
}
