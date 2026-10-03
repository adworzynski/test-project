import type { Command } from 'commander';
import { Option } from 'commander';
import type { Project } from '../project.js';
import { STACKS, PROFILES, ALL_AGENTS, type AgentId, type Profile, type Stack } from '../config.js';
import { initProject } from './init.js';
import { computeStatus, computeNext } from '../workflow/status.js';
import { projectTrack } from '../workflow/engine.js';
import { computeCoverage } from '../verify/coverage.js';
import { renderStatus, renderNext, renderDiagnostics } from './render.js';
import { checkProject } from './check.js';
import { addArtifact, newChange, rerouteChange, review, approve, reject, waive, start, done, refine } from './lifecycle.js';
import { compileAgents } from '../agents/compile.js';
import { c } from '../util/output.js';
import { KeelError } from '../util/errors.js';
import { interactive, ask } from '../util/prompt.js';
import { detectStack } from './init.js';
import { generateSpec } from '../spec/living.js';

import fs from 'node:fs';
import { verify, renderVerifyText, renderVerifyMarkdown } from './verify.js';
import { contextPack, sessionBrief } from '../agents/context.js';
import { appendMemory } from '../memory/memory.js';
import { currentUser } from '../util/user.js';
import { costReport, addCost, claudeStopHook, claudeSessionHook, type ClaudeHookInput } from './cost.js';
import { trace, renderTrace } from './trace.js';
import { stats } from './stats.js';
import { importBmad } from '../importers/bmad.js';
import { importSpecKit } from '../importers/speckit.js';
import { importPrdSource } from '../importers/prd.js';
import { exportSpecKit } from '../exporters/speckit.js';
import { createRelease, releaseNotes } from '../release/release.js';
import { serveDashboard, renderDashboard } from '../ui/dashboard.js';
import { buildIndex, queryIndex } from './indexdb.js';
import { explain } from './explain.js';
import { upgradePack } from './upgrade.js';
import { installGitHook, commitMsgHook } from './githook.js';
import { table } from '../util/output.js';
import { Project as ProjectClass } from '../project.js';
import { findProjectRoot } from '../paths.js';
import type { ImportReport } from '../importers/common.js';

export interface Ctx {
  cwd: () => string;
  openProject: () => Project;
}

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function parseLinks(values: string[] | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const v of values ?? []) {
    const m = v.match(/^([a-z_]+)[:=](.+)$/i);
    if (!m) throw new KeelError(`--link expects rel:ID[,ID], e.g. implements:FR-001 (got "${v}")`);
    out[m[1]!] = [...(out[m[1]!] ?? []), ...m[2]!.split(',').map((s) => s.trim().toUpperCase())];
  }
  return out;
}

const collect = (v: string, prev: string[] = []) => [...prev, v];

export function registerCommands(program: Command, ctx: Ctx) {
  registerCoreCommands(program, ctx);
  registerMoreCommands(program, ctx);
}

