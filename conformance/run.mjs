#!/usr/bin/env node
// Keel agent conformance suite (AE-6): runs the same Quick change on each agent in headless mode,
// then checks the result with Keel itself. Usage:
//   node conformance/run.mjs                 # every agent CLI found on PATH, plus the scripted reference
//   node conformance/run.mjs scripted claude # selected agents
// Override an agent's command with KEEL_CONFORMANCE_<AGENT>_CMD, using {prompt} as the placeholder.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const BUG = 'Fix: the greeting keeps spaces around the name; greet("  Ada ") should return "Hello, Ada!"';

const PROMPT = `This repository uses Keel (see AGENTS.md). Handle this bug report end to end with the Keel workflow:
"${BUG}".
Steps: run \`keel new "${BUG}" --affects FR-001\`; fill in the change note's criterion with a real Given/When/Then;
run \`keel start <change id>\`; add a failing test in test/greet.test.js tagged with a comment \`// @keel <criterion id>\`;
fix src/greet.js; run \`keel verify --run --record\`; commit with the trailer \`Keel-Ref: <change id>\`;
then run \`keel done <change id>\`. Don't ask questions; don't push.`;

const AGENTS = {
  claude: { bin: 'claude', cmd: ['claude', '-p', '{prompt}', '--permission-mode', 'bypassPermissions'] },
  codex: { bin: 'codex', cmd: ['codex', 'exec', '--full-auto', '{prompt}'] },
  copilot: { bin: 'copilot', cmd: ['copilot', '-p', '{prompt}', '--allow-all-tools'] },
  cursor: { bin: 'cursor-agent', cmd: ['cursor-agent', '-p', '{prompt}', '--force'] },
};

function sh(cwd, cmd, args, env = {}) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

function keel(cwd, ...args) {
  return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', PATH: `${path.join(cwd, '.bin')}${path.delimiter}${process.env.PATH}` } });
}

