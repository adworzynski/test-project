import path from 'node:path';
import { readTextIf } from '../util/fs.js';
import { estimateTokens, truncate } from '../util/text.js';
import { computeCoverage, itemCoverage } from '../verify/coverage.js';
import { filesForItem } from '../verify/review.js';
import { computeNext } from '../workflow/status.js';
import { projectTrack, changeTrack } from '../workflow/engine.js';
import { loadMemory } from '../memory/memory.js';
import { cmpId } from '../graph/graph.js';
import { KeelError } from '../util/errors.js';
import type { ArtifactNode } from '../model/types.js';
import type { Project } from '../project.js';

export interface ContextPack {
  id?: string;
  markdown: string;
  tokens: number;
  budget: number;
  omitted: string[];
  files: string[];
}

/** The work item an agent should be on: the one in progress, else the next startable one. */
export function currentItem(project: Project): ArtifactNode | undefined {
  const g = project.graph;
  const inProg = g.activeWork().filter((n) => n.status === 'in-progress').sort((a, b) => cmpId(a.id, b.id));
  if (inProg.length) return inProg[0];
  const coverage = computeCoverage(project);
  const next = computeNext({ project, track: projectTrack(project), coverage }).find((a) => a.ref && ['story', 'change'].includes(g.get(a.ref)?.type ?? ''));
  return next?.ref ? g.get(next.ref) : undefined;
}