function registerCoreCommands(program: Command, ctx: Ctx) {
  program
    .command('init')
    .description('Detect the stack and agents, pick a profile, write .keel/ and agent files')
    .addOption(new Option('--stack <stack>', 'app stack').choices(STACKS))
    .addOption(new Option('--profile <profile>', 'profile').choices(PROFILES))
    .option('--agents <list>', `comma-separated agents (${ALL_AGENTS.join(', ')})`)
    .option('--name <name>', 'project name')
    .option('--no-ci', 'do not write .github/workflows/keel.yml')
    .option('--force', 'rewrite keel.yaml if it exists')
    .option('--json', 'machine-readable output')
    .action(async (o) => {
      const root = ctx.cwd();
      let stack = o.stack as Stack | undefined;
      if (!stack && !detectStack(root) && interactive()) {
        const a = await ask(`Which stack? (${STACKS.join(', ')})`, 'flutter');
        if (!STACKS.includes(a as Stack)) throw new KeelError(`Unknown stack ${a}`);
        stack = a as Stack;
      }
      const agents = o.agents ? (String(o.agents).split(',').map((s) => s.trim()) as AgentId[]) : undefined;
      for (const a of agents ?? []) if (!ALL_AGENTS.includes(a)) throw new KeelError(`Unknown agent ${a}; use ${ALL_AGENTS.join(', ')}`);
      const r = initProject(root, { stack, profile: o.profile as Profile | undefined, agents, project: o.name, force: o.force, ci: o.ci });
      if (o.json) return json(r);
      console.log(`${c.green('Initialized')} Keel for ${c.bold(r.config.project)}: ${r.config.profile} profile, ${r.config.stack} stack${r.detected.stack ? ' (detected)' : ''}.`);
      console.log(`Agents: ${r.config.agents.join(', ')}${r.detected.agents.length ? ' (detected)' : ' (none detected, so all four)'}.`);
      console.log(`Wrote .keel/ and ${r.compile.written.length} agent files (AGENTS.md, skills, MCP config, hooks).`);
      for (const w of r.compile.warnings) console.log(`${c.yellow('warning')} ${w}`);
      const p = ctx.openProject();
      console.log('\n' + c.bold('Next'));
      console.log(renderNext(computeNext({ project: p, track: projectTrack(p), coverage: computeCoverage(p) })));
    });

  program
    .command('status')
    .description('Current phase, artifacts by status, open gates, blocked items, coverage, cost')
    .option('--json', 'machine-readable output (same as the MCP get_status tool)')
    .action((o) => {
      const s = computeStatus(ctx.openProject());
      if (o.json) return json(s);
      console.log(renderStatus(s));
    });

  program
    .command('next')
    .description('The next 1–3 actions, each with the command or skill to run')
    .option('--json', 'machine-readable output (same as the MCP next_steps tool)')
    .action((o) => {
      const p = ctx.openProject();
      const n = computeNext({ project: p, track: projectTrack(p), coverage: computeCoverage(p) });
      if (o.json) return json(n);
      console.log(renderNext(n));
    });

  program
    .command('check')
    .description('Validate artifacts, IDs, links, workflows and budgets')
    .option('--json', 'machine-readable output')
    .option('--strict', 'treat warnings as errors')
    .action((o) => {
      const ds = checkProject(ctx.openProject());
      const errors = ds.filter((d) => d.level === 'error' || (o.strict && d.level === 'warning'));
      if (o.json) json(ds);
      else if (!ds.length) console.log(`${c.green('ok')} No problems found.`);
      else {
        console.log(renderDiagnostics(ds));
        console.log(`\n${ds.filter((d) => d.level === 'error').length} errors, ${ds.filter((d) => d.level === 'warning').length} warnings.`);
      }
      if (errors.length) process.exitCode = 1;
    });

  program
    .command('add <type> <title>')
    .description('Create a draft artifact from its template: brief, prd, screen-map, design-tokens, adr, story')
    .option('-l, --link <rel:ID>', 'add a link, e.g. implements:FR-001 (repeatable)', collect)
    .option('--json', 'machine-readable output')
    .action((type, title, o) => {
      const r = addArtifact(ctx.openProject(), type, title, parseLinks(o.link));
      if (o.json) return json(r);
      console.log(`${c.green('Created')} ${r.id} at ${r.file}`);
    });

  program
    .command('new <description>')
    .description('Start a change; the router picks Quick or Feature and explains why')
    .addOption(new Option('--track <track>', 'override the router').choices(['quick', 'feature']))
    .option('--paths <files...>', 'files the change will touch')
    .option('--affects <ids...>', 'requirements or criteria it affects')
    .option('--title <title>', 'short title (defaults to the first sentence)')
    .option('--json', 'machine-readable output')
    .action((description, o) => {
      const r = newChange(ctx.openProject(), description, { track: o.track, paths: o.paths, affects: o.affects, title: o.title });
      if (o.json) return json(r);
      console.log(`${c.green('Created')} ${r.id} on the ${c.bold(r.decision.track === 'quick' ? 'Quick' : 'Feature')} track: ${r.file}`);
      for (const why of r.decision.reasons) console.log(`  - ${why}`);
      if (!r.overridden) console.log(`Override: keel route ${r.id} --track ${r.decision.track === 'quick' ? 'feature' : 'quick'}`);
    });

  program
    .command('route <id>')
    .description('Override a change’s track, or re-check a Quick change for sensitive paths')
    .addOption(new Option('--track <track>', 'set the track').choices(['quick', 'feature']))
    .option('--json', 'machine-readable output')
    .action((id, o) => {
      const r = rerouteChange(ctx.openProject(), id, { track: o.track });
      if (o.json) return json(r);
      if (r.escalated) console.log(`${c.yellow('Escalated')} ${id.toUpperCase()} to Feature: it touches ${r.escalated.path} (${r.escalated.reason}).`);
      else console.log(r.changed ? `${id.toUpperCase()} is now on the ${r.track} track.` : `${id.toUpperCase()} stays on the ${r.track} track.`);
    });

  program
    .command('review <id>')
    .description('Show the review pack; with --request, move the artifact to pending-review')
    .option('--request', 'request review (ends the step at its gate)')
    .option('--json', 'machine-readable output')
    .action((id, o) => {
      const r = review(ctx.openProject(), id, { request: o.request });
      if (o.json) return json(r);
      console.log(r.pack);
      if (r.file) console.log(`\n${c.dim(`Saved to ${r.file}; ${id.toUpperCase()} is now ${r.status}.`)}`);
    });

  program
    .command('approve <id>')
    .description('Approve a gate: records who, when and the artifact hash')
    .option('-m, --message <text>', 'note stored with the decision')
    .option('--force', 'approve despite lint errors')
    .option('--json', 'machine-readable output')
    .action((id, o) => {
      const r = approve(ctx.openProject(), id, { message: o.message, force: o.force });
      if (o.json) return json(r);
      console.log(`${c.green('Approved')} ${r.id} (${r.status}) by ${r.by}, hash ${r.hash}.`);
    });

  program
    .command('reject <id>')
    .description('Return an artifact with a reason')
    .requiredOption('-m, --message <text>', 'what to change')
    .action((id, o) => {
      const r = reject(ctx.openProject(), id, o.message);
      console.log(`${c.yellow('Returned')} ${r.id} by ${r.by}: ${o.message}`);
    });

  program
    .command('waive <criterion>')
    .description('Accept a criterion without an automated test (human only, needs a reason)')
    .option('-m, --message <text>', 'why no automated test is possible')
    .option('--revoke', 'revoke an existing waiver')
    .action((id, o) => {
      const r = waive(ctx.openProject(), id, o.message ?? '', { revoke: o.revoke });
      console.log(o.revoke ? `Revoked the waiver on ${r.id}.` : `${c.yellow('Waived')} ${r.id} by ${r.by}: ${o.message}`);
    });

  program
    .command('start <id>')
    .description('Start a story or change (checks its gates first)')
    .option('--force', 'start despite open gates')
    .option('--json', 'machine-readable output')
    .action((id, o) => {
      const r = start(ctx.openProject(), id, { force: o.force });
      if (o.json) return json(r);
      for (const w of r.warnings) console.log(`${c.yellow('warning')} ${w}`);
      console.log(`${c.green('Started')} ${r.id}. Get its context pack with: keel context ${r.id}`);
    });

  program
    .command('done <id>')
    .description('Finish a story, change or release; refuses without evidence for every criterion')
    .option('--json', 'machine-readable output')
    .action((id, o) => {
      const r = done(ctx.openProject(), id);
      if (o.json) return json(r);
      console.log(`${c.green('Done')} ${r.id} (${r.status}).`);
      for (const m of r.merged ?? []) console.log(`  - ${m}`);
      if (r.review) console.log(c.dim(`Review pack: ${r.review}`));
    });

  program
    .command('refine [id]')
    .description('Impact preview after editing an approved artifact; --apply flags downstream for review')
    .option('--apply', 'mark downstream artifacts needs-review and send the edited one back to review')
    .option('--json', 'machine-readable output')
    .action((id, o) => {
      const rs = refine(ctx.openProject(), id, { apply: o.apply });
      if (o.json) return json(rs);
      if (!rs.length) return console.log('No approved artifact changed since its approval.');
      for (const r of rs) {
        console.log(`${c.bold(r.artifact)} changed${r.items.length ? `: ${r.items.join(', ')}` : ''}`);
        if (!r.downstream.length) console.log('  Nothing downstream.');
        for (const d of r.downstream) console.log(`  → ${d.id} ${d.type} · ${d.title}`);
        for (const t of r.tests.slice(0, 10)) console.log(`    test ${t.file ?? ''} "${t.name}" (${t.criterion})`);
        console.log(r.applied ? c.yellow(`  Flagged ${r.downstream.length} artifacts as needs-review; ${r.artifact} is back in review.`) : c.dim(`  Apply with: keel refine ${r.artifact} --apply`));
      }
    });

  program
    .command('compile')
    .description('Regenerate AGENTS.md, CLAUDE.md, Copilot and Cursor rules, skills, MCP config and hooks')
    .option('--json', 'machine-readable output')
    .action((o) => {
      const r = compileAgents(ctx.openProject());
      if (o.json) return json(r);
      console.log(`${r.written.length ? c.green(`Wrote ${r.written.length} files`) : 'Everything up to date'}${r.unchanged.length ? `, ${r.unchanged.length} unchanged` : ''}.`);
      for (const f of r.written) console.log(`  ${f}`);
      for (const w of r.warnings) console.log(`${c.yellow('warning')} ${w}`);
    });

  program
    .command('spec')
    .description('Regenerate the living spec in .keel/spec/')
    .action(() => {
      const r = generateSpec(ctx.openProject());
      console.log(r.written.length || r.removed.length ? `Updated ${r.written.length} and removed ${r.removed.length} spec files.` : 'Living spec is up to date.');
    });
}

