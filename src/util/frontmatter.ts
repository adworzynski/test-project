import YAML from 'yaml';
import { FM_ORDER } from '../model/registry.js';

export interface ParsedFile {
  fm: Record<string, unknown>;
  body: string;
  /** Line (1-based) where the body starts. */
  bodyLine: number;
  hasFrontMatter: boolean;
  errors: { message: string; line: number }[];
}

/** Splits `---` YAML front-matter from a Markdown body, reporting YAML errors with file lines (NF-8). */
export function parseFrontMatter(text: string): ParsedFile {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n') && src !== '---') {
    return { fm: {}, body: src, bodyLine: 1, hasFrontMatter: false, errors: [] };
  }
  const end = src.indexOf('\n---', 3);
  if (end === -1) {
    return {
      fm: {},
      body: src,
      bodyLine: 1,
      hasFrontMatter: false,
      errors: [{ message: 'front-matter starts with --- but has no closing ---', line: 1 }],
    };
  }
  const yamlText = src.slice(4, end + 1);
  let rest = src.slice(end + 4);
  if (rest.startsWith('\n')) rest = rest.slice(1);
  const bodyLine = yamlText.split('\n').length + 2;
  const doc = YAML.parseDocument(yamlText, { uniqueKeys: true });
  const errors = doc.errors.map((e) => ({
    message: e.message.split('\n')[0]!.replace(/ at line \d+, column \d+:?$/, ''),
    // +1 for the opening --- line.
    line: (e.linePos?.[0]?.line ?? yamlText.slice(0, e.pos[0]).split('\n').length) + 1,
  }));
  let fm: Record<string, unknown> = {};
  if (!errors.length) {
    const js = doc.toJS({ maxAliasCount: 50 });
    if (js && typeof js === 'object' && !Array.isArray(js)) fm = js as Record<string, unknown>;
    else if (js !== null && js !== undefined) errors.push({ message: 'front-matter must be a YAML mapping', line: 2 });
  }
  return { fm: normalizeDates(fm), body: rest, bodyLine, hasFrontMatter: true, errors };
}

/** YAML turns 2026-10-03 into a Date only with the core schema's timestamp tag; keep strings stable. */
function normalizeDates(fm: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(fm)) {
    if (v instanceof Date) fm[k] = v.toISOString().slice(0, 10);
  }
  return fm;
}

/** Serializes front-matter with a stable key order and flow-style link lists. */
export function stringifyFrontMatter(fm: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const k of FM_ORDER) if (fm[k] !== undefined) ordered[k] = fm[k];
  for (const k of Object.keys(fm).sort()) if (!(k in ordered) && fm[k] !== undefined) ordered[k] = fm[k];
  const doc = new YAML.Document(ordered);
  // Keep short string lists on one line: `implements: [FR-001, FR-002]`.
  YAML.visit(doc, {
    Seq(_, node) {
      if (node.items.every((i) => YAML.isScalar(i) && typeof i.value !== 'object')) node.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
}

export function composeFile(fm: Record<string, unknown>, body: string): string {
  const b = body.replace(/^\n+/, '');
  return `---\n${stringifyFrontMatter(fm)}\n---\n\n${b.endsWith('\n') ? b : b + '\n'}`;
}
