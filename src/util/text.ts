export function slugify(s: string, max = 40): string {
  const slug = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/, '') || 'item';
}

export function today(): string {
  return (process.env.KEEL_NOW ? new Date(process.env.KEEL_NOW) : new Date()).toISOString().slice(0, 10);
}

export function nowIso(): string {
  return (process.env.KEEL_NOW ? new Date(process.env.KEEL_NOW) : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…';
}

export function plural(n: number, word: string, pluralWord = word + 's'): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

/** Rough token estimate (about 4 characters per token for English and code). */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export function asArray(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v)];
}
