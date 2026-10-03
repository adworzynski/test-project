import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Project } from '../project.js';
import { pkgVersion } from '../paths.js';
import { computeStatus, computeNext } from '../workflow/status.js';
import { projectTrack } from '../workflow/engine.js';
import { computeCoverage } from '../verify/coverage.js';
import { contextPack, sessionBrief, currentItem } from '../agents/context.js';
import { submitArtifact } from '../commands/submit.js';
import { review } from '../commands/lifecycle.js';
import { verify } from '../commands/verify.js';
import { appendMemory } from '../memory/memory.js';
import { appendLedger } from '../ledger/ledger.js';
import { currentUser } from '../util/user.js';
import { shortId } from '../util/hash.js';
import { KeelError } from '../util/errors.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (v: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (e: unknown): ToolResult => {
  const msg = e instanceof KeelError ? [e.message, ...e.details.map((d) => `- ${d}`)].join('\n') : e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text', text: msg }], isError: true };
};

/**
 * The Keel MCP server (AE-3, NV-3): local stdio only (NF-6). Every call re-reads the repo, so the CLI
 * and other agents' changes are always visible; results match `keel status --json` and `keel next --json`.
 */
export function createKeelServer(root: string): McpServer {
  const server = new McpServer({ name: 'keel', version: pkgVersion() });
  const run = `mcp-${shortId()}`;
  let runRecorded = false;
  const agent = () => server.server.getClientVersion()?.name ?? 'mcp-client';
  const project = () => new Project(root);
  const handle = (fn: (p: Project) => unknown) => async (): Promise<ToolResult> => {
    try {
      return ok(await fn(project()));
    } catch (e) {
      return fail(e);
    }
  };
  const handleArgs =
    <A>(fn: (p: Project, a: A) => unknown) =>
    async (a: A): Promise<ToolResult> => {
      try {
        return ok(await fn(project(), a));
      } catch (e) {
        return fail(e);
      }
    };

  server.registerTool(
    'get_status',
    { description: 'Keel project state: phase, artifacts by status, open gates, blocked items, criteria coverage, cost, next actions.', inputSchema: {} },
    handle((p) => computeStatus(p)),
  );

  server.registerTool(
    'next_steps',
    { description: 'The next 1-3 actions, each with the command or skill to run. Call when unsure what to do.', inputSchema: {} },
    handle((p) => computeNext({ project: p, track: projectTrack(p), coverage: computeCoverage(p) })),
  );

  server.registerTool(
    'get_context',
    {
      description:
        'Call first in every session and after compaction. Without id: session brief (current item, open criteria, constraints, next steps). With id (ST-/CH-): full context pack.',
      inputSchema: { id: z.string().optional(), budget: z.number().int().min(1000).optional() },
    },
    handleArgs((p, a: { id?: string; budget?: number }) => {
      const item = a.id ? p.graph.get(a.id.toUpperCase()) : currentItem(p);
      if (!runRecorded) {
        appendLedger(p, { kind: 'run', run, agent: agent(), ref: item?.id });
        runRecorded = true;
      }
      if (!a.id) return sessionBrief(p);
      const pack = contextPack(p, a.id, a.budget);
      return `${pack.markdown}\n_Context pack: ${pack.tokens} of ${pack.budget} tokens._`;
    }),
  );

  server.registerTool(
    'submit_artifact',
    {
      description:
        'Save an artifact you drafted (full Markdown with front-matter, or body plus type/title). Validates schema, links and length budget. Optional status: pending-review, in-progress or done (done needs passing tests for every criterion).',
      inputSchema: {
        markdown: z.string().optional(),
        type: z.string().optional(),
        id: z.string().optional(),
        title: z.string().optional(),
        status: z.enum(['pending-review', 'in-progress', 'done']).optional(),
      },
    },
    handleArgs((p, a: { markdown?: string; type?: string; id?: string; title?: string; status?: string }) => submitArtifact(p, a)),
  );

  server.registerTool(
    'request_review',
    { description: 'Move an artifact to pending-review and return its review pack. A person then approves or rejects it.', inputSchema: { id: z.string() } },
    handleArgs((p, a: { id: string }) => review(p, a.id, { request: true }).pack),
  );

  server.registerTool(
    'record_evidence',
    {
      description: 'Read test reports (JUnit XML, flutter --machine JSON, Jest JSON), map tests tagged @keel AC-… to criteria and record the evidence. run=true runs the configured test command first.',
      inputSchema: { results: z.array(z.string()).optional(), run: z.boolean().optional() },
    },
    handleArgs(async (p, a: { results?: string[]; run?: boolean }) => {
      const r = await verify(p, { results: a.results, run: a.run, record: true, deps: false });
      const active = p.graph.activeWork().filter((n) => n.status === 'in-progress');
      const crit = active.flatMap((n) => p.graph.criteriaOf(n.id).map((c) => r.coverage.byId.get(c.id)!)).filter(Boolean);
      return {
        recorded: r.evidence ?? null,
        tests: r.results,
        criteria: crit.map((c) => ({ id: c.id, owner: c.owner, status: c.status, tests: c.tests.map((t) => t.name) })),
        problems: r.reasons,
      };
    }),
  );

  server.registerTool(
    'record_decision',
    {
      description: 'Append a decision (default) or a constraint to the project memory every agent sees. Use for choices between options and for user corrections.',
      inputSchema: {
        title: z.string(),
        text: z.string().optional(),
        kind: z.enum(['decision', 'constraint']).optional(),
        link: z.string().optional(),
        step: z.string().optional(),
      },
    },
    handleArgs((p, a: { title: string; text?: string; kind?: 'decision' | 'constraint'; link?: string; step?: string }) => {
      const id = appendMemory(p.paths, p.root, { kind: a.kind ?? 'decision', title: a.title, text: a.text, link: a.link, step: a.step, by: currentUser(p.root), source: agent() });
      return { id };
    }),
  );

  server.registerTool(
    'report_cost',
    {
      description: 'Record tokens and cost of your work in the local ledger. ref defaults to the item in progress.',
      inputSchema: {
        input_tokens: z.number().int().min(0).optional(),
        output_tokens: z.number().int().min(0).optional(),
        cache_read_tokens: z.number().int().min(0).optional(),
        cache_write_tokens: z.number().int().min(0).optional(),
        cost_usd: z.number().min(0).optional(),
        model: z.string().optional(),
        ref: z.string().optional(),
        step: z.string().optional(),
      },
    },
    handleArgs((p, a: Record<string, number | string | undefined>) => {
      const e = appendLedger(p, { kind: 'cost', run, agent: agent(), ref: (a.ref as string | undefined) ?? currentItem(p)?.id, ...a });
      return { recorded: true, cost_usd: e.cost_usd ?? null, estimated: !!e.estimated };
    }),
  );
  return server;
}

export async function serveStdio(root: string): Promise<void> {
  const server = createKeelServer(root);
  await server.connect(new StdioServerTransport());
}
