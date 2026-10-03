import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

/** Root of the installed keel-cli package (holds packs/ and schemas/). Works from src/ and dist/. */
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function pkgVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version as string;
  } catch {
    return '0.0.0';
  }
}

export const PACK_DIR = path.join(PKG_ROOT, 'packs', 'core');
export const SCHEMA_DIR = path.join(PKG_ROOT, 'schemas');

/** Locations inside a project's .keel/ folder (see PRD "Repository layout"). */
export class ProjectPaths {
  readonly keel: string;
  constructor(readonly root: string) {
    this.keel = path.join(root, '.keel');
  }
  get config() {
    return path.join(this.keel, 'keel.yaml');
  }
  get workflows() {
    return path.join(this.keel, 'workflows');
  }
  get agents() {
    return path.join(this.keel, 'agents');
  }
  get templates() {
    return path.join(this.keel, 'templates');
  }
  get artifacts() {
    return path.join(this.keel, 'artifacts');
  }
  get spec() {
    return path.join(this.keel, 'spec');
  }
  get memory() {
    return path.join(this.keel, 'memory');
  }
  get gates() {
    return path.join(this.keel, 'gates');
  }
  get evidence() {
    return path.join(this.keel, 'evidence');
  }
  get ledger() {
    return path.join(this.keel, 'ledger');
  }
  get reviews() {
    return path.join(this.keel, 'reviews');
  }
  get tmp() {
    return path.join(this.keel, 'tmp');
  }
  get pack() {
    return path.join(this.keel, '.pack');
  }
  get index() {
    return path.join(this.keel, 'index.sqlite');
  }
  artifactDir(dir: string) {
    return path.join(this.artifacts, dir);
  }
}

/** Walks up from `start` to find the directory that holds .keel/keel.yaml. */
export function findProjectRoot(start: string): string | undefined {
  let cur = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(cur, '.keel', 'keel.yaml'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}