/** A tiny web project with one done story, ready for a Quick fix. */
export function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-conformance-'));
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  // Agents call `keel`; point it at this build.
  w('.bin/keel', `#!/bin/sh\nexec node ${JSON.stringify(CLI)} "$@"\n`);
  fs.chmodSync(path.join(dir, '.bin/keel'), 0o755);
  w('package.json', JSON.stringify({ name: 'greeter', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2));
  w('src/greet.js', 'export function greet(name) {\n  return `Hello, ${name}!`;\n}\n');
  w('test/greet.test.js', "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { greet } from '../src/greet.js';\n\n// @keel AC-001\ntest('greets by name', () => {\n  assert.equal(greet('Ada'), 'Hello, Ada!');\n});\n");
  w('.gitignore', '.bin/\n');
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  const k = (...a) => {
    const r = keel(dir, ...a);
    if (r.status !== 0) throw new Error(`keel ${a.join(' ')}: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  k('init', '--stack', 'web', '--no-ci');
  const cfg = path.join(dir, '.keel/keel.yaml');
  fs.writeFileSync(
    cfg,
    fs
      .readFileSync(cfg, 'utf8')
      .replace(/^ {2}run: .*$/m, '  run: node --test --test-reporter=junit --test-reporter-destination=.keel/tmp/junit.xml')
      .replace(/^ {2}results:\n(?: {4}- .*\n)+/m, '  results:\n    - .keel/tmp/junit.xml\n')
      .replace(/^ {4}policy: blocking$/m, '    policy: off'),
  );
  const prd = k('add', 'prd', 'Greeter PRD').match(/at (\S+)/)[1];
  fs.writeFileSync(path.join(dir, prd), fs.readFileSync(path.join(dir, prd), 'utf8').replace(/### FR-001[\s\S]*$/, '### FR-001: Greet by name [Must]\nThe app greets a person by name.\n'));
  k('review', 'PRD-001', '--request');
  k('approve', 'PRD-001');
  const st = k('add', 'story', 'Greet by name', '--link', 'implements:FR-001').match(/at (\S+)/)[1];
  fs.writeFileSync(
    path.join(dir, st),
    fs
      .readFileSync(path.join(dir, st), 'utf8')
      .replace('As a …, I want …, so that ….', 'As a visitor, I want a greeting with my name, so that it feels personal.')
      .replace(/### AC-001: Observable behavior\n- Given …\n- When …\n- Then …/, '### AC-001: Greets by name\n- Given the name "Ada"\n- When greet runs\n- Then it returns "Hello, Ada!"')
      .replace(/^ui: .*\n/m, '')
      .replace('criteria: [AC-001]', 'criteria: [AC-001]\nui: false'),
  );
  k('review', 'ST-001', '--request');
  k('approve', 'ST-001');
  k('start', 'ST-001', '--force');
  k('verify', '--run', '--record', '--no-deps');
  k('done', 'ST-001');
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['-c', 'user.name=conformance', '-c', 'user.email=c@example.com', 'commit', '-qm', 'Greeter\n\nKeel-Ref: ST-001']);
  return dir;
}

/** The reference agent: does exactly what the prompt asks, with no model involved. */
function scriptedAgent(dir) {
  const k = (...a) => {
    const r = keel(dir, ...a);
    if (r.status !== 0) throw new Error(`keel ${a.join(' ')}: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  const out = k('new', BUG, '--affects', 'FR-001', '--json');
  const { id, file } = JSON.parse(out);
  const ac = fs.readFileSync(path.join(dir, file), 'utf8').match(/#### (AC-\d+)/)[1];
  fs.writeFileSync(
    path.join(dir, file),
    fs.readFileSync(path.join(dir, file), 'utf8').replace(/#### AC-\d+: The bug no longer happens\n- Given …\n- When …\n- Then …/, `#### ${ac}: Spaces around the name are trimmed\n- Given the name "  Ada "\n- When greet runs\n- Then it returns "Hello, Ada!"`),
  );
  k('start', id);
  fs.appendFileSync(path.join(dir, 'test/greet.test.js'), `\n// @keel ${ac}\ntest('trims spaces around the name', () => {\n  assert.equal(greet('  Ada '), 'Hello, Ada!');\n});\n`);
  fs.writeFileSync(path.join(dir, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name.trim()}!`;\n}\n');
  k('verify', '--run', '--record', '--no-deps');
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['-c', 'user.name=conformance', '-c', 'user.email=c@example.com', 'commit', '-qm', `Trim names in greet\n\nKeel-Ref: ${id}`]);
  k('done', id);
}

function runAgent(name, dir) {
  if (name === 'scripted') return scriptedAgent(dir);
  const override = process.env[`KEEL_CONFORMANCE_${name.toUpperCase()}_CMD`];
  const cmd = override ? override.split(' ') : AGENTS[name].cmd;
  const args = cmd.map((a) => (a === '{prompt}' ? PROMPT : a));
  const r = spawnSync(args[0], args.slice(1), {
    cwd: dir,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    env: { ...process.env, PATH: `${path.join(dir, '.bin')}${path.delimiter}${process.env.PATH}` },
  });
  if (r.error) throw r.error;
}

/** What "conformant" means: the change merged, its criterion has passing evidence, the commit carries Keel-Ref. */
export function checkResult(dir) {
  const checks = [];
  const status = JSON.parse(keel(dir, 'status', '--json').stdout);
  const changes = fs.existsSync(path.join(dir, '.keel/artifacts/changes/archive')) ? fs.readdirSync(path.join(dir, '.keel/artifacts/changes/archive')) : [];
  checks.push(['change archived', changes.length === 1]);
  checks.push(['all criteria covered', status.coverage.total >= 2 && status.coverage.covered === status.coverage.total]);
  const log = sh(dir, 'git', ['log', '--format=%(trailers:key=Keel-Ref,valueonly)']);
  checks.push(['Keel-Ref trailer on the fix', /CH-\d+/.test(log)]);
  checks.push(['keel check clean', keel(dir, 'check').status === 0]);
  // Every finished story or change must have a recorded `done` gate; otherwise its status was edited by hand.
  const items = JSON.parse(keel(dir, 'query', "SELECT id FROM artifacts WHERE type IN ('story','change') AND status IN ('done','archived')", '--json').stdout || '[]');
  const gated = items.every(({ id }) => {
    const f = path.join(dir, '.keel/gates', `${id}.yaml`);
    return fs.existsSync(f) && /decision: done/.test(fs.readFileSync(f, 'utf8'));
  });
  checks.push(['done only through keel done', items.length >= 2 && gated]);
  return checks;
}

function available(name) {
  if (name === 'scripted') return true;
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [AGENTS[name].bin]).status === 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!fs.existsSync(CLI)) execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['scripted', ...Object.keys(AGENTS)];
  const rows = [];
  for (const name of wanted) {
    if (name !== 'scripted' && !AGENTS[name]) throw new Error(`unknown agent ${name}`);
    if (!available(name)) {
      rows.push([name, 'skipped (CLI not installed)', '']);
      continue;
    }
    const dir = makeFixture();
    let error = '';
    try {
      runAgent(name, dir);
    } catch (e) {
      error = String(e.message ?? e).split('\n')[0];
    }
    const checks = checkResult(dir);
    const passed = checks.every(([, ok]) => ok);
    if (process.env.KEEL_CONFORMANCE_KEEP) console.error(`${name}: kept ${dir}`);
    else fs.rmSync(dir, { recursive: true, force: true });
    rows.push([name, passed ? 'pass' : 'fail', checks.filter(([, ok]) => !ok).map(([c]) => c).join('; ') + (error ? ` (${error})` : '')]);
  }
  console.log('| Agent | Result | Notes |\n| --- | --- | --- |');
  for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2]} |`);
  if (rows.some((r) => r[1] === 'fail')) process.exitCode = 1;
}
