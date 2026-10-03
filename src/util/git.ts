import { spawnSync } from 'node:child_process';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function git(root: string, args: string[], input?: string): GitResult {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function isGitRepo(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true';
}

export function gitConfig(root: string, key: string): string | undefined {
  const r = git(root, ['config', '--get', key]);
  const v = r.stdout.trim();
  return r.ok && v ? v : undefined;
}

export function headSha(root: string): string | undefined {
  const r = git(root, ['rev-parse', 'HEAD']);
  return r.ok ? r.stdout.trim() : undefined;
}

export function revExists(root: string, rev: string): boolean {
  return git(root, ['rev-parse', '--verify', '--quiet', rev + '^{commit}']).ok;
}

/** Picks the base to diff against: explicit, then GITHUB_BASE_REF, then origin/main or main. */
export function resolveBase(root: string, explicit?: string): string | undefined {
  const candidates = [
    explicit,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined,
    'origin/main',
    'origin/master',
    'main',
    'master',
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (revExists(root, c)) {
      const mb = git(root, ['merge-base', c, 'HEAD']);
      if (mb.ok && mb.stdout.trim()) return mb.stdout.trim();
      return c;
    }
  }
  return undefined;
}

/** Files changed between base and the working tree (committed, staged and unstaged, plus untracked). */
export function changedFiles(root: string, base?: string): string[] {
  const files = new Set<string>();
  if (base) {
    for (const f of git(root, ['diff', '--name-only', base]).stdout.split('\n')) if (f.trim()) files.add(f.trim());
  } else {
    for (const f of git(root, ['diff', '--name-only', 'HEAD']).stdout.split('\n')) if (f.trim()) files.add(f.trim());
  }
  for (const f of git(root, ['ls-files', '--others', '--exclude-standard']).stdout.split('\n'))
    if (f.trim()) files.add(f.trim());
  return [...files].sort();
}

/** Lines added+removed per file between base (or HEAD) and the working tree. */
export function diffStat(root: string, base?: string): Map<string, number> {
  const out = new Map<string, number>();
  const r = git(root, ['diff', '--numstat', base ?? 'HEAD']);
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (m) out.set(m[3]!, (Number(m[1]) || 0) + (Number(m[2]) || 0));
  }
  return out;
}

export function showFile(root: string, rev: string, file: string): string | undefined {
  const r = git(root, ['show', `${rev}:${file}`]);
  return r.ok ? r.stdout : undefined;
}

export interface Commit {
  sha: string;
  subject: string;
  author: string;
  date: string;
  refs: string[];
  files?: string[];
}

const SEP = '\x1f';
const MARK = '@@keel-commit@@';

/** Commits with their Keel-Ref trailers (AG-5), optionally with the files each touched. */
export function commitsWithRefs(root: string, opts: { withFiles?: boolean; range?: string } = {}): Commit[] {
  const fmt = MARK + ['%H', '%s', '%an', '%aI', '%(trailers:key=Keel-Ref,valueonly,separator=%x2C)'].join(SEP);
  const args = ['log', `--format=${fmt}`];
  if (opts.withFiles) args.push('--name-only');
  if (opts.range) args.push(opts.range);
  const r = git(root, args);
  if (!r.ok) return [];
  const commits: Commit[] = [];
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith(MARK)) {
      const parts = line.slice(MARK.length).split(SEP);
      const refs = (parts[4] ?? '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      commits.push({ sha: parts[0]!, subject: parts[1] ?? '', author: parts[2] ?? '', date: parts[3] ?? '', refs, files: opts.withFiles ? [] : undefined });
    } else if (line.trim() && opts.withFiles && commits.length) {
      commits[commits.length - 1]!.files!.push(line.trim());
    }
  }
  return commits;
}

/** Extracts a PR number from merge or squash commit subjects. */
export function prNumber(subject: string): number | undefined {
  const m = subject.match(/Merge pull request #(\d+)/) ?? subject.match(/\(#(\d+)\)\s*$/);
  return m ? Number(m[1]) : undefined;
}
