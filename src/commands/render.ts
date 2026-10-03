import { c, table } from '../util/output.js';
import type { StatusData, NextAction } from '../workflow/status.js';
import type { Diagnostic } from '../model/types.js';

const STEP_MARK: Record<string, string> = { done: '[x]', 'pending-review': '[?]', 'in-progress': '[>]', 'not-started': '[ ]', skipped: '[-]' };

export function renderNext(actions: NextAction[]): string {
  return actions
    .map((a, i) => {
      const who = a.actor === 'human' ? c.yellow('you') : c.cyan('agent');
      const lines = [`${i + 1}. ${c.bold(a.title)}  (${who})`];
      if (a.why) lines.push(`   ${c.dim(a.why)}`);
      if (a.command) lines.push(`   run: ${a.command}`);
      if (a.skill) lines.push(`   skill: ${a.skill}`);
      return lines.join('\n');
    })
    .join('\n');
}

export function renderStatus(s: StatusData): string {
  const out: string[] = [];
  out.push(`${c.bold('Keel')} · ${s.project} (${s.profile}, ${s.stack})`);
  if (s.phase) out.push(`Phase: ${s.phase.stage} › ${s.phase.step} [${s.phase.status}]`);
  else if (s.track.length) out.push('Phase: Product track complete');
  if (s.track.length) {
    out.push(
      '  ' +
        s.track
          .map((t) => `${STEP_MARK[t.status] ?? '[ ]'} ${t.step}${t.progress ? ` ${t.progress.done}/${t.progress.total}` : ''}`)
          .join('  '),
    );
  }
  const statuses = ['draft', 'pending-review', 'approved', 'in-progress', 'done', 'other'];
  const rows: string[][] = [['', 'draft', 'review', 'approved', 'in-progress', 'done', 'other']];
  for (const [type, counts] of Object.entries(s.artifacts).sort()) {
    const other = Object.entries(counts)
      .filter(([k]) => !statuses.includes(k) && k !== 'accepted' && k !== 'proposed' && k !== 'archived')
      .reduce((n, [, v]) => n + v, 0);
    rows.push([
      type,
      String((counts.draft ?? 0) + (counts.proposed ?? 0)),
      String(counts['pending-review'] ?? 0),
      String((counts.approved ?? 0) + (counts.accepted ?? 0)),
      String(counts['in-progress'] ?? 0),
      String((counts.done ?? 0) + (counts.archived ?? 0)),
      String(other),
    ]);
  }
  if (rows.length > 1) out.push('', table(rows, '  '));
  else out.push('', '  No artifacts yet.');
  out.push('');
  out.push(`Open gates:   ${s.openGates.length ? s.openGates.map((g) => g.id).join(', ') : 'none'}`);
  if (s.needsReview.length) out.push(`Needs review: ${s.needsReview.map((n) => `${n.id} (${n.reason})`).join('; ')}`);
  out.push(`Blocked:      ${s.blocked.length ? s.blocked.map((b) => `${b.id} (${b.reason})`).join('; ') : 'none'}`);
  if (s.active.length) {
    out.push('Active:');
    for (const a of s.active.slice(0, 8)) {
      const cov = a.criteria ? `${a.criteria - a.uncovered.length}/${a.criteria} criteria covered` : 'no criteria yet';
      out.push(`  ${a.id} ${a.track ? `${a.track} · ` : ''}${a.status}${a.step ? ` · step ${a.step}` : ''} · ${cov} · ${a.title}`);
    }
    if (s.active.length > 8) out.push(`  … ${s.active.length - 8} more`);
  }
  const cv = s.coverage;
  out.push(
    `Verification: ${cv.covered}/${cv.total} criteria covered (${cv.percent}%)` +
      (cv.total ? ` · ${cv.passed} passing · ${cv.failed} failing · ${cv.untested} without tests · ${cv.notRun} not run · ${cv.waived} waived` : ''),
  );
  out.push(
    `Cost:         $${s.cost.usd.toFixed(2)} · ${s.cost.tokens.toLocaleString('en-US')} tokens` +
      (s.cost.unreported ? ` · ${s.cost.unreported} unreported run${s.cost.unreported === 1 ? '' : 's'}` : '') +
      (s.cost.unknownCost ? ` · ${s.cost.unknownCost} entr${s.cost.unknownCost === 1 ? 'y' : 'ies'} without a price` : ''),
  );
  out.push(`Checks:       ${s.checks.errors} error${s.checks.errors === 1 ? '' : 's'}, ${s.checks.warnings} warning${s.checks.warnings === 1 ? '' : 's'}${s.checks.errors || s.checks.warnings ? ' (keel check)' : ''}`);
  out.push('', c.bold('Next'), renderNext(s.next));
  return out.join('\n');
}

export function renderDiagnostics(ds: Diagnostic[]): string {
  return ds
    .map((d) => {
      const tag = d.level === 'error' ? c.red('error') : c.yellow('warning');
      const where = d.file ? `${d.file}${d.line ? ':' + d.line : ''}` : '';
      return `${tag} ${where ? where + ' ' : ''}${d.message} ${c.dim(`[${d.code}]`)}`;
    })
    .join('\n');
}