// ---------------------------------------------------------------------------------------------
// Verification, context, memory, cost, trace, migration, release, dashboard, index, upgrade.


async function readStdinJson<T>(): Promise<T | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function printImport(r: ImportReport, label: string) {
  console.log(`${c.green('Imported')} ${r.created.length} artifacts from ${label} (${r.source}).`);
  const counts = new Map<string, number>();
  for (const a of r.created) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  console.log(`  ${[...counts].map(([t, n]) => `${n} ${t}`).join(', ')}`);
  if (r.unlinked.length) console.log(`${c.yellow(`${r.unlinked.length} items could not be linked`)}:\n${r.unlinked.slice(0, 10).map((u) => `  - ${u}`).join('\n')}${r.unlinked.length > 10 ? '\n  …' : ''}`);
  if (r.reportFile) console.log(`Full report: ${r.reportFile}`);
  console.log('Next: keel status');
}

function registerMoreCommands(program: Command, ctx: Ctx) {
  program
    .command('verify')
    .description('Map test results to criteria, check drift and new dependencies (also the CI action)')
    .option('-r, --results <files...>', 'test report files or globs (JUnit XML, flutter --machine JSON, Jest JSON)')
    .option('--run', 'run verify.run from keel.yaml first')
    .option('--record', 'record the evidence in .keel/evidence/')
    .option('--base <ref>', 'git ref to diff against (default: PR base, origin/main or main)')
    .option('--ci', 'CI mode: only this run counts as evidence; never modifies files')
    .option('--no-deps', 'skip the dependency gate (no network)')
    .option('--suggest', 'propose criterion links for untagged tests')
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'markdown', 'json']).default('text'))
    .option('--out <file>', 'also write the output to a file')
    .action(async (o) => {
      const p = ctx.openProject();
      const r = await verify(p, { results: o.results, run: o.run, record: o.record, base: o.base, ci: o.ci, deps: o.deps, suggest: o.suggest });
      const text =
        o.format === 'json'
          ? JSON.stringify({ ...r, coverage: { totals: r.coverage.totals, criteria: r.coverage.criteria } }, null, 2)
          : o.format === 'markdown'
            ? renderVerifyMarkdown(r, p)
            : renderVerifyText(r);
      console.log(text);
      if (o.out) fs.writeFileSync(o.out, text.endsWith('\n') ? text : text + '\n');
      if (!r.ok) process.exitCode = 1;
    });

  program
    .command('context [id]')
    .description('Context pack for a story or change (AE-4); --session prints the short session brief')
    .option('--session', 'session-start brief (used by the SessionStart hook)')
    .option('--hook <agent>', 'called from an agent hook; reads hook JSON on stdin and never fails')
    .option('--budget <tokens>', 'token budget', (v) => Number(v))
    .option('--json', 'machine-readable output')
    .action(async (id, o) => {
      if (o.hook) {
        // Hooks must never break the agent session: print what we can and exit 0.
        try {
          const root = findProjectRoot(ctx.cwd());
          if (!root) return;
          const p = new ProjectClass(root);
          const input = await readStdinJson<ClaudeHookInput>();
          if (input && o.hook === 'claude') claudeSessionHook(p, input);
          console.log(sessionBrief(p));
        } catch {
          // ignore
        }
        return;
      }
      const p = ctx.openProject();
      if (o.session) return console.log(sessionBrief(p));
      const pack = contextPack(p, id, o.budget);
      if (o.json) return json(pack);
      console.log(pack.markdown);
      console.error(c.dim(`Context pack: ${pack.tokens} of ${pack.budget} tokens${pack.omitted.length ? `; omitted ${pack.omitted.join(', ')}` : ''}.`));
    });

  program
    .command('decide <title>')
    .description('Record a decision in .keel/memory/decisions.md (ME-1)')
    .option('-t, --text <text>', 'rationale')
    .option('-l, --link <id>', 'related artifact, e.g. ADR-002')
    .option('-s, --step <step>', 'workflow step it came from')
    .action((title, o) => {
      const p = ctx.openProject();
      const id = appendMemory(p.paths, p.root, { kind: 'decision', title, text: o.text, link: o.link, step: o.step, by: currentUser(p.root), source: 'cli' });
      console.log(`${c.green('Recorded')} ${id}: ${title}`);
    });

  program
    .command('constrain <rule>')
    .description('Save a correction as a constraint every agent sees in its context pack (ME-2)')
    .option('-t, --text <text>', 'why')
    .action((rule, o) => {
      const p = ctx.openProject();
      const id = appendMemory(p.paths, p.root, { kind: 'constraint', title: rule, text: o.text, by: currentUser(p.root), source: 'cli' });
      console.log(`${c.green('Saved')} ${id}: ${rule}`);
    });

  const cost = program.command('cost').description('Token and cost ledger: totals per item, step, agent, model, month or release');
  cost
    .command('show', { isDefault: true })
    .description('Show totals')
    .addOption(new Option('--by <key>', 'group by').choices(['ref', 'step', 'agent', 'model', 'month', 'release']).default('ref'))
    .option('--json', 'machine-readable output')
    .action((o) => {
      const r = costReport(ctx.openProject(), o.by);
      if (o.json) return json(r);
      console.log(`Total: $${r.usd.toFixed(2)} · ${r.tokens.toLocaleString('en-US')} tokens · ${r.runs} runs${r.unreported.length ? ` · ${c.yellow(`${r.unreported.length} unreported`)}` : ''}${r.unknownCost ? ` · ${r.unknownCost} entries without a price (add pricing in keel.yaml)` : ''}`);
      const rows = Object.entries(r.groups)
        .sort((a, b) => b[1].usd - a[1].usd)
        .map(([k, v]) => [k, `$${v.usd.toFixed(2)}`, v.tokens.toLocaleString('en-US'), String(v.entries)]);
      if (rows.length) console.log(table([[o.by, 'usd', 'tokens', 'entries'], ...rows], '  '));
    });
  cost
    .command('add')
    .description('Record a cost entry by hand (for agents without MCP or hooks)')
    .option('--input <n>', 'input tokens', (v) => Number(v))
    .option('--output <n>', 'output tokens', (v) => Number(v))
    .option('--cache-read <n>', 'cache read tokens', (v) => Number(v))
    .option('--cache-write <n>', 'cache write tokens', (v) => Number(v))
    .option('--usd <n>', 'cost in USD (if known)', (v) => Number(v))
    .option('--model <model>', 'model id')
    .option('--ref <id>', 'story or change (default: the one in progress)')
    .option('--step <step>', 'workflow step')
    .option('--agent <agent>', 'agent name')
    .action((o) => {
      const e = addCost(ctx.openProject(), { input: o.input, output: o.output, cacheRead: o.cacheRead, cacheWrite: o.cacheWrite, usd: o.usd, model: o.model, ref: o.ref, step: o.step, agent: o.agent });
      console.log(`Recorded${e.cost_usd !== undefined ? ` $${e.cost_usd.toFixed(4)}${e.estimated ? ' (estimated)' : ''}` : ''} for ${e.ref ?? 'no item'}.`);
    });
  cost
    .command('hook <agent>')
    .description('Agent hook entry point (claude: Stop hook reading the session transcript)')
    .action(async (agent) => {
      try {
        const root = findProjectRoot(ctx.cwd());
        if (!root || agent !== 'claude') return;
        const input = await readStdinJson<ClaudeHookInput>();
        if (input) claudeStopHook(new ProjectClass(root), input);
      } catch {
        // Hooks never fail the agent.
      }
    });

  program
    .command('trace <id>')
    .description('Upstream intent, downstream work, criteria and tests, commits and PRs for an artifact')
    .option('--json', 'machine-readable output')
    .action((id, o) => {
      const t = trace(ctx.openProject(), id);
      if (o.json) return json(t);
      console.log(renderTrace(t));
    });

  program
    .command('stats')
    .description('Generated Markdown per change and per type, against the budgets')
    .option('--json', 'machine-readable output')
    .action((o) => {
      const s = stats(ctx.openProject());
      if (o.json) return json(s);
      console.log(`Markdown in .keel/artifacts: ${s.totalLines} lines`);
      console.log(table([['type', 'files', 'lines'], ...Object.entries(s.byType).map(([k, v]) => [k, String(v.files), String(v.lines)])], '  '));
      if (s.changes.length) {
        console.log('\nChanges:');
        console.log(table([['id', 'track', 'status', 'lines', 'budget'], ...s.changes.map((x) => [x.id, x.track, x.status, String(x.lines), `${x.budget ?? '-'}${x.over ? ' OVER' : ''}`])], '  '));
      }
      if (s.timeToFirstBriefMinutes !== undefined) console.log(`\nkeel init → first approved brief: ${s.timeToFirstBriefMinutes} min`);
    });

  program
    .command('mcp')
    .description('Run the Keel MCP server on stdio (agents start this; see .mcp.json)')
    .action(async () => {
      const { serveStdio } = await import('../mcp/server.js');
      const root = findProjectRoot(ctx.cwd()) ?? ctx.cwd();
      await serveStdio(root);
    });

  const imp = program.command('import').description('Bring in artifacts from BMAD, Spec Kit or an existing PRD');
  imp
    .command('bmad [path]')
    .description('Import BMAD v4/v6 output: brief, PRD, architecture, epics, stories, sprint status')
    .option('--json', 'machine-readable output')
    .action((pth, o) => {
      const r = importBmad(ctx.openProject(), pth);
      if (o.json) return json(r);
      printImport(r, 'BMAD');
    });
  imp
    .command('speckit [path]')
    .description('Import Spec Kit: constitution, specs, plans, tasks')
    .option('--json', 'machine-readable output')
    .action((pth, o) => {
      const r = importSpecKit(ctx.openProject(), pth);
      if (o.json) return json(r);
      printImport(r, 'Spec Kit');
    });
  imp
    .command('prd <file>')
    .description('Quote an existing PRD, README or wiki export as a source for the PRD step')
    .action((file) => {
      const r = importPrdSource(ctx.openProject(), file);
      console.log(`${c.green('Quoted')} ${file} as ${r.created[0]!.id} (${r.created[0]!.file}).`);
    });

  const exp = program.command('export').description('Write Keel work in another framework’s format');
  exp
    .command('speckit <id>')
    .description('Write a story or Feature change as a Spec Kit feature folder for /speckit.implement')
    .option('--out <dir>', 'specs folder', 'specs')
    .action((id, o) => {
      const r = exportSpecKit(ctx.openProject(), id, o.out);
      console.log(`${c.green('Exported')} ${id.toUpperCase()} to ${r.dir}/ (${r.files.join(', ')}).`);
      if (r.specifyMissing) console.log(c.dim('Spec Kit commands also need its scripts: run `specify init --here` once.'));
    });

  const rel = program.command('release').description('Release checklist (RC-1) and release notes (RC-2)');
  rel
    .command('create [version]', { isDefault: true })
    .description('Create the release checklist from the PRD and screens')
    .option('--build <n>', 'build number')
    .action((version, o) => {
      const r = createRelease(ctx.openProject(), version, o.build);
      console.log(`${c.green('Created')} ${r.id} at ${r.file}. Tick each item; the submit step is yours. Then: keel done ${r.id}`);
    });
  rel
    .command('notes')
    .description('Release notes from the stories and changes finished since the last release')
    .option('--since <id>', 'a previous release checklist ID')
    .action((o) => console.log(releaseNotes(ctx.openProject(), { since: o.since })));

  program
    .command('ui')
    .description('Local read-only dashboard: board, artifact graph, coverage, cost')
    .option('-p, --port <port>', 'port on 127.0.0.1', (v) => Number(v), 4318)
    .option('--out <file>', 'write a static HTML snapshot instead of serving')
    .action(async (o) => {
      const p = ctx.openProject();
      if (o.out) {
        fs.writeFileSync(o.out, renderDashboard(p));
        return console.log(`Wrote ${o.out}`);
      }
      await serveDashboard(p.root, o.port);
      console.log(`Keel dashboard on http://127.0.0.1:${o.port} (read-only; Ctrl+C to stop)`);
    });

  program
    .command('index')
    .description('Rebuild the derived SQLite index (.keel/index.sqlite)')
    .action(async () => {
      const r = await buildIndex(ctx.openProject());
      console.log(`Indexed ${r.artifacts} artifacts, ${r.links} links, ${r.tests} tagged tests into ${r.file}.`);
    });

  program
    .command('query <sql>')
    .description('Read-only SQL over the index (tables: artifacts, links, criteria, tests, evidence)')
    .option('--json', 'machine-readable output')
    .action(async (sql, o) => {
      const rows = await queryIndex(ctx.openProject(), sql);
      if (o.json) return json(rows);
      if (!rows.length) return console.log('(no rows)');
      const cols = Object.keys(rows[0]!);
      console.log(table([cols, ...rows.map((r) => cols.map((k) => String(r[k] ?? '')))]));
    });

  program
    .command('explain [topic]')
    .description('What the current step is for and what good output looks like (or: tracks, config, gates, ids, <step>)')
    .action((topic) => console.log(explain(ctx.openProject(), topic)));

  program
    .command('upgrade')
    .description('Merge a newer workflow pack into .keel/ without overwriting your edits')
    .option('--from <dir>', 'pack folder (default: the pack bundled with this Keel)')
    .option('--dry-run', 'show what would change')
    .option('--json', 'machine-readable output')
    .action((o) => {
      const r = upgradePack(ctx.openProject(), { from: o.from, dryRun: o.dryRun });
      if (o.json) return json(r);
      console.log(`Pack ${r.from} → ${r.to}${r.dryRun ? ' (dry run)' : ''}`);
      if (!r.files.length) console.log('Nothing to change.');
      for (const f of r.files) console.log(`  ${f.action === 'conflict' ? c.red(f.action) : f.action}  ${f.file}`);
      if (r.files.some((f) => f.action === 'conflict')) {
        console.log(c.yellow('Resolve the conflict markers, then run keel check.'));
        process.exitCode = 1;
      }
    });

  const hooks = program.command('hooks').description('Git hooks');
  hooks
    .command('install')
    .description('Install a commit-msg hook that adds Keel-Ref for the item in progress')
    .option('--force', 'replace an existing commit-msg hook')
    .action((o) => console.log(`Installed ${installGitHook(ctx.openProject(), o.force)}`));
  program
    .command('hook <name> [args...]', { hidden: true })
    .description('Hook entry points (commit-msg)')
    .action((name, args: string[]) => {
      try {
        const root = findProjectRoot(ctx.cwd());
        if (!root || name !== 'commit-msg' || !args[0]) return;
        commitMsgHook(new ProjectClass(root), args[0]);
      } catch {
        // Never block a commit.
      }
    });
}
