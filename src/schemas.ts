import fs from 'node:fs';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import { SCHEMA_DIR } from './paths.js';

let ajv: Ajv | undefined;
const cache = new Map<string, ValidateFunction>();

function instance(): Ajv {
  if (ajv) return ajv;
  ajv = new Ajv({ allErrors: true, strict: false });
  for (const f of fs.readdirSync(SCHEMA_DIR)) {
    if (f.endsWith('.json')) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8')));
  }
  return ajv;
}

export function hasSchema(name: string): boolean {
  return fs.existsSync(path.join(SCHEMA_DIR, `${name}.json`));
}

/** Validates data against schemas/<name>.json; returns readable error strings (empty when valid). */
export function validateWithSchema(name: string, data: unknown): string[] {
  let fn = cache.get(name);
  if (!fn) {
    fn = instance().getSchema(`keel://schemas/${name}.json`);
    if (!fn) return [`unknown schema ${name}`];
    cache.set(name, fn);
  }
  if (fn(data)) return [];
  return (fn.errors ?? []).map((e) => {
    const where = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : '(root)';
    const extra =
      e.keyword === 'enum'
        ? `: ${(e.params as { allowedValues: unknown[] }).allowedValues.join(', ')}`
        : e.keyword === 'additionalProperties'
          ? `: ${(e.params as { additionalProperty: string }).additionalProperty}`
          : '';
    return `${where} ${e.message}${extra}`;
  });
}
