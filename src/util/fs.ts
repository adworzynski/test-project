import fs from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';

export function exists(p: string): boolean {
  return fs.existsSync(p);
}

export function readText(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

export function readTextIf(p: string): string | undefined {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
}

/** Writes a file, creating parent directories. Returns true when the content changed. */
export function writeText(p: string, content: string): boolean {
  const prev = readTextIf(p);
  if (prev === content) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return true;
}

export function appendText(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, content);
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

/** Converts a path to forward slashes so stored paths are identical on every OS. */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function rel(root: string, p: string): string {
  return toPosix(path.relative(root, p));
}

const DEFAULT_IGNORES = new Set([
  'node_modules',
  '.git',
  '.dart_tool',
  '.gradle',
  'Pods',
  '.build',
  'DerivedData',
  '.expo',
  '.next',
  'dist',
  'coverage',
  '.idea',
]);

export interface WalkOptions {
  /** Directory names skipped anywhere in the tree. */
  ignoreDirs?: Set<string>;
  /** Stop after this many files (safety valve for huge repos). */
  limit?: number;
}

/** Lists files under `dir` (recursively), returning repo-relative posix paths. */
export function walk(root: string, dir = root, opts: WalkOptions = {}): string[] {
  const ignore = opts.ignoreDirs ?? DEFAULT_IGNORES;
  const limit = opts.limit ?? 50000;
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        out.push(rel(root, full));
        if (out.length >= limit) return out.sort();
      }
    }
  }
  return out.sort();
}

/** Returns repo-relative files matching any of the globs. */
export function glob(root: string, patterns: string[], files?: string[]): string[] {
  if (!patterns.length) return [];
  const isMatch = picomatch(patterns, { dot: true });
  const all = files ?? walk(root);
  return all.filter((f) => isMatch(f));
}

export function matcher(patterns: string[]): (p: string) => boolean {
  if (!patterns.length) return () => false;
  return picomatch(patterns, { dot: true });
}

export function listDir(p: string): string[] {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

export function removeFile(p: string): void {
  if (fs.existsSync(p)) fs.rmSync(p);
}

export function moveFile(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

export function copyDir(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true });
}

export function lineCount(text: string): number {
  if (!text) return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}
