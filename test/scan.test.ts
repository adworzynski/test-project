import { describe, it, expect } from 'vitest';
import { scanTestText } from '../src/verify/scan.js';
import { mapRun, resultMatches } from '../src/verify/coverage.js';
import type { TestResult } from '../src/verify/results.js';

describe('criterion tags in tests (VG-1)', () => {
  it('Dart: tag above test and testWidgets, and a tagged group', () => {
    const src = `void main() {\n  // @keel AC-001\n  group('habits', () {\n    // @keel AC-002, AC-003\n    testWidgets('saves a habit', (t) async {});\n    test('AC-004 rejects empty', () {});\n  });\n}\n`;
    const t = scanTestText(src, 'test/habit_test.dart');
    expect(t).toEqual([
      { file: 'test/habit_test.dart', line: 3, name: 'habits', kind: 'group', criteria: ['AC-001'] },
      { file: 'test/habit_test.dart', line: 5, name: 'saves a habit', kind: 'test', criteria: ['AC-002', 'AC-003'] },
      { file: 'test/habit_test.dart', line: 6, name: 'AC-004 rejects empty', kind: 'test', criteria: ['AC-004'] },
    ]);
  });

  it('TypeScript: it/test with a template literal name', () => {
    const t = scanTestText("describe('habits', () => {\n  // @keel AC-010\n  it(`saves a habit`, () => {});\n});\n", 'src/a.test.ts');
    expect(t[0]).toMatchObject({ name: 'saves a habit', kind: 'test', criteria: ['AC-010'] });
  });

  it('Swift: XCTest method and Swift Testing @Test', () => {
    const src = `final class HabitStoreTests: XCTestCase {\n  // @keel AC-020\n  func testSavesHabit() throws {}\n  // @keel AC-021\n  @Test("rejects empty name") func rejects() {}\n}\n`;
    const t = scanTestText(src, 'Tests/HabitStoreTests.swift');
    expect(t.map((x) => [x.name, x.criteria[0]])).toEqual([
      ['testSavesHabit', 'AC-020'],
      ['rejects empty name', 'AC-021'],
    ]);
  });

  it('Kotlin: backtick test names', () => {
    const src = `class HabitRepositoryTest {\n  // @keel AC-030\n  @Test\n  fun \`saves a habit\`() {}\n}\n`;
    expect(scanTestText(src, 'app/src/test/HabitRepositoryTest.kt')[0]).toMatchObject({ name: 'saves a habit', criteria: ['AC-030'] });
  });

  it('matches results by name, group prefix, and AC IDs in result names', () => {
    const linked = scanTestText("void main() {\n  group('habits', () {\n    // @keel AC-001\n    test('saves', () {});\n  });\n}\n", 'test/h_test.dart');
    const results: TestResult[] = [
      { name: 'habits saves', file: '/abs/test/h_test.dart', status: 'passed', source: 'r' },
      { name: 'other AC-009 works', status: 'failed', source: 'r' },
      { name: 'saves', file: 'test/other_test.dart', status: 'failed', source: 'r' },
    ];
    expect(resultMatches(results[0]!, linked[0]!)).toBe(true);
    expect(resultMatches(results[2]!, linked[0]!)).toBe(false);
    const m = mapRun(results, linked);
    expect(m.get('AC-001')!.status).toBe('passed');
    expect(m.get('AC-009')!.status).toBe('failed');
  });

  it('a linked test with no result is "not run"', () => {
    const linked = scanTestText("// @keel AC-001\ntest('x', () {});\n", 'test/a_test.dart');
    expect(mapRun([], linked).get('AC-001')!.status).toBe('not-run');
  });
});
