import YAML from 'yaml';
import { readTextIf } from './util/fs.js';
import { KeelError } from './util/errors.js';
import { validateWithSchema } from './schemas.js';

export type Profile = 'solo-mobile' | 'solo-web';
export type Stack = 'flutter' | 'expo' | 'swiftui' | 'compose' | 'web';
export type AgentId = 'claude' | 'copilot' | 'cursor' | 'codex';

export const ALL_AGENTS: AgentId[] = ['claude', 'copilot', 'cursor', 'codex'];
export const STACKS: Stack[] = ['flutter', 'expo', 'swiftui', 'compose', 'web'];
export const PROFILES: Profile[] = ['solo-mobile', 'solo-web'];

export interface Pricing {
  /** USD per million tokens. */
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export interface KeelConfig {
  version: number;
  project: string;
  profile: Profile;
  stack: Stack;
  agents: AgentId[];
  owner?: string;
  budgets: {
    lines: Record<string, number>;
    context_tokens: number;
    cost_warn_usd: number;
  };
  sensitive: { paths: string[]; keywords: string[] };
  router: { quick_max_files: number; quick_max_lines: number };
  planning: { require_screens: boolean; require_stack_adrs: boolean };
  verify: {
    tests: string[];
    results: string[];
    run?: string;
    require: 'done' | 'all';
    drift: 'advisory' | 'blocking';
    dependencies: {
      policy: 'blocking' | 'advisory' | 'off';
      min_age_days: number;
      allow: string[];
      manifests: string[];
    };
  };
  release: { kind: 'mobile' | 'web' };
  mcp: { command: string; args: string[] };
  pricing: Record<string, Pricing>;
  pack: { name: string; version: string };
  /** When `keel init` ran, for the time-to-first-brief metric. */
  initialized?: string;
}

interface StackDefaults {
  profile: Profile;
  tests: string[];
  results: string[];
  run: string;
  manifests: string[];
}

export const STACK_DEFAULTS: Record<Stack, StackDefaults> = {
  flutter: {
    profile: 'solo-mobile',
    tests: ['test/**/*_test.dart', 'integration_test/**/*_test.dart'],
    results: ['.keel/tmp/test-results.jsonl', 'build/test-results/**/*.xml'],
    run: 'flutter test --machine > .keel/tmp/test-results.jsonl',
    manifests: ['pubspec.yaml'],
  },
  expo: {
    profile: 'solo-mobile',
    tests: ['**/*.test.{ts,tsx,js,jsx}', '**/__tests__/**/*.{ts,tsx,js,jsx}'],
    results: ['.keel/tmp/jest-results.json', 'reports/**/*.xml'],
    run: 'npx jest --ci --json --outputFile=.keel/tmp/jest-results.json',
    manifests: ['package.json'],
  },
  swiftui: {
    profile: 'solo-mobile',
    tests: ['**/*Tests.swift', '**/*Test.swift'],
    results: ['.keel/tmp/xunit.xml', 'build/reports/**/*.xml'],
    run: 'swift test --xunit-output .keel/tmp/xunit.xml',
    manifests: ['Package.swift', 'Podfile'],
  },
  compose: {
    profile: 'solo-mobile',
    tests: ['**/src/test/**/*.kt', '**/src/androidTest/**/*.kt'],
    results: ['**/build/test-results/**/*.xml'],
    run: './gradlew test',
    manifests: ['**/build.gradle', '**/build.gradle.kts', 'gradle/libs.versions.toml'],
  },
  web: {
    profile: 'solo-web',
    tests: ['**/*.test.{ts,tsx,js,jsx}', '**/*.spec.{ts,tsx,js,jsx}', '**/__tests__/**/*.{ts,tsx,js,jsx}'],
    results: ['.keel/tmp/jest-results.json', 'reports/**/*.xml'],
    run: 'npx jest --ci --json --outputFile=.keel/tmp/jest-results.json',
    manifests: ['package.json'],
  },
};

export function defaultConfig(opts: { project: string; stack: Stack; profile?: Profile; agents?: AgentId[]; owner?: string }): KeelConfig {
  const sd = STACK_DEFAULTS[opts.stack];
  const profile = opts.profile ?? sd.profile;
  return {
    version: 1,
    project: opts.project,
    profile,
    stack: opts.stack,
    agents: opts.agents ?? [...ALL_AGENTS],
    owner: opts.owner,
    budgets: {
      // Artifact-length budgets in lines (WF-6). "quick" and "feature" cap a whole change.
      lines: { brief: 60, quick: 60, feature: 300, prd: 300, story: 80, adr: 60, screens: 150, tokens: 80 },
      context_tokens: 20000,
      cost_warn_usd: 2,
    },
    sensitive: {
      paths: [
        '**/auth/**',
        '**/*auth*.*',
        '**/login/**',
        '**/payment*/**',
        '**/*payment*.*',
        '**/billing/**',
        '**/purchase*/**',
        '**/migrations/**',
        '**/schema/**',
        '**/*schema*.*',
        '**/*.sql',
      ],
      keywords: ['auth', 'login', 'password', 'payment', 'billing', 'purchase', 'subscription', 'schema', 'migration', 'encryption', 'token'],
    },
    router: { quick_max_files: 3, quick_max_lines: 80 },
    planning: { require_screens: profile === 'solo-mobile' || profile === 'solo-web', require_stack_adrs: profile === 'solo-mobile' },
    verify: {
      tests: sd.tests,
      results: sd.results,
      run: sd.run,
      require: 'done',
      drift: 'advisory',
      dependencies: { policy: 'blocking', min_age_days: 30, allow: [], manifests: sd.manifests },
    },
    release: { kind: profile === 'solo-mobile' ? 'mobile' : 'web' },
    mcp: { command: 'keel', args: ['mcp'] },
    pricing: {},
    pack: { name: 'core', version: '0.1.0' },
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merges user config over defaults; arrays from the user replace defaults. */
function merge<T>(base: T, over: unknown): T {
  if (!isObj(over) || !isObj(base)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? merge(out[k], v) : v;
  return out as T;
}

export function loadConfig(file: string): KeelConfig {
  const text = readTextIf(file);
  if (text === undefined) throw new KeelError(`No Keel project here (missing ${file}). Run \`keel init\` first.`);
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) {
    const e = doc.errors[0]!;
    throw new KeelError(`${file}:${e.linePos?.[0]?.line ?? 1}: ${e.message.split('\n')[0]}`);
  }
  const raw = (doc.toJS() ?? {}) as Record<string, unknown>;
  const errs = validateWithSchema('keel', raw);
  if (errs.length) throw new KeelError(`${file} is invalid:\n  ${errs.join('\n  ')}`);
  const stack = (raw.stack as Stack) ?? 'flutter';
  const base = defaultConfig({ project: String(raw.project ?? 'app'), stack, profile: raw.profile as Profile | undefined });
  return merge(base, raw);
}

export function stringifyConfig(cfg: KeelConfig): string {
  const header =
    '# Keel project configuration. Docs: `keel explain config`.\n' +
    '# Budgets are line caps per artifact (WF-6); sensitive paths escalate Quick changes (WF-4).\n';
  return header + YAML.stringify(cfg, { lineWidth: 0 });
}
