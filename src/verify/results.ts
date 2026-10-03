import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { readText } from '../util/fs.js';

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestResult {
  name: string;
  classname?: string;
  file?: string;
  status: TestStatus;
  message?: string;
  /** Results file this came from. */
  source: string;
}

export type ResultFormat = 'junit' | 'flutter' | 'jest';

/** Detects the report format from content: JUnit/xUnit XML, Flutter/Dart JSON lines, or Jest/Vitest JSON (VG-3). */
export function detectFormat(text: string): ResultFormat | undefined {
  const t = text.trimStart();
  if (t.startsWith('<')) return 'junit';
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const js = JSON.parse(t);
      if (js && typeof js === 'object' && Array.isArray((js as { testResults?: unknown }).testResults)) return 'jest';
    } catch {
      // Not a single JSON document: probably JSON lines.
    }
    if (/"type"\s*:\s*"(testStart|testDone|suite|start)"/.test(t)) return 'flutter';
  }
  if (/"type"\s*:\s*"testDone"/.test(t)) return 'flutter';
  return undefined;
}

export function parseResults(text: string, source: string, format = detectFormat(text)): TestResult[] {
  switch (format) {
    case 'junit':
      return parseJUnit(text, source);
    case 'flutter':
      return parseDartJson(text, source);
    case 'jest':
      return parseJest(text, source);
    default:
      throw new Error(`${source}: unrecognized test report format (expected JUnit XML, flutter --machine JSON, or Jest JSON)`);
  }
}

export function parseResultsFile(root: string, file: string): TestResult[] {
  return parseResults(readText(path.resolve(root, file)), file);
}

/** JUnit / xUnit XML: Gradle, Swift `--xunit-output`, xcbeautify, jest-junit, Maestro. */
export function parseJUnit(xml: string, source: string): TestResult[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => ['testsuite', 'testcase', 'failure', 'error'].includes(name),
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const out: TestResult[] = [];
  const visitSuite = (suite: Record<string, unknown>, inheritedFile?: string) => {
    const file = (suite.file as string) ?? inheritedFile;
    for (const tc of (suite.testcase as Record<string, unknown>[]) ?? []) {
      const failed = (tc.failure as unknown[])?.length || (tc.error as unknown[])?.length;
      const skipped = tc.skipped !== undefined;
      const failure = ((tc.failure as Record<string, unknown>[]) ?? (tc.error as Record<string, unknown>[]) ?? [])[0];
      out.push({
        name: String(tc.name ?? ''),
        classname: tc.classname !== undefined ? String(tc.classname) : undefined,
        file: (tc.file as string) ?? file,
        status: failed ? 'failed' : skipped ? 'skipped' : 'passed',
        message: failure ? String(failure.message ?? failure['#text'] ?? '').slice(0, 500) : undefined,
        source,
      });
    }
    for (const child of (suite.testsuite as Record<string, unknown>[]) ?? []) visitSuite(child, file);
  };
  const roots = doc.testsuites ? [doc.testsuites as Record<string, unknown>] : [];
  for (const r of roots) visitSuite(r);
  for (const s of (doc.testsuite as Record<string, unknown>[]) ?? []) visitSuite(s);
  return out;
}

/** Dart/Flutter JSON reporter (`flutter test --machine`, `dart test -r json`): one event per line. */
export function parseDartJson(text: string, source: string): TestResult[] {
  const suites = new Map<number, string>();
  const tests = new Map<number, { name: string; suiteID: number; hidden?: boolean }>();
  const out: TestResult[] = [];
  const errors = new Map<number, string>();
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(l);
    } catch {
      continue;
    }
    if (ev.type === 'suite') {
      const s = ev.suite as { id: number; path?: string };
      suites.set(s.id, s.path ?? '');
    } else if (ev.type === 'testStart') {
      const t = ev.test as { id: number; name: string; suiteID: number; url?: string };
      tests.set(t.id, { name: t.name, suiteID: t.suiteID });
    } else if (ev.type === 'error') {
      errors.set(ev.testID as number, String(ev.error ?? '').slice(0, 500));
    } else if (ev.type === 'testDone') {
      if (ev.hidden) continue; // synthetic "loading" tests
      const t = tests.get(ev.testID as number);
      if (!t) continue;
      const result = ev.result as string;
      out.push({
        name: t.name,
        file: suites.get(t.suiteID),
        status: ev.skipped ? 'skipped' : result === 'success' ? 'passed' : 'failed',
        message: errors.get(ev.testID as number),
        source,
      });
    }
  }
  return out;
}

/** Jest `--json` output (also Vitest's json reporter, which uses the same shape). */
export function parseJest(text: string, source: string): TestResult[] {
  const js = JSON.parse(text) as {
    testResults: {
      name?: string;
      testFilePath?: string;
      assertionResults?: { fullName?: string; title: string; ancestorTitles?: string[]; status: string; failureMessages?: string[] }[];
    }[];
  };
  const out: TestResult[] = [];
  for (const file of js.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      const name = a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(' ');
      out.push({
        name,
        file: file.name ?? file.testFilePath,
        status: a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped',
        message: a.failureMessages?.[0]?.slice(0, 500),
        source,
      });
    }
  }
  return out;
}
