# Keel

**One traceable artifact graph from idea to release, for any coding agent.**

Keel (working name) is an open-source CLI and MCP server. It keeps your brief, PRD, screens, ADRs,
stories, acceptance criteria, changes and release checklist as linked Markdown files in `.keel/`,
tells you and your agent what to do next, and only lets work count as done when every criterion has
a passing test. It works with Claude Code, GitHub Copilot, Cursor and Codex, and imports BMAD and
Spec Kit projects.

This is the MVP described in the [Keel MVP PRD](docs/prd.md) ([status per requirement](docs/requirements.md)): a solo developer building a
mobile app (Flutter, Expo, SwiftUI or Compose) or a web app.

```
$ keel status
Keel · habits (solo-mobile, flutter)
Phase: Build › Implement stories test-first [in-progress]
  [x] brief  [x] prd  [x] screens  [x] architecture  [x] stories  [>] implement 0/3  [ ] release
...
Verification: 0/5 criteria covered (0%) · 0 passing · 0 failing · 5 without tests
Next
1. Continue ST-001 (Create a habit): 2 of 2 criteria lack a passing test (AC-001, AC-002)  (agent)
   run: keel context ST-001
   skill: keel-implement
```

## Why

- **One graph instead of five tools.** Brief → requirement → story → criterion → test → commit →
  release, with stable IDs. `keel trace FR-003` shows everything that hangs off a requirement.
- **Always a next step.** `keel next` (or the `next_steps` MCP tool inside any agent) returns 1–3
  concrete actions with the command or skill to run.
- **Process sized to the change.** `keel new "Fix crash on emoji names"` routes a bug to the Quick
  track (a 60-line change note), new behavior to the Feature track, and escalates a Quick change that
  touches auth, payments or the schema.
- **Done means evidence.** Tests carry `@keel AC-012` tags; `keel done` refuses until each criterion
  has a linked passing test or a human waiver. The same check runs in CI.
- **Any agent, no lock-in.** One instruction source compiles to `AGENTS.md`, `CLAUDE.md`,
  Copilot and Cursor rules, Agent Skills and MCP config. Everything is plain Markdown and YAML in git.

## Install

Keel needs Node.js 20 or newer (22.5+ for the optional SQLite index). It isn't on npm yet; install
from source:

```sh
git clone <this repo> keel && cd keel
npm ci
npm run build
npm link            # puts `keel` on your PATH
```

## Quick start

```sh
cd my-app                 # a Flutter, Expo, SwiftUI, Compose or web project, in git
keel init                 # detects the stack and your agents, writes .keel/ and agent files
```

Then, in your agent, run the `keel-discovery` skill (Claude Code: `/keel-discovery`; Copilot, Cursor,
Codex: "use the keel-discovery skill"). It interviews you and writes a one-page brief. From there:

```sh
keel status               # where things stand
keel next                 # what to do now
keel review BR-001        # review pack for a gate
keel approve BR-001       # you approve; agents can't
```

`docs/walkthrough.md` follows the sample app in `examples/flutter-habits` through every step.

## How it works

Truth lives in git, enforcement lives in CI, and agents are clients. Agents read compiled files and
call the MCP server; the engine writes plain files; CI decides whether a change has the evidence to merge.

```
.keel/
  keel.yaml            profile, stack, agents, budgets, sensitive paths, verify settings
  workflows/           product.yaml, feature.yaml, quick.yaml (edit them: steps, gates, skills)
  agents/              instruction source + skills, compiled by `keel compile`
  templates/           one per artifact type
  artifacts/           brief/ prd/ screens/ tokens/ adr/ stories/ changes/ release/ sources/
  spec/                living spec: each requirement with its merged criteria (generated)
  memory/              decisions.md, constraints.md
  gates/               approval, waiver and done records (who, when, artifact hash)
  evidence/            test-to-criterion results per run
  ledger/              token and cost entries (local only)
  reviews/             review packs
  index.sqlite         derived, git-ignored
```

