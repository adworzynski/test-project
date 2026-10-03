# Keel MVP: requirements status

How the MVP meets each requirement of the [Keel MVP PRD](prd.md) (3 Oct 2026), with the code and the tests
that show it. **Done** means the acceptance criteria are implemented and covered by an automated
test in `test/`. **Partial** says what's missing.

## Workflow engine and routing

| ID | Pri | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| WF-1 | Must | Done | `packs/core/workflows/*.yaml`, `schemas/workflow.json`, `src/workflow/load.ts`, `engine.ts` | `journeys.test.ts` "WF-1": removing a stage changes `next`; a bad gate value fails `keel check` |
| WF-2 | Must | Done | Product, Feature, Quick tracks; profiles solo-mobile and solo-web | J1 on Flutter, J2 on Flutter, Product + Quick on Expo with Jest reports (`journeys.test.ts`) |
| WF-3 | Must | Done | `src/workflow/router.ts`, `keel new`, `keel route --track` | `router.test.ts`, J2 |
| WF-4 | Must | Done | `escalateIfSensitive` in `lifecycle.ts`; also on `keel done` and `keel verify` | J2 "escalates to Feature… records the path" |
| WF-5 | Must | Done | `keel approve`/`reject`, `.keel/gates/<id>.yaml` (who, when, hash, item hashes) | J1 gate record assertions |
| WF-6 | Must | Done | `budgets.lines` in `keel.yaml`; enforced at `review --request` and `submit_artifact`; `keel stats` | `mcp.test.ts` budget refusal, `more.test.ts` stats. Keel refuses over-budget drafts and the agent summarizes; Keel itself has no model |
| WF-7 | Should | Done | `keel upgrade` (three-way merge with `git merge-file`, pristine copies in `.keel/.pack/`) | `more.test.ts` "keel upgrade": untouched replaced, edited merged, conflict reported |

## Artifact graph

| ID | Pri | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| AG-1 | Must | Done | `src/graph/parse.ts`, `graph.ts`, `schemas/artifact.json` | `parse.test.ts`; `keel check` duplicate IDs, broken links |
| AG-2 | Must | Done | brief, PRD with FR/NFR, screen map with SC, design tokens, ADR, story with AC and TK, change, release, decision, constraint (+ imported source); templates in `packs/core/templates`, schemas in `schemas/` | `parse.test.ts`, J1 |
| AG-3 | Must | Done | `src/spec/living.ts` `mergeDelta`, `generateSpec` | J2: modified criterion rewritten in the story, change archived with a date, spec regenerated |
| AG-4 | Must | Done | `keel refine`, `driftSinceApproval` (per-section hashes) | `journeys.test.ts` "AG-4" |
| AG-5 | Must | Done | `Keel-Ref:` trailer from the skills, plus the commit-msg hook `keel init` installs; `keel trace` lists commits and PR numbers | J1 trace, `cli.test.ts` hook |
| AG-6 | Should | Done | `keel index`, `keel query` (Node 22.5+) | `more.test.ts` rebuild gives identical results |

## Navigation and visibility

| ID | Pri | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| NV-1 | Must | Done | `keel status` | `cli.test.ts` one screen, no color codes |
| NV-2 | Must | Done | `keel next` | J1: fresh project points to `keel-discovery`; never empty |
| NV-3 | Must | Done | MCP `get_status`, `next_steps` | `mcp.test.ts`, `cli.test.ts`: identical JSON |
| NV-4 | Should | Done | `keel ui` (127.0.0.1, read-only, CSP `default-src 'none'`, no external resources) | `more.test.ts` dashboard |
| NV-5 | Should | Done | `keel explain` + `explain:` in every shipped step | `more.test.ts` explains every step |

## Discovery and planning

| ID | Pri | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| DP-1 | Must | Done | `keel-discovery` skill, brief template, 60-line budget, approval gate | J1 |
| DP-2 | Must | Done | `keel-prd` skill, PRD template; lint `requirement-no-story` | J1, `keel check` |
| DP-3 | Must | Done | screen map and tokens templates; lint `story-no-screen` | J1 |
| DP-4 | Must | Done | ADR template (MADR); `keel start` refuses stories until a stack ADR is accepted | J1 |
| DP-5 | Must | Done | story template; lint: 1–7 criteria (error), vague words, template placeholders | lint in J1 and `mcp.test.ts` |
| DP-6 | Should | Done | `keel import prd <file>` quotes the file with a link | `migration.test.ts` |

## Agent execution and portability

