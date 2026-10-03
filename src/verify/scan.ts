import path from 'node:path';
import { glob, readText } from '../util/fs.js';
import { uniq } from '../util/text.js';

/** A test (or test group) linked to criteria by an `@keel AC-123` tag (VG-1). */
export interface LinkedTest {
  file: string;
  line: number;
  name: string;
  kind: 'test' | 'group';
  criteria: string[];
}

const AC_RE = /\bAC-\d{3,}\b/g;
const TAG_RE = /@keel\b[:\s]*((?:AC-\d{3,}[\s,;]*)+)/g;

interface DeclPattern {
  re: RegExp;
  kind: 'test' | 'group';
  nameGroup: number;
}

const DART: DeclPattern[] = [
  { re: /\b(?:testWidgets|test|patrolTest|testGoldens|blocTest(?:<[^>]*>)?)\s*\(\s*(['"])(.*?)\1/, kind: 'test', nameGroup: 2 },
  { re: /\bgroup\s*\(\s*(['"])(.*?)\1/, kind: 'group', nameGroup: 2 },
];
const TS: DeclPattern[] = [
  { re: /\b(?:it|test)(?:\.\w+)*\s*\(\s*(['"`])(.*?)\1/, kind: 'test', nameGroup: 2 },
  { re: /\bdescribe(?:\.\w+)*\s*\(\s*(['"`])(.*?)\1/, kind: 'group', nameGroup: 2 },
];
const SWIFT: DeclPattern[] = [
  { re: /@Test\s*\(\s*"(.*?)"/, kind: 'test', nameGroup: 1 },
  { re: /\bfunc\s+(test\w*)\s*\(/, kind: 'test', nameGroup: 1 },
  { re: /@Test\b[^\n]*\n?\s*func\s+(\w+)\s*\(/, kind: 'test', nameGroup: 1 },
  { re: /\bfunc\s+(\w+)\s*\(/, kind: 'test', nameGroup: 1 },
  { re: /\b(?:class|struct)\s+(\w+)/, kind: 'group', nameGroup: 1 },
];
const KOTLIN: DeclPattern[] = [
  { re: /\bfun\s+`([^`]+)`\s*\(/, kind: 'test', nameGroup: 1 },
  { re: /\bfun\s+(\w+)\s*\(/, kind: 'test', nameGroup: 1 },
  { re: /\bclass\s+(\w+)/, kind: 'group', nameGroup: 1 },
];

export function patternsFor(file: string): DeclPattern[] {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.dart') return DART;
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return TS;
  if (ext === '.swift') return SWIFT;
  if (ext === '.kt' || ext === '.kts') return KOTLIN;
  return [...TS, ...DART];
}

function findDecl(lines: string[], from: number, pats: DeclPattern[]): { name: string; kind: 'test' | 'group'; line: number } | undefined {
  for (let i = from; i < Math.min(lines.length, from + 8); i++) {
    // Allow a declaration whose name string is on the line after the call (common formatting).
    const window = lines[i]! + (lines[i + 1] !== undefined ? '\n' + lines[i + 1] : '');
    for (const p of pats) {
      const m = (i === from ? lines[i]! : window).match(p.re);
      if (m) return { name: m[p.nameGroup]!, kind: p.kind, line: i + 1 };
    }
  }
  return undefined;
}

/** Scans one test file for `@keel AC-…` tags and test names that mention criterion IDs. */
export function scanTestText(text: string, file: string): LinkedTest[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const pats = patternsFor(file);
  const out: LinkedTest[] = [];
  lines.forEach((line, i) => {
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const ids: string[] = [];
    while ((m = TAG_RE.exec(line))) ids.push(...(m[1]!.match(AC_RE) ?? []));
    if (ids.length) {
      const decl = findDecl(lines, i, pats);
      if (decl) out.push({ file, line: decl.line, name: decl.name, kind: decl.kind, criteria: uniq(ids) });
      else out.push({ file, line: i + 1, name: '', kind: 'test', criteria: uniq(ids) });
      return;
    }
    // Test names that carry the ID directly, e.g. test('AC-001 saves a habit', ...).
    for (const p of pats) {
      const dm = line.match(p.re);
      if (dm) {
        const named = dm[p.nameGroup]!.match(AC_RE);
        if (named) out.push({ file, line: i + 1, name: dm[p.nameGroup]!, kind: p.kind, criteria: uniq(named) });
        break;
      }
    }
  });
  // Merge duplicates (a tag above a test whose name also has the ID).
  const merged = new Map<string, LinkedTest>();
  for (const t of out) {
    const key = `${t.file}:${t.line}:${t.name}`;
    const prev = merged.get(key);
    if (prev) prev.criteria = uniq([...prev.criteria, ...t.criteria]);
    else merged.set(key, t);
  }
  return [...merged.values()];
}

export function scanTests(root: string, patterns: string[], files?: string[]): LinkedTest[] {
  const out: LinkedTest[] = [];
  for (const f of glob(root, patterns, files)) {
    let text: string;
    try {
      text = readText(path.join(root, f));
    } catch {
      continue;
    }
    if (!text.includes('@keel') && !/\bAC-\d{3,}/.test(text)) continue;
    out.push(...scanTestText(text, f));
  }
  return out;
}

/** Lists test declarations without any criterion link (for `keel verify --suggest`). */
export function scanUntagged(root: string, patterns: string[]): { file: string; line: number; name: string }[] {
  const out: { file: string; line: number; name: string }[] = [];
  for (const f of glob(root, patterns)) {
    const lines = readText(path.join(root, f)).split('\n');
    const pats = patternsFor(f).filter((p) => p.kind === 'test');
    lines.forEach((line, i) => {
      if (/@keel/.test(lines[i - 1] ?? '') || /@keel/.test(line) || /\bAC-\d{3,}/.test(line)) return;
      for (const p of pats) {
        const m = line.match(p.re);
        if (m) {
          out.push({ file: f, line: i + 1, name: m[p.nameGroup]! });
          break;
        }
      }
    });
  }
  return out;
}