**Artifacts.** One Markdown file per artifact with YAML front-matter (`id`, `type`, `status`, `links`,
`owner`, `created`, `updated`). Sections whose heading starts with an ID are artifacts too:
`### FR-007: Short name [Must]` in a PRD, `### SC-003: Today` in a screen map, `### AC-041: …` with
Given/When/Then lines in a story or change. Each type has a template and a JSON Schema in `schemas/`.

**Tracks.** Three YAML workflows ship in the core pack:

| Track | For | Steps and gates |
| --- | --- | --- |
| Product | a new app | brief → PRD → screens and tokens → stack ADRs → stories (approval gates) → build each story (evidence gate) → release checklist (checklist gate) |
| Feature | new behavior in one area | change note with delta, design and tasks (approval) → tests first, then code (evidence) |
| Quick | bug fix, copy or style change | two-section change note → reproduction test, then the fix (evidence) |

**Gates.** `approval`: a person runs `keel approve` or `keel reject -m`; the decision, the person, the
time and the artifact hash are stored in `.keel/gates/`. `evidence`: `keel done` needs a passing
linked test (or `keel waive AC-… -m "<reason>"`) for every criterion. `checklist`: every box ticked.

**Changes are deltas.** A change lists `### ADDED`, `### MODIFIED` and `### REMOVED` requirements and
criteria. When it's done, Keel applies the delta to the PRD and stories, regenerates `.keel/spec/`
and archives the change with a date.

**Refine in place.** Edit an approved artifact; `keel check` notices, and `keel refine PRD-001`
shows which stories, criteria and tests depend on the edited requirement. `--apply` flags them
`needs_review` and sends the edited artifact back to review.

## The four journeys

| Journey | Commands |
| --- | --- |
| **J1** New app, idea to store-ready build | `keel init` → skills `keel-discovery`, `keel-prd`, `keel-screens`, `keel-architecture`, `keel-stories` with `keel review`/`approve` at each gate → `keel start ST-001`, `keel-implement`, `keel verify --run --record`, `keel done ST-001` → `keel release 1.0.0` → tick the checklist, submit yourself → `keel done RL-001` |
| **J2** Bug fix | `keel new "Fix …"` (router says Quick and why) → fill the 2-section note → `keel start CH-001` → reproduction test, fix → `keel verify --run --record` → `keel done CH-001` (delta merged, change archived) |
| **J3** Bring a BMAD or Spec Kit project | `keel import bmad` or `keel import speckit` → read `.keel/import-report-*.md` → `keel status`; keep using `/speckit.implement` via `keel export speckit CH-…` |
| **J4** Switch agents mid-story | open another agent; its first `get_context` call (or the Claude Code SessionStart hook) returns the current story, open criteria, decisions, constraints and next step |

## Commands

