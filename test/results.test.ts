import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { parseResults, detectFormat } from '../src/verify/results.js';
import { FIXTURES } from './helpers.js';

const fx = (f: string) => fs.readFileSync(path.join(FIXTURES, 'reports', f), 'utf8');

describe('test report parsing (VG-3)', () => {
  it('reads Gradle JUnit XML', () => {
    const r = parseResults(fx('gradle-junit.xml'), 'g.xml');
    expect(detectFormat(fx('gradle-junit.xml'))).toBe('junit');
    expect(r.map((t) => [t.name, t.status])).toEqual([
      ['saves a habit()', 'passed'],
      ['rejects empty names()', 'failed'],
      ['streaks()', 'skipped'],
    ]);
    expect(r[1]!.message).toContain('Name is required');
  });

  it('reads Swift xUnit XML (swift test --xunit-output)', () => {
    const r = parseResults(fx('swift-xunit.xml'), 's.xml');
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ name: 'testSavesHabit', classname: 'HabitsTests.HabitStoreTests', status: 'passed' });
  });

  it('reads Jest --json output', () => {
    const r = parseResults(fx('jest.json'), 'j.json');
    expect(detectFormat(fx('jest.json'))).toBe('jest');
    expect(r.map((t) => [t.name, t.status])).toEqual([
      ['habits saves a habit', 'passed'],
      ['habits rejects empty names', 'failed'],
    ]);
  });

  it('reads flutter test --machine output and skips hidden loading tests', () => {
    const r = parseResults(fx('flutter-machine.jsonl'), 'f.jsonl');
    expect(detectFormat(fx('flutter-machine.jsonl'))).toBe('flutter');
    expect(r.map((t) => [t.name, t.status, t.file])).toEqual([
      ['habits saves a habit', 'passed', '/app/test/habit_test.dart'],
      ['habits rejects empty names', 'failed', '/app/test/habit_test.dart'],
    ]);
    expect(r[1]!.message).toContain('Name is required');
  });

  it('rejects unknown formats with a clear message', () => {
    expect(() => parseResults('hello', 'x.txt')).toThrow(/unrecognized test report format/);
  });
});
