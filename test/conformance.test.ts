import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { CLI } from './helpers.js';

describe('agent conformance harness (AE-6)', () => {
  // The fixture uses node --test's JUnit reporter and the SQLite index (Node 22.5+); POSIX shell shim.
  const supported = Number(process.versions.node.split('.')[0]) >= 22 && process.platform !== 'win32';
  it.skipIf(!supported)('the scripted reference agent passes every check', () => {
    expect(fs.existsSync(CLI)).toBe(true);
    const r = spawnSync('node', [path.join(path.dirname(CLI), '..', 'conformance', 'run.mjs'), 'scripted'], { encoding: 'utf8' });
    expect(r.stdout).toContain('| scripted | pass |  |');
    expect(r.status).toBe(0);
  });
});