| ID | Pri | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| AE-1 | Must | Done | `src/agents/compile.ts` | `compile.test.ts`: idempotent, keeps user content, warns on limits |
| AE-2 | Must | Partial | nine skills installed to `.claude/skills`, `.agents/skills`, `.github/skills` | Files verified by tests; only Claude Code was seen running them (one conformance run). Copilot, Cursor and Codex not yet checked |
| AE-3 | Must | Partial | `src/mcp/server.ts`, 8 tools, stdio | Exercised with the MCP SDK client in memory and over stdio; MCP Inspector and the four agents not yet run against it |
| AE-4 | Must | Done | `contextPack` with 20K default budget, size reported | J4 |
| AE-5 | Must | Done | Claude Code SessionStart hook; instructions make other agents call `get_context` first | J4 session brief names the story and open criteria |
| AE-6 | Should | Partial | `conformance/run.mjs` | Scripted reference agent passes in CI; one real Claude Code run (4 of 5 checks, see README); others not run |

## Verification and gates

| ID | Pri | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| VG-1 | Must | Done | `src/verify/scan.ts` (Dart, TS/JS, Swift, Kotlin) | `scan.test.ts` |
| VG-2 | Must | Done | `keel done`, `EvidenceRefusal`, `keel waive` | J1, `mcp.test.ts` refusal names the criterion |
| VG-3 | Must | Done | `src/verify/results.ts`: JUnit/xUnit XML, flutter `--machine`, Jest JSON | `results.test.ts` with Gradle, Swift, Jest and Flutter reports. XCTest bundles need xcbeautify `--report junit` |
| VG-4 | Must | Partial | `verify/action.yml` (composite), `keel verify --ci --format markdown` | CLI path tested; the action itself hasn't run on GitHub yet |
| VG-5 | Must | Done | `src/verify/drift.ts`, `verify.drift: advisory\|blocking` | `more.test.ts` drift |
| VG-6 | Must | Done | `src/verify/deps.ts`: npm, pub.dev, CocoaPods, SwiftPM (GitHub), Maven Central, Google Maven | `deps.test.ts` with a stubbed registry; live registries not called in tests |
| VG-7 | Must | Done | `src/verify/review.ts`; saved to `.keel/reviews/`, included in the CI comment | J1, J2 |

## Memory

| ID | Pri | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| ME-1 | Must | Done | `.keel/memory/decisions.md`, `record_decision`, `keel decide` | `mcp.test.ts`, `more.test.ts` |
| ME-2 | Should | Done | `keel constrain`, `record_decision` kind constraint; constraints in every context pack | `more.test.ts` |

## Migration

| ID | Pri | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| MG-1 | Must | Partial | `src/importers/bmad.ts` (v6 `_bmad-output`, v4 `docs/`) | Fixture project imports with no errors and a report; the PRD's bar of 8 of 10 real projects isn't measured yet |
| MG-2 | Must | Partial | `src/importers/speckit.ts` | Same: fixture only |
| MG-3 | Should | Partial | `keel export speckit` | Folder format tested; not yet round-tripped through a real `/speckit.implement` |

## Release and cost

| ID | Pri | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| RC-1 | Must | Done | `keel release`, mobile and web templates | J1 |
| RC-2 | Should | Done | `keel release notes` | J1 |
| RC-3 | Must | Done | `.keel/ledger/*.jsonl`, MCP `report_cost`, Claude Code Stop hook, `keel cost add`; unreported runs flagged | `mcp.test.ts`, `more.test.ts` |
| RC-4 | Should | Done | `keel start` estimates from past runs of the step and asks to continue | `more.test.ts` |

## Non-functional requirements

| ID | Status | Notes |
| --- | --- | --- |
| NF-1 Local-first | Done | No account or service. Network only for the dependency gate (skippable) |
| NF-2 Portability | Done | Plain Markdown and YAML; uninstalling leaves `.keel/` readable |
| NF-3 Performance | Done | `cli.test.ts`: status, next and check under 1 s on 200 artifacts (Node startup included) |
| NF-4 Footprint | Done | Compile warns past limits; MCP tool definitions ~900 tokens (`mcp.test.ts`) |
| NF-5 Platforms | Partial | Linux tested; macOS and Windows untested; no npm package or binary yet |
| NF-6 Security | Done | No telemetry; MCP is stdio only; no secrets in `.keel/` (the release checklist says where they go) |
| NF-7 Safety | Done | Keel never pushes, publishes or submits; the submit step is a checklist item for a person |
| NF-8 Robustness | Done | Malformed YAML reports file and line; `submit_artifact` restores the previous file on error |
| NF-9 Merge-friendliness | Done | One artifact per file, fixed front-matter order |
| NF-10 Licensing | Done | MIT |
| NF-11 Accessibility | Partial | CLI readable without color; dashboard uses semantic tables, text labels and AA color tokens, but hasn't had an accessibility audit |
| NF-12 Docs | Done | `--help` on every command, `keel explain` for every step, `docs/walkthrough.md` with `examples/flutter-habits` |