| Command | Does |
| --- | --- |
| `keel init` | Detects stack and agents, picks a profile, writes `.keel/`, agent files, a CI workflow and a commit-msg hook |
| `keel status` / `keel next` | State and the next 1–3 actions (`--json` matches the MCP tools) |
| `keel add <type> "<title>"` | Draft brief, prd, screen-map, design-tokens, adr or story from its template |
| `keel new "<description>"` | Start a change; the router picks Quick or Feature and explains why |
| `keel route <id> [--track]` | Override the track, or re-check a Quick change for sensitive paths |
| `keel review <id> [--request]` | Review pack; `--request` moves the artifact to the gate |
| `keel approve` / `keel reject -m` / `keel waive` | Gate decisions (people only) |
| `keel start <id>` / `keel done <id>` | Begin work (checks gates, warns on cost) / finish it (checks evidence) |
| `keel refine [<id>] [--apply]` | Impact of an in-place edit to an approved artifact |
| `keel verify` | Test results → criteria, drift, dependency gate; `--run`, `--record`, `--ci`, `--suggest`, `--format markdown` |
| `keel context [<id>] [--session]` | Context pack for a story or change, or the short session brief |
| `keel compile` | Regenerate agent instructions, skills, MCP config and hooks |
| `keel trace <id>` | Upstream intent, downstream work, criteria and tests, commits and PRs |
| `keel check` | Schemas, IDs, links, workflows, lint and budgets; exit 1 on errors |
| `keel decide "<text>"` / `keel constrain "<rule>"` | Append to the decisions or constraints log |
| `keel cost [--by ref\|step\|agent\|model\|month\|release]` | Token and cost ledger; `keel cost add` for manual entries |
| `keel stats` | Markdown lines per change and type against budgets |
| `keel import bmad\|speckit\|prd` / `keel export speckit <id>` | Migration |
| `keel release [<version>]` / `keel release notes` | Release checklist and notes |
| `keel spec` | Regenerate the living spec |
| `keel ui [--out file.html]` | Local, read-only dashboard on 127.0.0.1 |
| `keel index` / `keel query "<sql>"` | Derived SQLite index and read-only queries |
| `keel explain [<step>\|tracks\|config\|gates\|ids]` | What a step is for and what good output looks like |
| `keel upgrade [--dry-run]` | Merge a newer workflow pack without overwriting your edits |
| `keel hooks install` | Commit-msg hook that adds `Keel-Ref:` for the item in progress |
| `keel mcp` | The MCP server on stdio (agents start it) |

## MCP tools

`keel mcp` is a local stdio server; every call re-reads the repo. Tool definitions are about 900 tokens.

| Tool | Does |
| --- | --- |
| `get_status` | Same as `keel status --json` |
| `next_steps` | Same as `keel next --json` |
| `get_context` | No id: session brief. With `ST-…`/`CH-…`: context pack under a token budget (default 20K) |
| `submit_artifact` | Save a drafted artifact (validated, budget-checked, reverted on error); request review, start, or ask for done |
| `request_review` | Move to pending-review and return the review pack |
| `record_evidence` | Parse test reports (optionally run the tests) and record evidence per criterion |
| `record_decision` | Append a decision or constraint, attributed to the calling agent |
| `report_cost` | Record tokens and cost against the item in progress |

Agents can never approve a gate or waive a criterion; `submit_artifact` refuses `approved` and ignores
`status:` edits in front-matter.

## Agent support

