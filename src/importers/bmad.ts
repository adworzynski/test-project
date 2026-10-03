import path from 'node:path';
import YAML from 'yaml';
import { exists, readText, walk } from '../util/fs.js';
import { KeelError } from '../util/errors.js';
import { generateSpec } from '../spec/living.js';
import { Importer, splitCriteria, criterionSection, frRefs, firstWords, type ImportReport } from './common.js';
import type { Project } from '../project.js';

interface BmadStory {
  key: string; // "1.2"
  epic?: string;
  title: string;
  narrative: string;
  criteria: string[];
  tasks: { text: string; checked: boolean }[];
  status?: string;
  refs: string[];
  from: string;
}

const STATUS: Record<string, string> = {
  backlog: 'draft',
  draft: 'draft',
  drafted: 'draft',
  'ready-for-dev': 'approved',
  ready: 'approved',
  approved: 'approved',
  'in-progress': 'in-progress',
  inprogress: 'in-progress',
  review: 'in-progress',
  done: 'done',
  completed: 'done',
};

/** Finds the BMAD output folder: v6 `_bmad-output`, v4 `docs`, or the given path. */
export function findBmadRoot(root: string, given?: string): string | undefined {
  const cands = given ? [given] : ['_bmad-output', 'bmad-output', 'docs', '.'];
  for (const c of cands) {
    const abs = path.resolve(root, c);
    if (!exists(abs)) continue;
    const files = walk(abs, abs);
    if (files.some((f) => /(^|\/)(prd|epics?)(\.md|\/)/i.test(f))) return abs;
  }
  return undefined;
}

