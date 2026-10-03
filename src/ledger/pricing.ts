import type { Pricing } from '../config.js';

/**
 * Default USD prices per million tokens for Claude models, snapshot of 2026-09-25 Anthropic
 * first-party API rates. Cache writes use the standard 1.25x input multiplier and cache reads
 * 0.1x input unless a published rate exists. Override or extend in keel.yaml `pricing:`
 * (other vendors' models included); costs computed from this table are marked estimated.
 */
export const DEFAULT_PRICING: Record<string, Pricing> = {
  'claude-fable-5-1': { input: 10, output: 50, cache_read: 0.25, cache_write: 12.5 },
  'claude-fable-5': { input: 10, output: 50, cache_read: 1, cache_write: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  'claude-opus-5': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
};

/** Finds a price for a model ID, ignoring suffixes such as "[1m]" or a date stamp. */
export function priceFor(model: string | undefined, overrides: Record<string, Pricing> = {}): Pricing | undefined {
  if (!model) return undefined;
  const table = { ...DEFAULT_PRICING, ...overrides };
  const clean = model
    .toLowerCase()
    .replace(/\[.*\]$/, '')
    .replace(/^(anthropic\.|us\.anthropic\.|global\.anthropic\.)/, '')
    .replace(/@.*$/, '')
    .replace(/-\d{8}$/, '')
    .trim();
  if (table[clean]) return table[clean];
  if (table[model]) return table[model];
  // Longest key that prefixes the model name.
  const key = Object.keys(table)
    .filter((k) => clean.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? table[key] : undefined;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
}

export function costOf(usage: Usage, price: Pricing): number {
  const m = 1_000_000;
  return (
    ((usage.input_tokens ?? 0) * price.input +
      (usage.output_tokens ?? 0) * price.output +
      (usage.cache_read_tokens ?? 0) * (price.cache_read ?? price.input * 0.1) +
      (usage.cache_write_tokens ?? 0) * (price.cache_write ?? price.input * 1.25)) /
    m
  );
}
