import path from 'node:path';
import { exists, listDir, readText, readTextIf, writeText } from '../util/fs.js';
import { KeelError } from '../util/errors.js';
import { generateSpec } from '../spec/living.js';
import { compileAgents } from '../agents/compile.js';
import { PACK_DIR } from '../paths.js';
import { Importer, splitCriteria, criterionSection, firstWords, type ImportReport } from './common.js';
import type { Project } from '../project.js';

const PRIORITY: Record<string, string> = { P1: 'Must', P2: 'Should', P3: 'Could', P4: "Won't" };

interface SkStory {
  n: number;
  title: string;
  priority?: string;
  narrative: string;
  criteria: string[];
}

function parseSpec(md: string) {
  const title = md.match(/^#\s+(?:Feature Specification:\s*)?(.+)$/m)?.[1]?.trim() ?? 'Feature';
  const status = md.match(/\*\*Status\*\*:\s*(\w+)/i)?.[1]?.toLowerCase();
  const stories: SkStory[] = [];
  const parts = md.split(/^###\s+User Story\s+/m).slice(1);
  for (const p of parts) {
    const head = p.split('\n')[0]!;
    const m = head.match(/^(\d+)\s*[-–—:]\s*(.+?)(?:\s*\(Priority:\s*(P\d)\))?\s*$/);
    const body = p.split('\n').slice(1).join('\n').split(/^##\s/m)[0]!;
    const narrative = body.split(/\*\*Why this priority\*\*|\*\*Independent Test\*\*|\*\*Acceptance Scenarios\*\*/)[0]!.trim();
    const acc = body.split(/\*\*Acceptance Scenarios\*\*:?/)[1] ?? '';
    stories.push({ n: Number(m?.[1] ?? stories.length + 1), title: (m?.[2] ?? head).trim(), priority: m?.[3], narrative, criteria: splitCriteria(acc.split(/^###\s|^---\s*$/m)[0]!) });
  }
  const frs: { key: string; kind: 'FR' | 'NFR'; text: string }[] = [];
  for (const m of md.matchAll(/^\s*[-*]\s*\*\*(N?FR)-(\d+)\*\*\s*:\s*(.+)$/gm)) frs.push({ key: `${m[1]}-${m[2]}`, kind: m[1] as 'FR' | 'NFR', text: m[3]!.trim() });
  for (const m of md.matchAll(/^\s*[-*]\s*\*\*(SC)-(\d+)\*\*\s*:\s*(.+)$/gm)) frs.push({ key: `SC-${m[2]}`, kind: 'NFR', text: `Success criterion: ${m[3]!.trim()}` });
  return { title, status, stories, frs };
}

function parsePlan(md: string): { summary: string; context: string[] } {
  const summary = (md.split(/^##\s+Summary\s*$/m)[1] ?? '').split(/^##\s/m)[0]!.trim();
  const context = [...md.matchAll(/^\*\*(Language\/Version|Primary Dependencies|Storage|Testing|Target Platform|Project Type|Performance Goals|Constraints)\*\*:\s*(.+)$/gm)].map((m) => `- ${m[1]}: ${m[2]!.trim()}`);
  return { summary, context };
}

function parseTasks(md: string): { us?: number; text: string; checked: boolean }[] {
  return [...md.matchAll(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/gm)].map((m) => {
    const us = m[2]!.match(/\[US(\d+)\]/)?.[1];
    return { checked: m[1] !== ' ', us: us ? Number(us) : undefined, text: m[2]!.replace(/\s*\[(P|US\d+)\]\s*/g, ' ').trim() };
  });
}

/** `keel import speckit [path]` (MG-2): constitution, specs, plans, tasks; checklists are reported. */
export function importSpecKit(project: Project, given?: string): ImportReport {
  const root = path.resolve(project.root, given ?? '.');
  const specsDir = exists(path.join(root, 'specs')) ? path.join(root, 'specs') : root;
  const features = listDir(specsDir)
    .filter((d) => exists(path.join(specsDir, d, 'spec.md')))
    .sort();
  const constitution = readTextIf(path.join(root, '.specify', 'memory', 'constitution.md')) ?? readTextIf(path.join(root, 'memory', 'constitution.md'));
  if (!features.length && !constitution) throw new KeelError('No Spec Kit project found (looked for specs/*/spec.md and .specify/memory/constitution.md).');
  const rel = (abs: string) => path.relative(project.root, abs).split(path.sep).join('/');
  const imp = new Importer(project, rel(root) || '.');

  if (constitution) {
    const target = path.join(project.paths.agents, 'constitution.md');
    const current = readTextIf(target);
    const pristine = readTextIf(path.join(PACK_DIR, 'agents', 'constitution.md'));
    const text = constitution.trim() + '\n';
    if (!current || current === pristine) writeText(target, text);
    else writeText(target, current.trimEnd() + '\n\n## Imported from Spec Kit\n\n' + text.replace(/^# .*\n/, ''));
    imp.report.notes.push('Spec Kit constitution copied into .keel/agents/constitution.md and compiled into every agent’s instructions');
    compileAgents(project);
  }

  const reqSections: string[] = [];
  const featureData = features.map((f) => {
    const dir = path.join(specsDir, f);
    const spec = parseSpec(readText(path.join(dir, 'spec.md')));
    const ids = new Map<string, string>();
    const secs: string[] = [];
    for (const r of spec.frs) {
      const id = imp.next(r.kind, 'requirement');
      ids.set(r.key, id);
      imp.map(`${f}/${r.key}`, id);
      secs.push(`### ${id}: ${firstWords(r.text)}\n${r.text}\n_Spec Kit ${f} ${r.key}_\n`);
    }
    if (secs.length) reqSections.push(`## ${f}: ${spec.title}`, '', ...secs);
    return { f, dir, spec, ids };
  });
  const planning: string[] = [];
  let prdId: string | undefined;
  if (reqSections.length) {
    const body = ['# Requirements imported from Spec Kit', '', 'One section per Spec Kit feature; each requirement keeps a note of its original ID.', '', '## Functional requirements', '', ...reqSections].join('\n');
    prdId = imp.write({ type: 'prd', title: 'Requirements imported from Spec Kit', body, from: rel(specsDir), status: 'approved' }).id;
    planning.push(prdId);
  }

  for (const { f, dir, spec, ids } of featureData) {
    const plan = readTextIf(path.join(dir, 'plan.md'));
    let adrId: string | undefined;
    if (plan) {
      const p = parsePlan(plan);
      const extra = ['research.md', 'data-model.md', 'quickstart.md', 'contracts'].filter((x) => exists(path.join(dir, x)));
      const body = [
        `# Technical plan: ${spec.title}`,
        '',
        '## Context and problem statement',
        `Imported from Spec Kit \`${rel(path.join(dir, 'plan.md'))}\`.${extra.length ? ` Supporting files: ${extra.map((x) => `\`${rel(path.join(dir, x))}\``).join(', ')}.` : ''}`,
        '',
        '## Decision outcome',
        p.summary || 'See the plan.',
        '',
        ...p.context,
      ].join('\n');
      adrId = imp.write({ type: 'adr', title: `Technical plan: ${spec.title}`, body, from: rel(path.join(dir, 'plan.md')), status: 'accepted' }).id;
      planning.push(adrId);
    }
    const tasks = parseTasks(readTextIf(path.join(dir, 'tasks.md')) ?? '');
    const orphanTasks = tasks.filter((t) => t.us === undefined).length;
    if (orphanTasks) imp.report.notes.push(`${f}: ${orphanTasks} setup/polish tasks without a [US] tag were not attached to a story`);
    const frIds = [...ids.entries()].filter(([k]) => k.startsWith('FR')).map(([, v]) => v);
    if (!spec.stories.length) imp.report.unlinked.push(`${f}: no "### User Story" sections found`);
    for (const s of spec.stories) {
      const id = imp.next('ST', 'story');
      const acIds: string[] = [];
      const acMd: string[] = [];
      for (const c of s.criteria) {
        const ac = imp.next('AC', 'criterion');
        const sec = criterionSection(ac, c);
        if (!sec.structured) imp.report.notes.push(`${ac} (${id}) has no Given/When/Then; written as a single Then line`);
        acIds.push(ac);
        acMd.push(sec.md);
      }
      const own = tasks.filter((t) => t.us === s.n);
      const status = own.length && own.every((t) => t.checked) ? 'done' : own.some((t) => t.checked) ? 'in-progress' : spec.status === 'draft' ? 'draft' : 'approved';
      const body = [
        `# ${id}: ${s.title}`,
        '',
        s.narrative.replace(/^\s+|\s+$/g, '') || '_No narrative in the source._',
        '',
        '## Acceptance criteria',
        '',
        ...acMd,
        ...(own.length ? ['## Tasks', ...own.map((t) => `- [${t.checked ? 'x' : ' '}] ${t.text}`), ''] : []),
      ].join('\n');
      imp.write({
        id,
        type: 'story',
        title: s.title,
        body,
        from: rel(path.join(dir, 'spec.md')),
        status,
        links: { implements: frIds, ...(adrId ? { adr: [adrId] } : {}) },
        extra: { criteria: acIds, epic: `${f}: ${spec.title}`, ...(s.priority ? { priority: PRIORITY[s.priority] ?? s.priority } : {}) },
      });
      imp.map(`${f} User Story ${s.n}`, id);
      if (frIds.length) imp.report.notes.push(`${id} linked to all FRs of ${f} (${frIds.join(', ')}); narrow links.implements if needed`);
      else imp.report.unlinked.push(`${id} (${f} User Story ${s.n}) has no FR to link`);
      if (!acIds.length) imp.report.unlinked.push(`${id} (${f} User Story ${s.n}) has no acceptance scenarios`);
    }
    for (const c of listDir(path.join(dir, 'checklists'))) imp.report.skipped.push(`${rel(path.join(dir, 'checklists', c))} (checklists stay in Spec Kit)`);
  }
  imp.baseline(planning);
  project.reload();
  generateSpec(project);
  imp.writeReport('speckit');
  return imp.report;
}