function sectionBetween(md: string, heading: RegExp): string {
  const lines = md.split('\n');
  const i = lines.findIndex((l) => /^#{1,4}\s/.test(l) && heading.test(l));
  if (i === -1) {
    // "**Acceptance Criteria:**" bold-label style.
    const j = lines.findIndex((l) => heading.test(l));
    if (j === -1) return '';
    const end = lines.findIndex((l, k) => k > j && (/^#{1,4}\s/.test(l) || /^\*\*[A-Z][^*]{2,40}:?\*\*:?\s*$/.test(l.trim())));
    return lines.slice(j + 1, end === -1 ? undefined : end).join('\n');
  }
  const lvl = lines[i]!.match(/^(#+)/)![1]!.length;
  const end = lines.findIndex((l, k) => k > i && new RegExp(`^#{1,${lvl}}\\s`).test(l));
  return lines.slice(i + 1, end === -1 ? undefined : end).join('\n');
}

function parseTasks(text: string): { text: string; checked: boolean }[] {
  return text
    .split('\n')
    .map((l) => l.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ checked: m![1] !== ' ', text: m![2]!.trim() }));
}

function narrativeOf(text: string): string {
  const m = text.match(/(As an?\s[\s\S]*?so that[^\n]*)/i);
  return (m ? m[1]! : text.split('\n').filter((l) => l.trim() && !/^\*\*/.test(l.trim()))[0] ?? '').replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' ').trim();
}

function parseEpics(md: string, file: string): BmadStory[] {
  const out: BmadStory[] = [];
  let epic: string | undefined;
  const lines = md.split('\n');
  let cur: { key: string; title: string; lines: string[] } | undefined;
  const flush = () => {
    if (!cur) return;
    const text = cur.lines.join('\n');
    const ac = sectionBetween(text, /acceptance criteria/i);
    out.push({
      key: cur.key,
      epic,
      title: cur.title,
      narrative: narrativeOf(text),
      criteria: splitCriteria(ac),
      tasks: parseTasks(text),
      refs: frRefs(text),
      from: file,
    });
    cur = undefined;
  };
  for (const l of lines) {
    const e = l.match(/^#{1,3}\s+Epic\s+(\d+)\s*[:.\-–—]\s*(.+)$/i);
    const s = l.match(/^#{2,4}\s+Story\s+(\d+)[.-](\d+)\s*[:.\-–—]\s*(.+)$/i);
    if (e) {
      flush();
      epic = `${e[1]} ${e[2]!.trim()}`;
    } else if (s) {
      flush();
      cur = { key: `${s[1]}.${s[2]}`, title: s[3]!.trim(), lines: [] };
    } else if (cur) cur.lines.push(l);
  }
  flush();
  return out;
}

function parseStoryFile(md: string, file: string): BmadStory | undefined {
  const h = md.match(/^#\s+Story\s+(\d+)[.-](\d+)\s*[:.\-–—]\s*(.+)$/im);
  const fromName = path.basename(file).match(/^(\d+)[.-](\d+)[.-](.+)\.md$/);
  if (!h && !fromName) return undefined;
  const key = h ? `${h[1]}.${h[2]}` : `${fromName![1]}.${fromName![2]}`;
  const title = h ? h[3]!.trim() : fromName![3]!.replace(/[-.]/g, ' ').replace(/\bstory\b/i, '').trim();
  const status = (md.match(/^Status:\s*([\w-]+)/im)?.[1] ?? sectionBetween(md, /^#{2}\s+Status/i).trim().split('\n')[0] ?? '').toLowerCase().trim();
  return {
    key,
    title,
    narrative: narrativeOf(sectionBetween(md, /^#{2}\s+Story\b/i) || md),
    criteria: splitCriteria(sectionBetween(md, /acceptance criteria/i)),
    tasks: parseTasks(sectionBetween(md, /tasks/i)).filter((t) => !/^\s/.test(t.text)),
    status: status || undefined,
    refs: frRefs(md),
    from: file,
  };
}

/** `keel import bmad [path]` (MG-1): brief, PRD, architecture, epics, stories and sprint status. */
export function importBmad(project: Project, given?: string): ImportReport {
  const root = findBmadRoot(project.root, given);
  if (!root) throw new KeelError('No BMAD output found (looked for _bmad-output/, docs/ with prd.md or epics.md). Pass the folder: keel import bmad <path>.');
  const rel = (f: string) => path.relative(project.root, path.join(root, f)).split(path.sep).join('/');
  const imp = new Importer(project, path.relative(project.root, root) || '.');
  const files = walk(root, root).filter((f) => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.yml'));
  const used = new Set<string>();
  const planning: string[] = [];

  // Brief.
  const briefFile = files.find((f) => /(^|\/)(product-)?brief[^/]*\.md$/i.test(f));
  let briefId: string | undefined;
  if (briefFile) {
    const md = readText(path.join(root, briefFile));
    const title = md.match(/^#\s+(.+)$/m)?.[1]?.replace(/^Product Brief:?\s*/i, '') ?? 'Product brief';
    briefId = imp.write({ type: 'brief', title, body: md, from: rel(briefFile), status: 'approved' }).id;
    imp.map(rel(briefFile), briefId);
    planning.push(briefId);
    used.add(briefFile);
  }

  // PRD (single file or sharded prd/ folder).
  const prdFiles = files.filter((f) => /(^|\/)prd\.md$/i.test(f) || /(^|\/)prd\/[^/]+\.md$/i.test(f));
  const frMap = new Map<string, string>();
  let prdId: string | undefined;
  if (prdFiles.length) {
    const md = prdFiles.map((f) => readText(path.join(root, f))).join('\n\n');
    const fr: string[] = [];
    const nfr: string[] = [];
    for (const line of md.split('\n')) {
      const m = line.match(/^\s*(?:[-*]|\d+\.|#{2,5})?\s*(?:\*\*)?(N?FR)[-_ ]?0*(\d+)(?:\*\*)?\s*[:.)\-–—]\s*(?:\*\*)?\s*(.+)$/);
      if (!m) continue;
      const kind = m[1]!;
      const key = `${kind}${m[2]}`;
      if (frMap.has(key)) continue;
      const text = m[3]!.replace(/\*\*/g, '').trim();
      const id = imp.next(kind, 'requirement');
      frMap.set(key, id);
      imp.map(`${key}`, id);
      (kind === 'NFR' ? nfr : fr).push(`### ${id}: ${firstWords(text)}\n${text}\n_BMAD ${key}_\n`);
    }
    if (!fr.length && !nfr.length) imp.report.unlinked.push(`${prdFiles.map(rel).join(', ')}: no FR/NFR items recognized`);
    const title = md.match(/^#\s+(.+)$/m)?.[1]?.replace(/Product Requirements Document:?\s*/i, '').trim() || 'PRD';
    const body = [
      `# ${title}`,
      '',
      `Imported from BMAD (${prdFiles.map((f) => `\`${rel(f)}\``).join(', ')}). The original keeps goals, context and journeys.`,
      '',
      '## Functional requirements',
      '',
      ...fr,
      '## Non-functional requirements',
      '',
      ...nfr,
    ].join('\n');
    prdId = imp.write({ type: 'prd', title, body, from: rel(prdFiles[0]!), status: 'approved', links: briefId ? { derived_from: [briefId] } : {} }).id;
    planning.push(prdId);
    prdFiles.forEach((f) => used.add(f));
  }

  // Architecture → one accepted ADR pointing to the document.
  const archFiles = files.filter((f) => /(^|\/)architecture(\.md|\/[^/]+\.md)$/i.test(f));
  if (archFiles.length) {
    const md = archFiles.map((f) => readText(path.join(root, f))).join('\n\n');
    const heads = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => `- ${m[1]!.trim()}`).slice(0, 25);
    const body = [
      '# Architecture (imported from BMAD)',
      '',
      '## Context and problem statement',
      `The architecture was designed in BMAD: ${archFiles.map((f) => `\`${rel(f)}\``).join(', ')}.`,
      '',
      '## Decision outcome',
      `Follow that document. Its sections:`,
      ...heads,
      '',
      'Split individual decisions into their own ADRs when they change.',
    ].join('\n');
    const id = imp.write({ type: 'adr', title: 'Architecture (imported from BMAD)', body, from: rel(archFiles[0]!), status: 'accepted' }).id;
    planning.push(id);
    archFiles.forEach((f) => used.add(f));
  }

  // Stories: epics file(s), then story files (which win), then sprint status.
  const stories = new Map<string, BmadStory>();
  const epicCoverage = new Map<string, string[]>();
  for (const f of files.filter((f) => /(^|\/)epics?(\.md|\/[^/]+\.md)$/i.test(f) || /(^|\/)epic-\d+[^/]*\.md$/i.test(f))) {
    const md = readText(path.join(root, f));
    for (const s of parseEpics(md, rel(f))) stories.set(s.key, s);
    for (const m of md.matchAll(/\b(N?FR)[-_ ]?0*(\d+)\s*[:\-–—]\s*Epic\s+(\d+)/g)) {
      epicCoverage.set(m[3]!, [...(epicCoverage.get(m[3]!) ?? []), `${m[1]}${m[2]}`]);
    }
    used.add(f);
  }
  for (const f of files.filter((f) => /(^|\/)(stories\/|implementation-artifacts\/|sprint-artifacts\/)?\d+[.-]\d+[.-][^/]+\.md$/i.test(f))) {
    const s = parseStoryFile(readText(path.join(root, f)), rel(f));
    if (!s) continue;
    const prev = stories.get(s.key);
    stories.set(s.key, { ...prev, ...s, epic: prev?.epic ?? s.epic, refs: [...new Set([...(prev?.refs ?? []), ...s.refs])], criteria: s.criteria.length ? s.criteria : prev?.criteria ?? [] });
    used.add(f);
  }
  const sprint = files.find((f) => /sprint-status\.ya?ml$/i.test(f));
  if (sprint) {
    const y = (YAML.parse(readText(path.join(root, sprint))) ?? {}) as { development_status?: Record<string, string> };
    for (const [k, v] of Object.entries(y.development_status ?? {})) {
      const m = k.match(/^(\d+)-(\d+)-/);
      if (m && stories.has(`${m[1]}.${m[2]}`)) stories.get(`${m[1]}.${m[2]}`)!.status = String(v).toLowerCase();
    }
    used.add(sprint);
  }

  const sorted = [...stories.values()].sort((a, b) => {
    const [ae, as] = a.key.split('.').map(Number);
    const [be, bs] = b.key.split('.').map(Number);
    return ae! - be! || as! - bs!;
  });
  const linkedFrs = new Set<string>();
  for (const s of sorted) {
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
    let impl = s.refs.map((r) => frMap.get(r)).filter(Boolean) as string[];
    if (!impl.length && s.epic) {
      impl = (epicCoverage.get(s.epic.split(' ')[0]!) ?? []).map((r) => frMap.get(r)).filter(Boolean) as string[];
      if (impl.length) imp.report.notes.push(`${id} linked to ${impl.join(', ')} through the epic's FR coverage map (approximate)`);
    }
    impl.forEach((r) => linkedFrs.add(r));
    if (!impl.length) imp.report.unlinked.push(`${id} (BMAD story ${s.key} "${s.title}") implements no recognizable FR`);
    if (!acIds.length) imp.report.unlinked.push(`${id} (BMAD story ${s.key}) has no acceptance criteria`);
    const body = [
      `# ${id}: ${s.title}`,
      '',
      s.narrative || '_No narrative in the source._',
      '',
      '## Acceptance criteria',
      '',
      ...acMd,
      ...(s.tasks.length ? ['## Tasks', ...s.tasks.map((t) => `- [${t.checked ? 'x' : ' '}] ${t.text}`), ''] : []),
    ].join('\n');
    const status = STATUS[s.status ?? ''] ?? 'draft';
    imp.write({
      id,
      type: 'story',
      title: s.title,
      body,
      from: s.from,
      status,
      links: { implements: impl },
      extra: { criteria: acIds, ...(s.epic ? { epic: s.epic } : {}), bmad: s.key },
    });
    imp.map(`story ${s.key}`, id);
    if (status === 'done' && acIds.length) imp.report.notes.push(`${id} is done in BMAD but has no linked tests yet; tag tests with @keel ${acIds[0]} or waive`);
  }
  for (const [key, id] of frMap) if (key.startsWith('FR') && !linkedFrs.has(id)) imp.report.unlinked.push(`${id} (BMAD ${key}) has no story`);
  for (const f of files) if (!used.has(f) && /\.md$/.test(f) && !/readme/i.test(f)) imp.report.skipped.push(`${rel(f)} (not a recognized BMAD artifact; left in place)`);
  imp.baseline(planning);
  project.reload();
  generateSpec(project);
  imp.writeReport('bmad');
  return imp.report;
}
