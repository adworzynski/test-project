import { readTextIf } from '../util/fs.js';
import { appendLedger, readLedger, summarizeCost, effectiveCosts, type CostGroupBy, type CostSummary } from '../ledger/ledger.js';
import { currentItem } from '../agents/context.js';
import { KeelError } from '../util/errors.js';
import type { Project } from '../project.js';

export interface ClaudeHookInput {
  session_id?: string;
  transcript_path?: string;
  source?: string;
}

/** Sums token usage per model from a Claude Code transcript, counting each API message once. */
export function claudeTranscriptUsage(text: string): Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> {
  const seen = new Set<string>();
  const out = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let ev: { type?: string; requestId?: string; message?: { id?: string; model?: string; usage?: Record<string, number> } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const u = ev.message?.usage;
    if (ev.type !== 'assistant' || !u || !ev.message?.model) continue;
    const key = ev.message.id ?? ev.requestId;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const m = out.get(ev.message.model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    m.input += u.input_tokens ?? 0;
    m.output += u.output_tokens ?? 0;
    m.cacheRead += u.cache_read_input_tokens ?? 0;
    m.cacheWrite += u.cache_creation_input_tokens ?? 0;
    out.set(ev.message.model, m);
  }
  return out;
}

/** Claude Code Stop hook: records the session's cumulative usage per model (RC-3). Never throws. */
export function claudeStopHook(project: Project, input: ClaudeHookInput): number {
  if (!input.session_id || !input.transcript_path) return 0;
  const text = readTextIf(input.transcript_path);
  if (!text) return 0;
  const ref = currentItem(project)?.id;
  let n = 0;
  for (const [model, u] of claudeTranscriptUsage(text)) {
    if (model === '<synthetic>') continue;
    appendLedger(project, {
      kind: 'cost',
      run: `claude-${input.session_id}`,
      agent: 'claude-code',
      model,
      ref,
      input_tokens: u.input,
      output_tokens: u.output,
      cache_read_tokens: u.cacheRead,
      cache_write_tokens: u.cacheWrite,
      note: 'cumulative',
    });
    n++;
  }
  return n;
}

/** Claude Code SessionStart hook: registers the session as a run so unreported runs can be counted. */
export function claudeSessionHook(project: Project, input: ClaudeHookInput): void {
  if (!input.session_id) return;
  const run = `claude-${input.session_id}`;
  if (readLedger(project).some((e) => e.kind === 'run' && e.run === run)) return;
  appendLedger(project, { kind: 'run', run, agent: 'claude-code', ref: currentItem(project)?.id, note: input.source });
}

export function addCost(
  project: Project,
  o: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; usd?: number; model?: string; ref?: string; step?: string; agent?: string },
) {
  if (o.input === undefined && o.output === undefined && o.usd === undefined) throw new KeelError('Give tokens (--input/--output) or a cost (--usd).');
  return appendLedger(project, {
    kind: 'cost',
    agent: o.agent ?? 'manual',
    model: o.model,
    ref: o.ref?.toUpperCase() ?? currentItem(project)?.id,
    step: o.step,
    input_tokens: o.input,
    output_tokens: o.output,
    cache_read_tokens: o.cacheRead,
    cache_write_tokens: o.cacheWrite,
    cost_usd: o.usd,
  });
}

/** Totals per release: the stories and changes a release checklist includes. */
export function costByRelease(project: Project): CostSummary['groups'] {
  const costs = effectiveCosts(readLedger(project));
  const groups: CostSummary['groups'] = {};
  for (const r of project.graph.byType('release')) {
    const inc = new Set(r.links.includes ?? []);
    const g = (groups[r.id] = { usd: 0, tokens: 0, entries: 0 });
    for (const c of costs) {
      if (!c.ref || !inc.has(c.ref)) continue;
      g.usd += c.cost_usd ?? 0;
      g.tokens += (c.input_tokens ?? 0) + (c.output_tokens ?? 0) + (c.cache_read_tokens ?? 0) + (c.cache_write_tokens ?? 0);
      g.entries++;
    }
  }
  return groups;
}

export function costReport(project: Project, by: CostGroupBy | 'release' = 'ref'): CostSummary {
  if (by === 'release') {
    const s = summarizeCost(project, 'ref');
    return { ...s, groups: costByRelease(project) };
  }
  return summarizeCost(project, by);
}
