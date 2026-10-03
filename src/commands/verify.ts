import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, glob, exists } from '../util/fs.js';
import { resolveBase, isGitRepo, commitsWithRefs } from '../util/git.js';
import { parseResultsFile, type TestResult } from '../verify/results.js';
import { scanTests, scanUntagged, type LinkedTest } from '../verify/scan.js';
import { computeCoverage, mapRun, loadEvidence, recordEvidence, pruneEvidence, type CoverageReport, type CriterionCoverage, type CoverageStatus, type TestEvidence } from '../verify/coverage.js';
import { detectDrift, type DriftFinding } from '../verify/drift.js';
import { newDependencies, checkDependencies, type DepCheck, type Fetcher } from '../verify/deps.js';
import { reviewPack } from '../verify/review.js';
import { escalateIfSensitive, filesForItemSafe } from './verify-helpers.js';
import { sensitiveMatch } from '../workflow/router.js';
import { DONE_STATUSES } from '../model/registry.js';
import { truncate } from '../util/text.js';
import type { Project } from '../project.js';

export interface VerifyOptions {
  results?: string[];
  run?: boolean;
  record?: boolean;
  base?: string;
  ci?: boolean;
  deps?: boolean;
  suggest?: boolean;
  fetcher?: Fetcher;
}

export interface VerifyReport {
  ok: boolean;
  reasons: string[];
  base?: string;
  run?: { command: string; exitCode: number | null };
  results: { files: string[]; tests: number; passed: number; failed: number; skipped: number; errors: string[] };
  coverage: CoverageReport;
  required: string[];
  uncoveredRequired: CriterionCoverage[];
  drift: DriftFinding[];
  deps: DepCheck[];
  escalations: { id: string; path: string; reason: string; applied: boolean }[];
  evidence?: string;
  suggestions: { file: string; line: number; name: string; criterion: string; score: number }[];
  touched: string[];
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !['the', 'and', 'when', 'then', 'given', 'with', 'should', 'test', 'that'].includes(w)),
  );
}