| Agent | Instructions | Skills | MCP config | Session-start context |
| --- | --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` (imports `AGENTS.md`) | `.claude/skills/` | `.mcp.json` | SessionStart hook runs `keel context --session`; Stop hook records token use |
| GitHub Copilot | `AGENTS.md`, `.github/copilot-instructions.md` | `.github/skills/`, `.agents/skills/` | `.vscode/mcp.json` | first `get_context` call |
| Cursor | `AGENTS.md`, `.cursor/rules/keel.mdc` | `.agents/skills/` | `.cursor/mcp.json` | first `get_context` call |
| OpenAI Codex | `AGENTS.md` | `.agents/skills/` | `.codex/config.toml` | first `get_context` call |

Keel only edits a marked block in `AGENTS.md`, `CLAUDE.md` and `copilot-instructions.md`, merges its
entries into existing JSON and TOML, and warns when an output passes a tool's size limit (Codex
truncates `AGENTS.md` at 32 KiB; `CLAUDE.md` is kept near 200 lines). The Copilot cloud agent reads
MCP servers from repository settings on GitHub, not from a file. Paths and hook names change often;
re-check them against each agent's docs before relying on them.

### Conformance (AE-6)

`node conformance/run.mjs [agents…]` runs the same Quick change headless on each agent CLI it finds
and checks the result with Keel: change archived, every criterion covered, `Keel-Ref` trailer on the
fix, `keel check` clean, and done only through `keel done`.

| Agent | Result | Notes |
| --- | --- | --- |
| scripted reference | pass | runs in the test suite |
| Claude Code 2.1.288 | 4 of 5 checks (one run, 3 Oct 2026) | Did the full flow and archived the change, but committed with its own attribution trailers instead of `Keel-Ref`. `keel init` now installs the commit-msg hook so the trailer is added anyway; not re-run since. |
| Copilot CLI, Cursor CLI, Codex | not run | CLIs weren't available where this was built |

## Verification

**Tag tests** with the criterion they prove, in a comment directly above the test (or put the ID in
the test name):

```dart
// @keel AC-012
testWidgets('saving a habit shows it in the list', (tester) async { … });
```

Dart (`test`, `testWidgets`, `group`), TypeScript/JavaScript (`it`, `test`, `describe`), Swift
(XCTest methods, Swift Testing `@Test`) and Kotlin (`fun` with backtick names) are recognized.
`keel verify --suggest` proposes links for untagged tests.

**Reports** read by `keel verify`: JUnit/xUnit XML (Gradle, `swift test --xunit-output`,
xcbeautify `--report junit`, jest-junit, `node --test --test-reporter=junit`), `flutter test --machine`
JSON lines, and Jest `--json` (also Vitest's json reporter). Set `verify.run` and `verify.results` in
`keel.yaml`; defaults come from the stack.

**Dependency gate.** New dependencies in `package.json`, `pubspec.yaml`, `Podfile`, `Package.swift`
and Gradle files must exist on npm, pub.dev, CocoaPods trunk, GitHub (SwiftPM), Maven Central or
Google Maven, and be at least `min_age_days` (30) old. Network failures report "unknown" instead of
blocking. Behind a proxy, set `NODE_USE_ENV_PROXY=1` (Node 22.21+/24.5+).

**Drift.** On a pull request, code files linked to a requirement (through tagged tests, `Keel-Ref`
commits or `files:` globs) that change with no spec edit and no `Keel-Ref` to open work are flagged,
as are Must/Should requirements with no linked code or tests once building has started. Advisory by
default; set `verify.drift: blocking` to fail CI.

## CI

`keel init` writes `.github/workflows/keel.yml`: run your tests, then the `verify/` action in this
repo, which posts one summary comment on the pull request (coverage, uncovered criteria, drift,
new dependencies and review packs for the work items touched) and fails on uncovered criteria of
finished work or a blocked dependency.

```yaml
- uses: adworzynski/test-project/verify@main
  with:
    results: .keel/tmp/test-results.jsonl
```

## Configuration

`.keel/keel.yaml` holds the profile, stack, agents, line budgets, context budget, cost warning,
sensitive paths, router limits, verify settings and model pricing. `keel explain config` describes
every key. Prices for current Claude models are built in; add others under `pricing:` (USD per
million tokens).

## Status and limitations

The MVP addresses all 46 functional requirements of the PRD; [docs/requirements.md](docs/requirements.md)
maps each one to code and tests, including what's partial:

- Tested on Linux with Node 22. macOS and Windows aren't tested yet, and there's no npm package or
  single binary yet.
- The evidence pipeline is tested with real-format reports; Flutter, Xcode and Gradle themselves
  weren't run in this environment. XCTest result bundles need converting to JUnit (xcbeautify).
- Importers are tested on BMAD v6 and Spec Kit fixtures, not yet on the PRD's ten real projects.
- The GitHub Action hasn't run on GitHub yet.
- No telemetry at all (the PRD allows opt-in telemetry; it isn't built).
- Keel doesn't call a model: when a draft is over budget, Keel refuses it and the agent shortens it.

## Development

```sh
npm ci
npm test                      # builds, then runs the vitest suite
node scripts/make-examples.mjs   # regenerate examples/ with the current CLI
node conformance/run.mjs scripted
```

Source layout: `src/graph` (parsing, graph, writes), `src/workflow` (engine, router, gates, lint,
status), `src/verify` (reports, tags, coverage, drift, dependencies, review packs), `src/agents`
(compiler, context packs), `src/mcp`, `src/importers`, `src/exporters`, `src/release`, `src/ui`,
`src/commands` (CLI). The workflow pack is in `packs/core`, schemas in `schemas/`.

## License

MIT
