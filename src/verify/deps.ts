import path from 'node:path';
import YAML from 'yaml';
import { glob, readTextIf, matcher } from '../util/fs.js';
import { showFile } from '../util/git.js';

export type Ecosystem = 'npm' | 'pub' | 'cocoapods' | 'spm' | 'maven';

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  manifest: string;
}

export type DepStatus = 'ok' | 'missing' | 'too-new' | 'unknown' | 'allowed';

export interface DepCheck extends Dependency {
  status: DepStatus;
  created?: string;
  ageDays?: number;
  message: string;
}

/** Fetch returning parsed JSON or text; `undefined` body with status for 404s. Injectable for tests. */
export type Fetcher = (url: string) => Promise<{ status: number; body?: string }>;

export const defaultFetcher: Fetcher = async (url) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const headers: Record<string, string> = { 'user-agent': 'keel-cli (dependency existence check)', accept: 'application/json' };
    if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(url, { signal: ctl.signal, headers });
    return { status: r.status, body: r.status === 200 ? await r.text() : undefined };
  } finally {
    clearTimeout(t);
  }
};

// ---------- manifest parsing ----------

export function parseNpm(text: string, manifest: string): Dependency[] {
  const js = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
  const out: Dependency[] = [];
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(js[key] ?? {})) {
      if (/^(file:|link:|workspace:|portal:|git|github:|https?:)/.test(String(spec))) continue;
      out.push({ ecosystem: 'npm', name, manifest });
    }
  }
  return out;
}

export function parsePubspec(text: string, manifest: string): Dependency[] {
  const y = (YAML.parse(text) ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const out: Dependency[] = [];
  for (const key of ['dependencies', 'dev_dependencies']) {
    for (const [name, spec] of Object.entries(y[key] ?? {})) {
      if (spec && typeof spec === 'object') {
        const s = spec as Record<string, unknown>;
        if (s.sdk || s.path || s.git) continue;
        if (s.hosted && typeof s.hosted === 'object' && !String((s.hosted as Record<string, unknown>).url ?? '').includes('pub.dev')) continue;
      }
      out.push({ ecosystem: 'pub', name, manifest });
    }
  }
  return out;
}

export function parsePodfile(text: string, manifest: string): Dependency[] {
  const out: Dependency[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*pod\s+['"]([^'"]+)['"](.*)$/);
    if (!m || /:(path|git|podspec)\s*=>/.test(m[2]!)) continue;
    out.push({ ecosystem: 'cocoapods', name: m[1]!.split('/')[0]!, manifest });
  }
  return out;
}

