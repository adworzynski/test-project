import path from 'node:path';
import fs from 'node:fs';
import { listDir, readTextIf, writeText } from '../util/fs.js';
import { uniq } from '../util/text.js';
import { shortId } from '../util/hash.js';
import { headSha } from '../util/git.js';
import { activeWaiver, type GateDecision } from '../workflow/gates.js';
import { scanTests, type LinkedTest } from './scan.js';
import type { TestResult, TestStatus } from './results.js';
import type { Project } from '../project.js';
import type { ArtifactNode } from '../model/types.js';

export type CoverageStatus = 'passed' | 'failed' | 'not-run' | 'untested' | 'waived' | 'skipped';

export interface TestEvidence {
  name: string;
  file?: string;
  line?: number;
  status: TestStatus | 'not-run';
  message?: string;
}

export interface CriterionCoverage {
  id: string;
  title: string;
  /** Story or change that owns the criterion. */
  owner?: string;
  status: CoverageStatus;
  tests: TestEvidence[];
  waiver?: GateDecision;
  /** When the result came from recorded evidence rather than this run. */
  evidenceAt?: string;
}

export interface EvidenceRun {
  run: string;
  at: string;
  commit?: string;
  sources: string[];
  criteria: Record<string, { status: CoverageStatus; tests: TestEvidence[] }>;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(\)$/, '')
    .replace(/[`'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function sameFile(a?: string, b?: string): boolean {
  if (!a || !b) return true; // unknown file: don't block the match
  const pa = a.split(path.sep).join('/');
  const pb = b.split(path.sep).join('/');
  return pa.endsWith(pb) || pb.endsWith(pa);
}

/** Does a result belong to a linked test? Names may carry group prefixes ("group test") or class names. */
export function resultMatches(r: TestResult, t: LinkedTest): boolean {
  if (!t.name) return false;
  if (!sameFile(r.file, t.file)) return false;
  const rn = norm(r.name);
  const tn = norm(t.name);
  const full = norm(`${r.classname ?? ''} ${r.name}`);
  if (t.kind === 'group') {
    return rn.startsWith(tn + ' ') || rn === tn || norm(r.classname ?? '').endsWith(tn) || full.includes(tn + ' ');
  }
  return rn === tn || rn.endsWith(' ' + tn) || rn.endsWith('.' + tn) || rn.endsWith(' > ' + tn);
}

function combine(statuses: (TestStatus | 'not-run')[]): CoverageStatus {
  if (!statuses.length) return 'untested';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('passed')) return 'passed';
  if (statuses.every((s) => s === 'skipped')) return 'skipped';
  return 'not-run';
}

/** Maps a test run onto criteria: linked tests from source tags plus results whose names contain AC IDs. */
export function mapRun(results: TestResult[], linked: LinkedTest[]): Map<string, { status: CoverageStatus; tests: TestEvidence[] }> {
  const out = new Map<string, { status: CoverageStatus; tests: TestEvidence[] }>();
  const add = (ac: string, ev: TestEvidence) => {
    const cur = out.get(ac) ?? { status: 'untested' as CoverageStatus, tests: [] };
    if (!cur.tests.some((t) => t.name === ev.name && t.file === ev.file && t.status === ev.status)) cur.tests.push(ev);
    out.set(ac, cur);
  };
  for (const t of linked) {
    const matches = results.filter((r) => resultMatches(r, t));
    for (const ac of t.criteria) {
      if (!matches.length) add(ac, { name: t.name || `(tag at line ${t.line})`, file: t.file, line: t.line, status: 'not-run' });
      for (const r of matches) add(ac, { name: r.name, file: t.file, line: t.line, status: r.status, message: r.message });
    }
  }
  for (const r of results) {
    for (const ac of uniq(`${r.classname ?? ''} ${r.name}`.match(/\bAC-\d{3,}\b/g) ?? [])) {
      add(ac, { name: r.name, file: r.file, status: r.status, message: r.message });
    }
  }
  for (const v of out.values()) v.status = combine(v.tests.map((t) => t.status));
  return out;
}

export function linkedTests(project: Project): LinkedTest[] {
  return scanTests(project.root, project.config.verify.tests);
}

/** Loads recorded evidence runs, oldest first. */
export function loadEvidence(project: Project): EvidenceRun[] {
  const dir = project.paths.evidence;
  return listDir(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readTextIf(path.join(dir, f)) ?? '{}') as EvidenceRun;
      } catch {
        return undefined;
      }
    })
    .filter((r): r is EvidenceRun => !!r && !!r.criteria);
}

let lastStamp = 0;

export function recordEvidence(project: Project, run: Omit<EvidenceRun, 'run' | 'at' | 'commit'>): EvidenceRun {
  // Millisecond stamps, strictly increasing within a process, so newer runs always sort last.
  const now = process.env.KEEL_NOW ? Date.parse(process.env.KEEL_NOW) : Date.now();
  lastStamp = Math.max(now, lastStamp + 1);
  const iso = new Date(lastStamp).toISOString();
  const stamp = iso.replace(/[-:]/g, '').replace('.', '').replace('Z', '');
  const full: EvidenceRun = { run: `${stamp}-${shortId()}`, at: iso, commit: headSha(project.root), ...run };
  writeText(path.join(project.paths.evidence, `${full.run}.json`), JSON.stringify(full, null, 2) + '\n');
  return full;
}

/** Keeps the newest N evidence files so .keel/evidence doesn't grow without bound. */
export function pruneEvidence(project: Project, keep = 50): number {
  const files = listDir(project.paths.evidence)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const drop = files.slice(0, Math.max(0, files.length - keep));
  for (const f of drop) fs.rmSync(path.join(project.paths.evidence, f));
  return drop.length;
}

export interface CoverageReport {
  criteria: CriterionCoverage[];
  byId: Map<string, CriterionCoverage>;
  totals: Record<CoverageStatus, number> & { total: number; covered: number };
}

/**
 * Coverage for every criterion in the graph. With `run`, results come from this run;
 * otherwise from the newest recorded evidence for each criterion.
 */
export function computeCoverage(project: Project, run?: Map<string, { status: CoverageStatus; tests: TestEvidence[] }>): CoverageReport {
  const g = project.graph;
  const criteria = g.byType('criterion');
  const latest = new Map<string, { status: CoverageStatus; tests: TestEvidence[]; at: string }>();
  if (!run) {
    for (const ev of loadEvidence(project)) {
      for (const [ac, v] of Object.entries(ev.criteria)) latest.set(ac, { ...v, at: ev.at });
    }
  }
  const out: CriterionCoverage[] = [];
  for (const c of criteria) {
    const fromRun = run?.get(c.id);
    const rec = run ? undefined : latest.get(c.id);
    const src = fromRun ?? rec;
    let status: CoverageStatus = src?.status ?? 'untested';
    const waiver = activeWaiver(project.paths, c.id);
    if (waiver && status !== 'failed' && status !== 'passed') status = 'waived';
    out.push({ id: c.id, title: c.title, owner: c.parent, status, tests: src?.tests ?? [], waiver, evidenceAt: rec?.at });
  }
  const totals = { passed: 0, failed: 0, 'not-run': 0, untested: 0, waived: 0, skipped: 0, total: out.length, covered: 0 };
  for (const c of out) totals[c.status]++;
  totals.covered = totals.passed + totals.waived;
  return { criteria: out, byId: new Map(out.map((c) => [c.id, c])), totals };
}

export function isCovered(c: CriterionCoverage | undefined): boolean {
  return !!c && (c.status === 'passed' || c.status === 'waived');
}

/**
 * Coverage of one work item's criteria. A criterion that a change MODIFIES needs evidence recorded
 * after the change started; results from before describe the old behavior.
 */
export function itemCoverage(project: Project, item: ArtifactNode, report = computeCoverage(project)): CriterionCoverage[] {
  const started = item.fm.started ? String(item.fm.started) : undefined;
  return project.graph.criteriaOf(item.id).map((c) => {
    const cov = report.byId.get(c.id) ?? { id: c.id, title: c.title, owner: item.id, status: 'untested' as CoverageStatus, tests: [] };
    if (c.delta !== 'modified') return cov;
    const fresh = started && (!cov.evidenceAt || Date.parse(cov.evidenceAt) >= Date.parse(started));
    if (fresh || cov.status === 'waived') return { ...cov, title: c.title, owner: item.id };
    return { ...cov, title: c.title, owner: item.id, status: cov.tests.length ? 'not-run' : 'untested', tests: cov.tests.map((t) => ({ ...t, status: 'not-run' as const })) };
  });
}

/** Criteria of a work item that block "done" (VG-2). */
export function uncoveredFor(project: Project, item: ArtifactNode, report = computeCoverage(project)): CriterionCoverage[] {
  return itemCoverage(project, item, report).filter((c) => !isCovered(c));
}
