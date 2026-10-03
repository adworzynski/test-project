import { matcher } from '../util/fs.js';
import type { KeelConfig } from '../config.js';

export type Track = 'quick' | 'feature';

export interface RouteInput {
  description: string;
  /** Files the change touches (given, or from the working tree). */
  paths: string[];
  /** Lines changed per path, when known. */
  lines?: Map<string, number>;
  /** True when paths came from uncommitted changes rather than the user; they count for less. */
  inferredPaths?: boolean;
}

export interface RouteDecision {
  track: Track;
  reasons: string[];
  /** Set when sensitive paths force the Feature track (WF-4). */
  escalation?: { reason: string; path: string };
  sensitiveKeywords: string[];
}

const QUICK_WORDS = /\b(fix(es|ed)?|bug|crash(es|ing)?|typo|copy|wording|text|label|color|colour|style|padding|margin|spacing|rename|tweak|align(ment)?|icon|broken|regression|error message|translation|l10n|i18n)\b/gi;
const FEATURE_WORDS = /\b(add|new|implement|support|introduce|build|create|integrat(e|ion)|screen|flow|feature|onboarding|sync|notification|offline mode|export|import|redesign|refactor)\b/gi;

function distinct(re: RegExp, text: string): string[] {
  return [...new Set((text.match(re) ?? []).map((w) => w.toLowerCase()))];
}

/**
 * Classifies a change as Quick or Feature before work starts (WF-3), and explains why.
 * Heuristic and transparent on purpose: keywords, touched files and lines, and sensitive paths.
 * Ties go to Feature, the safer track.
 */
export function route(input: RouteInput, cfg: KeelConfig): RouteDecision {
  const reasons: string[] = [];
  let quickScore = 0;
  let featureScore = 0;
  const d = input.description;

  const qm = distinct(QUICK_WORDS, d);
  const fm = distinct(FEATURE_WORDS, d);
  if (qm.length) {
    quickScore += 1 + qm.length;
    reasons.push(`description reads like a small fix (${qm.map((w) => `"${w}"`).join(', ')})`);
  }
  if (fm.length) {
    featureScore += 1 + fm.length;
    reasons.push(`description reads like new behavior (${fm.map((w) => `"${w}"`).join(', ')})`);
  }
  if (d.split(/\s+/).length > 40) {
    featureScore += 1;
    reasons.push('long description (more than 40 words)');
  }

  const files = [...new Set(input.paths)].filter((p) => !p.startsWith('.keel/'));
  if (files.length) {
    const lines = files.reduce((s, f) => s + (input.lines?.get(f) ?? 0), 0);
    const source = input.inferredPaths ? ' in uncommitted changes' : '';
    const weight = input.inferredPaths ? 1 : 2;
    if (files.length <= cfg.router.quick_max_files && (!input.lines || lines <= cfg.router.quick_max_lines)) {
      quickScore += weight;
      reasons.push(`touches ${files.length} file${files.length === 1 ? '' : 's'}${input.lines ? ` and ${lines} lines` : ''}${source} (Quick limit: ${cfg.router.quick_max_files} files, ${cfg.router.quick_max_lines} lines)`);
    } else {
      featureScore += weight + 1;
      reasons.push(`touches ${files.length} files${input.lines ? ` and ${lines} lines` : ''}${source}, over the Quick limit (${cfg.router.quick_max_files} files, ${cfg.router.quick_max_lines} lines)`);
    }
  }

  const sensitiveKeywords = cfg.sensitive.keywords.filter((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(d));
  if (sensitiveKeywords.length) reasons.push(`mentions a sensitive area (${sensitiveKeywords.join(', ')}); Keel will escalate if the fix touches a sensitive path`);

  let track: Track = quickScore > featureScore ? 'quick' : 'feature';
  if (!qm.length && !fm.length && !files.length) reasons.push('not enough signal to call it small; defaulting to Feature (override with --track quick)');
  else if (quickScore === featureScore) reasons.push('signals are balanced; choosing Feature, the safer track');

  const escalation = sensitiveMatch(files, cfg);
  if (escalation) {
    track = 'feature';
    reasons.push(`touches sensitive path ${escalation.path} (${escalation.reason}), so it needs the Feature track`);
  }
  return { track, reasons, escalation, sensitiveKeywords };
}

/** First file matching a sensitive glob (WF-4), with the glob that matched. */
export function sensitiveMatch(files: string[], cfg: KeelConfig): { reason: string; path: string } | undefined {
  for (const glob of cfg.sensitive.paths) {
    const isMatch = matcher([glob]);
    const hit = files.find((f) => !f.startsWith('.keel/') && isMatch(f));
    if (hit) return { reason: `matches sensitive glob ${glob}`, path: hit };
  }
  return undefined;
}
