import { createHash } from 'node:crypto';

/** Hash of text with line endings and trailing whitespace normalized, so editors don't cause false changes. */
export function contentHash(text: string): string {
  const norm = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
  return 'sha256:' + createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

export function shortId(): string {
  return createHash('sha256')
    .update(String(Date.now()) + Math.random())
    .digest('hex')
    .slice(0, 8);
}
