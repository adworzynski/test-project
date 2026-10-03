/**
 * Terminal output helpers. Color is decoration only: every status also has a text label
 * (NF-11), and color is off when NO_COLOR is set or stdout is not a TTY.
 */
const useColor = () => !process.env.NO_COLOR && !!process.stdout.isTTY && process.env.TERM !== 'dumb';

const wrap = (code: number) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  cyan: wrap(36),
};

export function table(rows: string[][], indent = ''): string {
  if (!rows.length) return '';
  const widths: number[] = [];
  for (const r of rows) r.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, visibleLength(cell))));
  return rows
    .map((r) => indent + r.map((cell, i) => (i === r.length - 1 ? cell : pad(cell, widths[i]!))).join('  '))
    .join('\n');
}

function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[\d+m/g, '').length;
}

function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - visibleLength(s)));
}

export function heading(s: string): string {
  return c.bold(s);
}