function sectionOf(md: string, heading: RegExp): string | undefined {
  const lines = md.split('\n');
  const i = lines.findIndex((l) => /^#{2,3}\s/.test(l) && heading.test(l));
  if (i === -1) return undefined;
  const lvl = lines[i]!.match(/^(#+)/)![1]!.length;
  const j = lines.findIndex((l, k) => k > i && new RegExp(`^#{1,${lvl}}\\s`).test(l));
  return lines.slice(i, j === -1 ? undefined : j).join('\n').trim();
}

/**
 * Context pack for a story or change (AE-4): the item, its criteria and their evidence, linked
 * requirements, ADRs, screens, decisions, constraints and relevant files, under a token budget.
 */
export function contextPack(project: Project, id?: string, budget = project.config.budgets.context_tokens): ContextPack {
  const g = project.graph;
  const item = id ? g.get(id.toUpperCase()) : currentItem(project);
  if (id && !item) throw new KeelError(`Unknown artifact ${id}`);
  const omitted: string[] = [];
  const parts: string[] = [];
  let used = 0;
  const add = (label: string, text: string, required = false): boolean => {
    const t = estimateTokens(text);
    if (!required && used + t > budget) {
      omitted.push(label);
      return false;
    }
    parts.push(text);
    used += t;
    return true;
  };
  const memory = loadMemory(project.paths, project.root);
  const constraints = memory.filter((m) => m.kind === 'constraint');
  const decisions = memory.filter((m) => m.kind === 'decision').slice(-10);

  if (!item) {
    add('header', `# Keel context: ${project.config.project}\n\nNo story or change is in progress. Run \`keel next\` (MCP next_steps) to see what to do.`, true);
    for (const t of ['brief', 'prd'] as const) for (const n of g.byType(t)) add(n.id, `## ${n.id}: ${n.title} (${n.status})\n\n${n.body.trim()}`);
  } else {
    const coverage = computeCoverage(project);
    const track = item.type === 'change' ? changeTrack(project, item) : undefined;
    const crit = g.criteriaOf(item.id);
    const covs = new Map(itemCoverage(project, item, coverage).map((x) => [x.id, x]));
    const critLines = crit.map((c) => {
      const cov = covs.get(c.id);
      return `- ${c.id} ${c.title}: ${cov?.status ?? 'untested'}${cov?.tests[0] ? ` (${cov.tests[0].file ?? ''} "${truncate(cov.tests[0].name, 50)}")` : ''}`;
    });
    add(
      'header',
      [
        `# Keel context: ${item.id} ${item.title}`,
        '',
        `${item.type}${item.fm.track ? ` · ${String(item.fm.track)} track` : ''} · status ${item.status}${track?.current ? ` · step: ${track.current.step.name}` : ''}`,
        '',
        '## How to work',
        `- Tests first. Tag each test with its criterion: a comment \`// @keel <AC-id>\` directly above it.`,
        `- End every commit message with \`Keel-Ref: ${item.id}\`.`,
        `- Run \`keel verify --run --record\`, then \`keel done ${item.id}\`. Keel refuses until every criterion has a passing test.`,
        '- Follow the constraints and accepted ADRs below. Record new decisions with record_decision.',
        '',
        '## Criteria and evidence',
        ...(critLines.length ? critLines : ['- (none yet: add `### AC-…` sections before writing code)']),
      ].join('\n'),
      true,
    );
    add(item.id, `## ${item.id} (${item.file})\n\n${item.body.trim()}`, true);
    if (constraints.length) add('constraints', ['## Constraints (must follow)', ...constraints.map((c) => `- ${c.id}: ${c.title}${c.text ? ` (${truncate(c.text.replace(/\s+/g, ' '), 120)})` : ''}`)].join('\n'), true);
    const reqs = g.requirementsOf(item.id);
    if (reqs.length) add('requirements', ['## Requirements', ...reqs.map((r) => r.body.trim())].join('\n\n'));
    const adrIds = new Set<string>([...(item.links.adr ?? [])]);
    for (const a of g.byType('adr').filter((a) => a.status === 'accepted')) adrIds.add(a.id);
    for (const aid of [...adrIds].sort(cmpId)) {
      const a = g.get(aid);
      if (!a) continue;
      const full = `## ${a.id}: ${a.title} (${a.status})\n\n${a.body.replace(/^# .*\n/, '').trim()}`;
      if (!add(a.id, full)) {
        const outcome = sectionOf(a.body, /decision outcome/i);
        if (outcome) add(`${a.id} outcome`, `## ${a.id}: ${a.title}\n\n${outcome}`);
      }
    }
    for (const sid of item.links.screens ?? []) {
      const s = g.get(sid);
      if (s) add(s.id, `## Screen ${s.body.replace(/^#+\s*/, '')}`);
    }
    for (const t of g.byType('design-tokens').filter((t) => t.status !== 'draft')) add(t.id, `## ${t.id}: ${t.title}\n\n${t.body.replace(/^# .*\n/, '').trim()}`);
    if (decisions.length) add('decisions', ['## Recent decisions', ...decisions.map((d) => `- ${d.id} (${d.date ?? ''}): ${d.title}`)].join('\n'));
    // Relevant files: declared, touched by Keel-Ref commits, and linked tests.
    const files = new Set<string>([...((item.fm.files as string[]) ?? []).filter((f) => !/[*?]/.test(f))]);
    for (const f of filesForItem(project, item)) files.add(f);
    for (const c of crit) for (const t of coverage.byId.get(c.id)?.tests ?? []) if (t.file && !path.isAbsolute(t.file)) files.add(t.file);
    const fileList = [...files].sort();
    if (fileList.length) {
      add('files', ['## Relevant files', ...fileList.map((f) => `- ${f}`)].join('\n'));
      for (const f of fileList) {
        const text = readTextIf(path.join(project.root, f));
        if (text === undefined || text.length > 40000) continue;
        add(`file ${f}`, `### ${f}\n\n\`\`\`\n${text.trimEnd()}\n\`\`\``);
      }
    }
    return finish(project, item.id, parts, used, budget, omitted, fileList);
  }
  if (constraints.length) add('constraints', ['## Constraints', ...constraints.map((c) => `- ${c.id}: ${c.title}`)].join('\n'));
  if (decisions.length) add('decisions', ['## Recent decisions', ...decisions.map((d) => `- ${d.id}: ${d.title}`)].join('\n'));
  return finish(project, undefined, parts, used, budget, omitted, []);
}

function finish(project: Project, id: string | undefined, parts: string[], used: number, budget: number, omitted: string[], files: string[]): ContextPack {
  if (omitted.length) parts.push(`---\n_Omitted to stay under the ${budget}-token budget: ${omitted.join(', ')}. Ask with a larger budget if needed._`);
  const markdown = parts.join('\n\n') + '\n';
  return { id, markdown, tokens: estimateTokens(markdown), budget, omitted, files };
}

/** Short session-start brief (AE-5): what the agent is on, what's open, the rules and the next step. */
export function sessionBrief(project: Project): string {
  const g = project.graph;
  const item = currentItem(project);
  const coverage = computeCoverage(project);
  const next = computeNext({ project, track: projectTrack(project), coverage });
  const memory = loadMemory(project.paths, project.root);
  const lines = [`# Keel session context: ${project.config.project}`, ''];
  if (item) {
    const covs = new Map(itemCoverage(project, item, coverage).map((x) => [x.id, x]));
    const open = g
      .criteriaOf(item.id)
      .map((c) => ({ c, cov: covs.get(c.id) }))
      .filter((x) => x.cov?.status !== 'passed' && x.cov?.status !== 'waived');
    lines.push(`Current ${item.type}: ${item.id} "${item.title}" (${item.status}${item.fm.track ? `, ${String(item.fm.track)} track` : ''}).`);
    lines.push(open.length ? `Open criteria: ${open.map((x) => `${x.c.id} ${truncate(x.c.title, 40)} [${x.cov?.status ?? 'untested'}]`).join('; ')}.` : 'All criteria have evidence.');
    lines.push(`Full context pack: MCP get_context {"id": "${item.id}"} or \`keel context ${item.id}\`.`);
  } else {
    lines.push('No story or change is in progress.');
  }
  lines.push('', 'Next:');
  next.forEach((n, i) => lines.push(`${i + 1}. ${n.title}${n.command ? ` (run: ${n.command})` : ''}${n.skill ? ` [skill ${n.skill}]` : ''}`));
  const cons = memory.filter((m) => m.kind === 'constraint');
  if (cons.length) lines.push('', 'Constraints:', ...cons.map((c) => `- ${c.id}: ${c.title}`));
  const dec = memory.filter((m) => m.kind === 'decision').slice(-5);
  if (dec.length) lines.push('', 'Recent decisions:', ...dec.map((d) => `- ${d.id}: ${d.title}`));
  lines.push('', 'Rules: tests first, tagged `@keel AC-…`; commit trailer `Keel-Ref: <id>`; only `keel done` marks work done; never edit status by hand.');
  return lines.join('\n') + '\n';
}
