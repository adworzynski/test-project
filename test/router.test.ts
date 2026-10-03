import { describe, it, expect } from 'vitest';
import { route } from '../src/workflow/router.js';
import { defaultConfig } from '../src/config.js';

const cfg = defaultConfig({ project: 'p', stack: 'flutter' });

describe('router (WF-3, WF-4)', () => {
  it('bug fixes go Quick, with reasons', () => {
    const d = route({ description: 'Fix crash when a habit name has an emoji', paths: ['lib/habit.dart'] }, cfg);
    expect(d.track).toBe('quick');
    expect(d.reasons.join(' ')).toMatch(/small fix/);
    expect(d.reasons.join(' ')).toMatch(/touches 1 file/);
  });

  it('new behavior goes Feature', () => {
    expect(route({ description: 'Add a weekly summary screen', paths: [] }, cfg).track).toBe('feature');
  });

  it('many files push a fix to Feature', () => {
    const d = route({ description: 'Fix layout', paths: ['a.dart', 'b.dart', 'c.dart', 'd.dart', 'e.dart'] }, cfg);
    expect(d.track).toBe('feature');
  });

  it('a sensitive path escalates and names the path', () => {
    const d = route({ description: 'Fix typo in login button', paths: ['lib/auth/login_button.dart'] }, cfg);
    expect(d.track).toBe('feature');
    expect(d.escalation).toMatchObject({ path: 'lib/auth/login_button.dart' });
  });

  it('with no signal it defaults to Feature and says so', () => {
    const d = route({ description: 'Habits', paths: [] }, cfg);
    expect(d.track).toBe('feature');
    expect(d.reasons.join(' ')).toMatch(/not enough signal/);
  });
});