export function parsePackageSwift(text: string, manifest: string): Dependency[] {
  const out: Dependency[] = [];
  for (const m of text.matchAll(/\.package\s*\(\s*(?:name:\s*"[^"]*"\s*,\s*)?url:\s*"([^"]+)"/g)) {
    const gh = m[1]!.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/);
    if (gh) out.push({ ecosystem: 'spm', name: `${gh[1]}/${gh[2]}`, manifest });
  }
  return out;
}

export function parseGradle(text: string, manifest: string): Dependency[] {
  const out: Dependency[] = [];
  if (manifest.endsWith('.toml')) {
    const y = text.split(/^\[libraries\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
    for (const line of y.split('\n')) {
      const mod = line.match(/module\s*=\s*"([^":]+):([^":]+)"/);
      const grp = line.match(/group\s*=\s*"([^"]+)"\s*,\s*name\s*=\s*"([^"]+)"/);
      const m = mod ?? grp;
      if (m) out.push({ ecosystem: 'maven', name: `${m[1]}:${m[2]}`, manifest });
    }
    return out;
  }
  for (const m of text.matchAll(/\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|androidTestImplementation|kapt|ksp|debugImplementation)\s*\(?\s*["']([\w.-]+):([\w.-]+)(?::[^"']*)?["']/g)) {
    out.push({ ecosystem: 'maven', name: `${m[1]}:${m[2]}`, manifest });
  }
  return out;
}

export function parseManifest(file: string, text: string): Dependency[] {
  const base = path.basename(file);
  try {
    if (base === 'package.json') return parseNpm(text, file);
    if (base === 'pubspec.yaml') return parsePubspec(text, file);
    if (base === 'Podfile') return parsePodfile(text, file);
    if (base === 'Package.swift') return parsePackageSwift(text, file);
    if (/\.gradle(\.kts)?$/.test(base) || base.endsWith('.versions.toml')) return parseGradle(text, file);
  } catch {
    return [];
  }
  return [];
}

/** Dependencies present now but not at `base` (all of them when there is no base). */
export function newDependencies(root: string, manifests: string[], base?: string): Dependency[] {
  const files = glob(root, manifests);
  const key = (d: Dependency) => `${d.ecosystem}:${d.name}`;
  const out = new Map<string, Dependency>();
  for (const f of files) {
    const now = parseManifest(f, readTextIf(path.join(root, f)) ?? '');
    const before = base ? new Set(parseManifest(f, showFile(root, base, f) ?? '').map(key)) : new Set<string>();
    for (const d of now) if (!before.has(key(d))) out.set(key(d), d);
  }
  return [...out.values()];
}

// ---------- registry lookups ----------

const GOOGLE_MAVEN = /^(androidx\.|com\.android\.|com\.google\.android\.|com\.google\.firebase|com\.google\.gms|com\.google\.mlkit)/;

async function lookup(d: Dependency, fetcher: Fetcher): Promise<{ exists: boolean; created?: string; note?: string }> {
  switch (d.ecosystem) {
    case 'npm': {
      const r = await fetcher(`https://registry.npmjs.org/${d.name.replace('/', '%2F')}`);
      if (r.status === 404) return { exists: false };
      if (r.status !== 200 || !r.body) throw new Error(`npm registry answered ${r.status}`);
      const js = JSON.parse(r.body) as { time?: Record<string, string> };
      return { exists: true, created: js.time?.created };
    }
    case 'pub': {
      const r = await fetcher(`https://pub.dev/api/packages/${encodeURIComponent(d.name)}`);
      if (r.status === 404) return { exists: false };
      if (r.status !== 200 || !r.body) throw new Error(`pub.dev answered ${r.status}`);
      const js = JSON.parse(r.body) as { versions?: { published?: string }[] };
      const dates = (js.versions ?? []).map((v) => v.published).filter(Boolean).sort() as string[];
      return { exists: true, created: dates[0] };
    }
    case 'cocoapods': {
      const r = await fetcher(`https://trunk.cocoapods.org/api/v1/pods/${encodeURIComponent(d.name)}`);
      if (r.status === 404) return { exists: false };
      if (r.status !== 200 || !r.body) throw new Error(`CocoaPods trunk answered ${r.status}`);
      const js = JSON.parse(r.body) as { versions?: { created_at?: string }[] };
      const dates = (js.versions ?? []).map((v) => v.created_at).filter(Boolean).sort() as string[];
      return { exists: true, created: dates[0] };
    }
    case 'spm': {
      const r = await fetcher(`https://api.github.com/repos/${d.name}`);
      if (r.status === 404) return { exists: false };
      if (r.status !== 200 || !r.body) throw new Error(`GitHub answered ${r.status}`);
      return { exists: true, created: (JSON.parse(r.body) as { created_at?: string }).created_at };
    }
    case 'maven': {
      const [g, a] = d.name.split(':') as [string, string];
      if (GOOGLE_MAVEN.test(g)) {
        const r = await fetcher(`https://dl.google.com/android/maven2/${g.replace(/\./g, '/')}/group-index.xml`);
        if (r.status === 404) return { exists: false };
        if (r.status !== 200 || !r.body) throw new Error(`Google Maven answered ${r.status}`);
        return { exists: new RegExp(`<${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(r.body), note: 'Google Maven (age not published)' };
      }
      const q = encodeURIComponent(`g:"${g}" AND a:"${a}"`);
      const r = await fetcher(`https://search.maven.org/solrsearch/select?q=${q}&core=gav&rows=200&wt=json`);
      if (r.status !== 200 || !r.body) throw new Error(`Maven Central answered ${r.status}`);
      const docs = (JSON.parse(r.body) as { response?: { docs?: { timestamp?: number }[] } }).response?.docs ?? [];
      if (!docs.length) return { exists: false };
      const first = Math.min(...docs.map((x) => x.timestamp ?? Date.now()));
      return { exists: true, created: new Date(first).toISOString() };
    }
  }
}

/** Dependency-existence and age gate (VG-6). Network errors give "unknown", never a false block. */
export async function checkDependencies(
  deps: Dependency[],
  opts: { minAgeDays: number; allow: string[]; fetcher?: Fetcher; now?: Date },
): Promise<DepCheck[]> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const now = opts.now ?? new Date();
  const allowed = matcher(opts.allow);
  const queue = [...deps];
  const out: DepCheck[] = [];
  const worker = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      if (allowed(d.name)) {
        out.push({ ...d, status: 'allowed', message: 'on the allow list' });
        continue;
      }
      try {
        const r = await lookup(d, fetcher);
        if (!r.exists) {
          out.push({ ...d, status: 'missing', message: `not found on the ${d.ecosystem} registry (hallucinated or misspelled?)` });
          continue;
        }
        if (!r.created) {
          out.push({ ...d, status: 'ok', message: r.note ?? 'exists (publication date unknown)' });
          continue;
        }
        const ageDays = Math.floor((now.getTime() - new Date(r.created).getTime()) / 86400000);
        if (ageDays < opts.minAgeDays)
          out.push({ ...d, status: 'too-new', created: r.created, ageDays, message: `first published ${ageDays} days ago, under the ${opts.minAgeDays}-day minimum` });
        else out.push({ ...d, status: 'ok', created: r.created, ageDays, message: `exists, ${ageDays} days old` });
      } catch (e) {
        out.push({ ...d, status: 'unknown', message: `could not check: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, deps.length) }, worker));
  return out.sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name));
}
