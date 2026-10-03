import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createKeelServer } from '../src/mcp/server.js';
import { computeStatus, computeNext } from '../src/workflow/status.js';
import { projectTrack } from '../src/workflow/engine.js';
import { computeCoverage } from '../src/verify/coverage.js';
import { readLedger } from '../src/ledger/ledger.js';
import { start } from '../src/commands/lifecycle.js';
import { newProject, write, read, flutterReport } from './helpers.js';
import { planHabits } from './plan.js';
import type { Project } from '../src/project.js';

async function connect(p: Project, name = 'claude-code') {
  const server = createKeelServer(p.root);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(b);
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name: tool, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]!.text, isError: !!r.isError };
  };
  return { client, call };
}

describe('MCP server (AE-3, NV-3)', () => {
  it('exposes the eight tools in under 5K tokens of definitions (NF-4)', async () => {
    const { client } = await connect(newProject());
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(['get_context', 'get_status', 'next_steps', 'record_decision', 'record_evidence', 'report_cost', 'request_review', 'submit_artifact']);
    expect(JSON.stringify(tools).length / 4).toBeLessThan(5000);
  });

  it('returns the same status and next steps as the CLI', async () => {
    const p = newProject();
    planHabits(p);
    const { call } = await connect(p);
    expect(JSON.parse((await call('get_status')).text)).toEqual(JSON.parse(JSON.stringify(computeStatus(p.reload()))));
    expect(JSON.parse((await call('next_steps')).text)).toEqual(JSON.parse(JSON.stringify(computeNext({ project: p, track: projectTrack(p), coverage: computeCoverage(p) }))));
  });

  it('submit_artifact validates, enforces budgets, and refuses done without evidence (VG-2, WF-6)', async () => {
    const p = newProject();
    planHabits(p);
    const { call } = await connect(p);
    const brief = await call('submit_artifact', { type: 'brief', markdown: '# Second brief\n\n' + 'line\n'.repeat(80) });
    expect(brief.isError).toBe(true);
    expect(brief.text).toMatch(/over the brief budget of 60\. Summarize or split it/);
    expect(p.reload().graph.byType('brief')).toHaveLength(1);
    const broken = await call('submit_artifact', { type: 'story', markdown: '---\ntitle: Broken\nlinks: { implements: [FR-404] }\n---\n# Broken\n\n### AC-050: x\n- When a\n- Then b\n' });
    expect(broken.isError).toBe(true);
    expect(broken.text).toMatch(/FR-404, which does not exist/);
    const ok = await call('submit_artifact', { type: 'story', markdown: '---\ntitle: Streak count\nlinks: { implements: [FR-002] }\nui: false\n---\n# Streak count\n\nAs a user I see my streak.\n\n## Acceptance criteria\n\n### AC-050: Streak increments\n- Given a 2-day streak\n- When I check off today\n- Then the streak shows 3\n' });
    expect(ok.isError).toBe(false);
    const st = JSON.parse(ok.text);
    expect(st).toMatchObject({ id: 'ST-003', status: 'draft' });
    start(p.reload(), 'ST-001');
    const refusal = await call('submit_artifact', { id: 'ST-001', status: 'done' });
    expect(refusal.isError).toBe(true);
    expect(refusal.text).toMatch(/AC-001 Saved habit is listed: no linked test/);
    const approveTry = await call('submit_artifact', { id: 'ST-003', status: 'approved' as never });
    expect(approveTry.isError).toBe(true);
    // An agent can't flip status by editing front-matter either.
    const sneaky = await call('submit_artifact', { markdown: read(p.root, p.reload().graph.get('ST-003')!.file).replace('status: draft', 'status: done') });
    expect(sneaky.isError).toBe(false);
    expect(p.reload().graph.get('ST-003')!.status).toBe('draft');
  });

  it('records evidence, decisions and cost with the agent name; flags unreported runs', async () => {
    const p = newProject();
    planHabits(p);
    start(p, 'ST-001');
    write(p.root, 'test/habit_test.dart', "void main() {\n  // @keel AC-001\n  test('saved habit is listed', () {});\n}\n");
    flutterReport(p, '.keel/tmp/test-results.jsonl', { 'saved habit is listed': 'success' });
    const { call } = await connect(p, 'cursor-vscode');
    const ctx = await call('get_context', {});
    expect(ctx.text).toContain('Current story: ST-001');
    const ev = JSON.parse((await call('record_evidence', {})).text);
    expect(ev.criteria).toEqual([{ id: 'AC-001', owner: 'ST-001', status: 'passed', tests: ['saved habit is listed'] }]);
    expect(ev.recorded).toMatch(/^\.keel\/evidence\//);
    const done = await call('submit_artifact', { id: 'ST-001', status: 'done' });
    expect(done.isError).toBe(false);
    const dec = JSON.parse((await call('record_decision', { title: 'Use Hive', link: 'ADR-001', kind: 'constraint' })).text);
    expect(dec.id).toBe('CN-001');
    expect(read(p.root, '.keel/memory/constraints.md')).toContain('- source: cursor-vscode');
    const cost = JSON.parse((await call('report_cost', { input_tokens: 1_000_000, output_tokens: 100_000, model: 'claude-sonnet-5-5' })).text);
    expect(cost.cost_usd).toBeCloseTo(3, 5);
    // A second agent that never reports cost is counted as unreported.
    const other = await connect(p, 'codex-mcp-client');
    await other.call('get_context', { id: 'ST-002' });
    const runs = readLedger(p).filter((e) => e.kind === 'run');
    expect(runs.map((r) => r.agent).sort()).toEqual(['codex-mcp-client', 'cursor-vscode']);
    expect(computeStatus(p.reload()).cost).toMatchObject({ unreported: 1 });
  });
});
