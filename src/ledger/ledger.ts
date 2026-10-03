import path from 'node:path';
import { appendText, listDir, readTextIf } from '../util/fs.js';
import { nowIso } from '../util/text.js';
import { costOf, priceFor, type Usage } from './pricing.js';
import type { Project } from '../project.js';

/** One line of .keel/ledger/YYYY-MM.jsonl (RC-3). Local only; never sent anywhere. */
export interface LedgerEntry extends Usage {
  kind: 'run' | 'cost';
  at: string;
  /** Groups a run start with its cost report. MCP sessions and hook sessions each get one. */
  run?: string;
  agent?: string;
  model?: string;
  ref?: string;
  step?: string;
  cost_usd?: number;
  estimated?: boolean;
  note?: string;
}

function ledgerFile(project: Project, at: string): string {
  return path.join(project.paths.ledger, `${at.slice(0, 7)}.jsonl`);
}

export function appendLedger(project: Project, entry: Omit<LedgerEntry, 'at'> & { at?: string }): LedgerEntry {
  const full: LedgerEntry = { ...entry, at: entry.at ?? nowIso() };
  if (full.kind === 'cost' && full.cost_usd === undefined) {
    const price = priceFor(full.model, project.config.pricing);
    if (price) {
      full.cost_usd = Number(costOf(full, price).toFixed(6));
      full.estimated = true;
    }
  }
  for (const k of Object.keys(full) as (keyof LedgerEntry)[]) if (full[k] === undefined) delete full[k];
  appendText(ledgerFile(project, full.at), JSON.stringify(full) + '\n');
  return full;
}

export function readLedger(project: Project): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const f of listDir(project.paths.ledger).sort()) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of (readTextIf(path.join(project.paths.ledger, f)) ?? '').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as LedgerEntry);
      } catch {
        // Skip a corrupt line rather than failing every command.
      }
    }
  }
  return out;
}

/**
 * Cost entries, deduplicated: hook-based reporters re-send cumulative session totals, so for a
 * run that reported several times only the last report counts.
 */
export function effectiveCosts(entries: LedgerEntry[]): LedgerEntry[] {
  const byRun = new Map<string, LedgerEntry>();
  const loose: LedgerEntry[] = [];
  for (const e of entries) {
    if (e.kind !== 'cost') continue;
    if (e.run && e.note === 'cumulative') byRun.set(`${e.run}|${e.model ?? ''}`, e);
    else loose.push(e);
  }
  return [...loose, ...byRun.values()];
}

export interface CostSummary {
  usd: number;
  tokens: number;
  unknownCost: number;
  runs: number;
  unreported: string[];
  groups: Record<string, { usd: number; tokens: number; entries: number }>;
}

export type CostGroupBy = 'ref' | 'step' | 'agent' | 'model' | 'month';

export function summarizeCost(project: Project, by: CostGroupBy = 'ref', entries = readLedger(project)): CostSummary {
  const costs = effectiveCosts(entries);
  const runs = entries.filter((e) => e.kind === 'run');
  const reported = new Set(costs.map((c) => c.run).filter(Boolean));
  const unreported = runs.filter((r) => r.run && !reported.has(r.run)).map((r) => r.run!);
  const groups: CostSummary['groups'] = {};
  let usd = 0;
  let tokens = 0;
  let unknownCost = 0;
  for (const c of costs) {
    const t = (c.input_tokens ?? 0) + (c.output_tokens ?? 0) + (c.cache_read_tokens ?? 0) + (c.cache_write_tokens ?? 0);
    tokens += t;
    if (c.cost_usd === undefined) unknownCost++;
    else usd += c.cost_usd;
    const key = by === 'month' ? c.at.slice(0, 7) : String(c[by] ?? '(none)');
    const g = (groups[key] ??= { usd: 0, tokens: 0, entries: 0 });
    g.usd += c.cost_usd ?? 0;
    g.tokens += t;
    g.entries++;
  }
  return { usd, tokens, unknownCost, runs: runs.length, unreported: [...new Set(unreported)], groups };
}

/** Average cost of past runs of a step, for the pre-run warning (RC-4). */
export function estimateStepCost(project: Project, step: string): number | undefined {
  const costs = effectiveCosts(readLedger(project)).filter((c) => c.step === step && c.cost_usd !== undefined);
  if (!costs.length) return undefined;
  return costs.reduce((s, c) => s + c.cost_usd!, 0) / costs.length;
}
