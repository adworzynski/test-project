import { describe, it, expect } from 'vitest';
import { defaultConfig, loadConfig } from '../src/config.js';
import { sensitiveMatch } from '../src/workflow/router.js';
import { tmpDir, write } from './helpers.js';
import path from 'node:path';

describe('keel.yaml', () => {
  it('sensitive globs catch auth, payments and schema files but not look-alikes', () => {
    const cfg = defaultConfig({ project: 'p', stack: 'flutter' });
    const hit = (f: string) => !!sensitiveMatch([f], cfg);
    for (const f of ['lib/auth/session.dart', 'lib/data/auth_repository.dart', 'Sources/AuthService.swift', 'lib/payments/checkout.dart', 'db/migrations/002.sql', 'lib/db/app_schema.dart'])
      expect(hit(f), f).toBe(true);
    for (const f of ['lib/author.dart', 'lib/habit_store.dart', 'test/widget_test.dart']) expect(hit(f), f).toBe(false);
  });

  it('rejects an invalid config with the offending key', () => {
    const root = tmpDir();
    write(root, '.keel/keel.yaml', 'version: 1\nproject: x\nprofile: enterprise\nstack: flutter\n');
    expect(() => loadConfig(path.join(root, '.keel/keel.yaml'))).toThrow(/profile must be equal to one of the allowed values: solo-mobile, solo-web/);
  });

  it('fills defaults for keys a user omits', () => {
    const root = tmpDir();
    write(root, '.keel/keel.yaml', 'version: 1\nproject: x\nprofile: solo-web\nstack: web\nbudgets:\n  lines:\n    quick: 40\n');
    const c = loadConfig(path.join(root, '.keel/keel.yaml'));
    expect(c.budgets.lines.quick).toBe(40);
    expect(c.budgets.lines.feature).toBe(300);
    expect(c.release.kind).toBe('web');
    expect(c.verify.tests).toContain('**/*.spec.{ts,tsx,js,jsx}');
  });
});