/** `keel verify` (VG-1..VG-6): maps test results to criteria, checks drift and new dependencies. */
export async function verify(project: Project, opts: VerifyOptions = {}): Promise<VerifyReport> {
  const cfg = project.config;
  const reasons: string[] = [];
  let run: VerifyReport['run'];
  if (opts.run) {
    const command = cfg.verify.run;
    if (!command) reasons.push('no verify.run command configured in keel.yaml');
    else {
      ensureDir(project.paths.tmp);
      const r = spawnSync(command, { cwd: project.root, shell: true, stdio: ['ignore', 'inherit', 'inherit'] });
      run = { command, exitCode: r.status };
    }
  }
  const patterns = opts.results?.length ? opts.results : cfg.verify.results;
  const files = [...new Set(patterns.flatMap((p) => (exists(path.join(project.root, p)) ? [p] : glob(project.root, [p]))))];
  const results: TestResult[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      results.push(...parseResultsFile(project.root, f));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  const linked: LinkedTest[] = scanTests(project.root, cfg.verify.tests);
  const runMap = mapRun(results, linked);
  // Locally, results from this run override recorded evidence; in CI only this run counts.
  const merged = new Map<string, { status: CoverageStatus; tests: TestEvidence[] }>();
  if (!opts.ci) for (const ev of loadEvidence(project)) for (const [ac, v] of Object.entries(ev.criteria)) merged.set(ac, v);
  for (const [ac, v] of runMap) if (opts.ci || !merged.has(ac) || (v.status !== 'not-run' && v.status !== 'untested')) merged.set(ac, v);
  // Linked tests that never ran still show up, so "no test" and "not run" are told apart.
  const coverage = computeCoverage(project, merged);

  const g = project.graph;
  const requiredOwners = g
    .all()
    .filter((n) => n.type === 'story' || n.type === 'change')
    .filter((n) => cfg.verify.require === 'all' || DONE_STATUSES.has(n.status));
  const required = requiredOwners.flatMap((n) => g.criteriaOf(n.id).map((c) => c.id));
  const uncoveredRequired = required.map((id) => coverage.byId.get(id)!).filter((c) => c && c.status !== 'passed' && c.status !== 'waived');
  if (uncoveredRequired.length) reasons.push(`${uncoveredRequired.length} criteria of finished work lack a passing test: ${uncoveredRequired.map((c) => c.id).join(', ')}`);
  if (errors.length) reasons.push(...errors);

  const base = isGitRepo(project.root) ? resolveBase(project.root, opts.base) : undefined;
  const drift = isGitRepo(project.root) ? detectDrift(project, linked, base) : [];
  if (cfg.verify.drift === 'blocking' && drift.some((d) => d.kind === 'code-without-spec')) reasons.push('drift: code linked to requirements changed without a spec delta');

  let deps: DepCheck[] = [];
  const depPolicy = cfg.verify.dependencies.policy;
  if (depPolicy !== 'off' && opts.deps !== false) {
    const found = newDependencies(project.root, cfg.verify.dependencies.manifests, base ?? (isGitRepo(project.root) ? 'HEAD' : undefined));
    if (found.length) deps = await checkDependencies(found, { minAgeDays: cfg.verify.dependencies.min_age_days, allow: cfg.verify.dependencies.allow, fetcher: opts.fetcher });
    const bad = deps.filter((d) => d.status === 'missing' || d.status === 'too-new');
    if (bad.length && depPolicy === 'blocking') reasons.push(`dependency gate: ${bad.map((d) => `${d.name} (${d.status})`).join(', ')}`);
  }

  const escalations: VerifyReport['escalations'] = [];
  for (const ch of g.byType('change').filter((c) => c.status === 'in-progress' && c.fm.track === 'quick')) {
    if (opts.ci) {
      const s = sensitiveMatch([...filesForItemSafe(project, ch), ...((ch.fm.files as string[]) ?? [])], cfg);
      if (s) escalations.push({ id: ch.id, ...s, applied: false });
    } else {
      const s = escalateIfSensitive(project, ch);
      if (s) escalations.push({ id: ch.id, ...s, applied: true });
    }
  }
  if (opts.ci && escalations.length) reasons.push(`Quick change touches a sensitive path: ${escalations.map((e) => `${e.id} → ${e.path}`).join(', ')}`);

  let evidence: string | undefined;
  if (opts.record && results.length) {
    const criteria: Record<string, { status: CoverageStatus; tests: TestEvidence[] }> = {};
    for (const [ac, v] of runMap) if (v.status !== 'not-run' && v.status !== 'untested') criteria[ac] = v;
    const ev = recordEvidence(project, { sources: files, criteria });
    pruneEvidence(project);
    evidence = `.keel/evidence/${ev.run}.json`;
  }

  const suggestions: VerifyReport['suggestions'] = [];
  if (opts.suggest) {
    const crit = g.byType('criterion').filter((c) => !coverage.byId.get(c.id)?.tests.length);
    for (const t of scanUntagged(project.root, cfg.verify.tests)) {
      const tt = tokens(t.name);
      let best: { id: string; score: number } | undefined;
      for (const c of crit) {
        const ct = tokens([c.title, ...(c.when ?? []), ...(c.then ?? [])].join(' '));
        const inter = [...tt].filter((w) => ct.has(w)).length;
        const score = inter / (tt.size + ct.size - inter || 1);
        if (!best || score > best.score) best = { id: c.id, score };
      }
      if (best && best.score >= 0.15) suggestions.push({ ...t, criterion: best.id, score: Number(best.score.toFixed(2)) });
    }
    suggestions.sort((a, b) => b.score - a.score);
  }

  const touched = new Set<string>();
  if (base) for (const c of commitsWithRefs(project.root, { range: `${base}..HEAD` })) for (const r of c.refs) if (g.get(r)) touched.add(g.owner(r)!.id);
  for (const n of g.activeWork()) if (n.status === 'in-progress') touched.add(n.id);

  const t = results;
  return {
    ok: reasons.length === 0,
    reasons,
    base,
    run,
    results: {
      files,
      tests: t.length,
      passed: t.filter((r) => r.status === 'passed').length,
      failed: t.filter((r) => r.status === 'failed').length,
      skipped: t.filter((r) => r.status === 'skipped').length,
      errors,
    },
    coverage,
    required,
    uncoveredRequired,
    drift,
    deps,
    escalations,
    evidence,
    suggestions,
    touched: [...touched].sort(),
  };
}

const LABEL: Record<CoverageStatus, string> = { passed: 'PASS', failed: 'FAIL', waived: 'WAIVED', untested: 'NO TEST', 'not-run': 'NOT RUN', skipped: 'SKIPPED' };

export function renderVerifyText(r: VerifyReport): string {
  const out: string[] = [];
  const t = r.coverage.totals;
  out.push(`${r.ok ? 'PASSED' : 'FAILED'} keel verify`);
  out.push(`Results: ${r.results.files.length ? r.results.files.join(', ') : 'none found'} · ${r.results.tests} tests (${r.results.passed} passed, ${r.results.failed} failed, ${r.results.skipped} skipped)`);
  if (r.run) out.push(`Ran: ${r.run.command} (exit ${r.run.exitCode})`);
  out.push(`Criteria: ${t.covered}/${t.total} covered · ${t.passed} pass · ${t.failed} fail · ${t.untested} no test · ${t['not-run']} not run · ${t.waived} waived`);
  out.push('');
  for (const c of r.coverage.criteria) {
    const test = c.tests[0];
    out.push(`  [${LABEL[c.status]}] ${c.id} (${c.owner ?? '?'}) ${truncate(c.title, 50)}${test ? ` ← ${test.file ?? ''} "${truncate(test.name, 50)}"${c.tests.length > 1 ? ` +${c.tests.length - 1}` : ''}` : ''}`);
  }
  if (r.drift.length) {
    out.push('', `Drift (${r.drift.length}):`);
    for (const d of r.drift.slice(0, 10)) out.push(`  - ${d.message}`);
  }
  if (r.deps.length) {
    out.push('', `New dependencies (${r.deps.length}):`);
    for (const d of r.deps) out.push(`  [${d.status.toUpperCase()}] ${d.ecosystem} ${d.name}: ${d.message}`);
  }
  for (const e of r.escalations) out.push(`Escalation: ${e.id} touches ${e.path} (${e.reason})${e.applied ? '; moved to the Feature track' : ''}`);
  if (r.evidence) out.push('', `Recorded evidence: ${r.evidence}`);
  if (r.suggestions.length) {
    out.push('', 'Suggested links for untagged tests (add `@keel <id>` above the test):');
    for (const s of r.suggestions.slice(0, 15)) out.push(`  ${s.file}:${s.line} "${truncate(s.name, 50)}" → ${s.criterion} (score ${s.score})`);
  }
  if (r.reasons.length) out.push('', ...r.reasons.map((x) => `✗ ${x}`));
  return out.join('\n');
}

/** Markdown for the PR comment and GitHub step summary. */
export function renderVerifyMarkdown(r: VerifyReport, project: Project): string {
  const t = r.coverage.totals;
  const out: string[] = ['<!-- keel-verify -->', `## Keel verify: ${r.ok ? '✅ passed' : '❌ failed'}`, ''];
  out.push('| Check | Result |', '| --- | --- |');
  out.push(`| Criteria coverage | ${t.covered}/${t.total} covered; ${r.uncoveredRequired.length} required uncovered |`);
  out.push(`| Tests | ${r.results.tests} (${r.results.passed} passed, ${r.results.failed} failed) from ${r.results.files.length} report(s) |`);
  out.push(`| Drift | ${r.drift.length ? `${r.drift.length} finding(s) (${project.config.verify.drift})` : 'none'} |`);
  const bad = r.deps.filter((d) => d.status === 'missing' || d.status === 'too-new');
  out.push(`| New dependencies | ${r.deps.length ? `${r.deps.length} new, ${bad.length} blocked` : 'none'} |`);
  if (r.reasons.length) out.push('', ...r.reasons.map((x) => `- ❌ ${x}`));
  if (r.uncoveredRequired.length) {
    out.push('', '### Uncovered criteria', '| Criterion | Owner | Status |', '| --- | --- | --- |');
    for (const c of r.uncoveredRequired.slice(0, 30)) out.push(`| ${c.id} ${truncate(c.title, 60)} | ${c.owner ?? ''} | ${LABEL[c.status]} |`);
  }
  if (r.drift.length) out.push('', '### Drift', ...r.drift.slice(0, 15).map((d) => `- ${d.message}`));
  if (r.deps.length) {
    out.push('', '### New dependencies', '| Package | Registry | Result |', '| --- | --- | --- |');
    for (const d of r.deps) out.push(`| \`${d.name}\` | ${d.ecosystem} | ${d.status}: ${d.message} |`);
  }
  if (r.touched.length) {
    out.push('', '### Review packs');
    for (const id of r.touched.slice(0, 5)) {
      try {
        out.push(`<details><summary>${id}</summary>`, '', reviewPack(project, id, r.coverage), '', '</details>');
      } catch {
        // Item no longer exists on this branch; skip.
      }
    }
  }
  return out.join('\n') + '\n';
}
