# Keel MVP PRD

Oct 3, 2026 · @Adam

## Overview

Keel (working name) is an open-source CLI and MCP server that keeps one traceable artifact graph from idea to release and drives any coding agent through it. The MVP targets a solo developer building a mobile app with Claude Code, Copilot, Cursor or Codex, and must replace today's hand-stitched BMAD + Spec Kit setup.

**Problem.** Developers who build with agents today juggle a planning framework, one or more agents and a tracker, with nothing connecting them:

- PRD, specs, code and tests live in separate files and tools, with no links between them.
- Nobody knows the overall state or the next step once more than one framework is involved.
- Agents mark work done without evidence; 66% of developers say AI output is "almost right, but not quite" (Stack Overflow 2025).
- Spec frameworks run the same heavy process for a one-line fix as for a new feature, and specs drift once code ships.
- Moving between frameworks or agents means rewriting instructions and artifacts by hand.

**Why now.** AGENTS.md, Agent Skills (SKILL.md), MCP and Agent Plugins 1.0 are now shared standards across the major agents, so one layer can serve all of them. Meanwhile framework churn (GSD archived, Tessl pivoted, Spec Kit upgrades overwriting custom files) makes portability a real need.

**Positioning.** Keel is not another methodology or agent. It sits above them: it runs BMAD- or Spec Kit-style workflows as packs, imports their artifacts, and adds the graph, navigation, evidence-based gates and agent portability they lack.

## Goals and success metrics

The MVP succeeds if one developer can take a mobile app from idea to a store-ready build with any of four agents, always knowing the next step, and with every acceptance criterion backed by a passing test.

**Goals**

1. One linked artifact graph from brief to release, in git.
2. A clear "what's next" at every moment, from the CLI or inside any agent.
3. Process sized to the change: a bug fix costs minutes, not a spec ceremony.
4. "Done" means evidence, never the agent's claim.
5. Work runs unchanged on Claude Code, GitHub Copilot, Cursor and Codex.
6. Existing BMAD and Spec Kit projects move in without retyping.

**Non-goals for the MVP**

- Building a coding agent, IDE or model runtime.
- Hosted service, accounts or team features.
- Two-way tracker sync, enterprise architecture, RBAC and audit (V1/V2).
- Automated app-store submission; a human always submits.
- Spec-as-source code generation.

**Success metrics** (measured on the founder's own app plus 10 design partners)

| Metric | Target | How measured |
| --- | --- | --- |
| Time from `keel init` to first approved brief | Under 30 min | CLI timestamps |
| Overhead of the Quick track on a small change | Under 10% vs direct prompting | Timed paired tasks |
| Acceptance criteria with linked passing tests at release | 100% | `keel verify` report |
| "Marked done but broken" incidents | Down 50% vs baseline | Partner log, before and after |
| Generated Markdown per Feature track change | Under 300 lines | `keel stats` |
| Projects imported from BMAD or Spec Kit without manual fixes | 8 of 10 | Import report |
| Same workflow run end to end on each of the 4 agents | 4 of 4 | Adapter conformance suite |
| Weekly active projects 8 weeks after public release | 200 | Opt-in telemetry |

## Target users

The MVP serves one primary persona, a solo mobile developer, and keeps the model ready for small teams.

| Persona | Who | Today's setup | What they need from the MVP |
| --- | --- | --- | --- |
| **Solo mobile builder** (primary) | Indie or side-project developer shipping a Flutter, Expo/React Native, SwiftUI or Compose app | BMAD for planning, Spec Kit or plan mode for features, Claude Code or Copilot to code, a notes file for state | One flow from idea to store-ready build; next-step guidance; tests as proof; no lock-in to one agent |
| **Framework switcher** | Developer with BMAD, Spec Kit or OpenSpec projects already in flight | Artifacts in several incompatible formats | Import without retyping; keep using familiar commands during the move |
| **Small team lead** (secondary) | 2–5 people sharing one repo and mixed agents | Each person uses a different agent and instruction file | One instruction source for every agent; specs reviewed as PR diffs |

Enterprise architects and Scrum teams are V1 and V2 users. The MVP's data model, profiles and gates must not block them later.

## MVP scope

The MVP covers eleven areas at solo-developer depth; team and enterprise depth waits for V1 or V2.

| Area | In the MVP | Deferred |
| --- | --- | --- |
| Workflow engine | YAML workflows; Quick and Feature tracks; Product track for new projects; size/risk router with override; approval gates | Epic and Initiative tracks (V1); visual editor (V2) |
| Profiles | Solo mobile (Flutter, Expo, SwiftUI, Compose) and Solo web | Startup team, Scrum, Enterprise EA, Regulated (V1/V2) |
| Artifact graph | Brief, PRD items, screens, design tokens, ADRs, stories, criteria, tasks, tests, release checklist; IDs, links, deltas | Portfolio and multi-repo graph (V2) |
| Navigation | `keel status` / `keel next` in CLI and MCP; local read-only dashboard | Tool recommender (V1) |
| Verification | Criterion → test mapping, evidence gate, drift check and dependency-existence gate in GitHub Actions | Independent cross-vendor verifier, SAST and license gates (V1) |
| Agent support | Claude Code, GitHub Copilot, Cursor, Codex: instruction compiler, skills, MCP | Gemini CLI, Kiro, Windsurf/Devin, Cline (V1); parallel waves (V1) |
| Memory | Decisions and constraints log, re-injected at session start | Learnings capture, memory hygiene (V1) |
| Migration | Import BMAD and Spec Kit; export to Spec Kit | OpenSpec, Kiro, Task Master importers (V1) |
| Release | Mobile release checklist with human submit step | EAS/Fastlane automation, post-launch feedback (V1/V2) |
| Cost | Local token and cost ledger per step and story | Budgets, routing, forecasts (V1) |
| Team | Specs reviewed as PR diffs | Jira, Linear, Azure Boards sync; RBAC; audit (V1/V2) |

## Key user journeys

Four journeys define the MVP; each must work end to end on all four supported agents.

**J1. New mobile app, idea to store-ready build** (Product track)

1. `keel init` detects the stack (or asks), picks the Solo mobile profile and writes agent files for the agents found.
2. In their agent, the user runs the Keel discovery skill; a short interview produces a one-page brief. The user approves it.
3. Keel drafts a lean PRD with numbered requirements, a screen map and design tokens; the user edits and approves.
4. Keel proposes ADRs for stack choices (state management, storage, backend), then splits the PRD into stories with Given/When/Then criteria.
5. For each story, `keel next` hands the agent a context pack; the agent writes failing tests first, then code.
6. `keel verify` maps tests to criteria and blocks "done" until each criterion has a passing test.
7. When all stories are done, Keel produces the release checklist (signing, metadata, screenshots, privacy labels); the user submits.

**J2. Bug fix** (Quick track)

1. The user describes the bug; the router classifies it as Quick and says why.
2. Keel writes a two-section change note linked to the affected requirement.
3. The agent writes a reproduction test, then the fix; verify passes; the spec delta merges into the living spec.
4. If the fix touches auth, payments or the data schema, the router escalates to the Feature track and says so.

**J3. Bring an existing BMAD or Spec Kit project**

1. `keel import bmad` (or `speckit`) reads the PRD, architecture, epics, stories, specs, plans and tasks.
2. Keel builds the graph, assigns IDs, links what it can and lists what it could not link.
3. `keel status` shows the real state; the user keeps using `/speckit.implement` through the Spec Kit export until ready to switch.

**J4. Switch agents mid-story**

1. The user stops in Claude Code and opens Copilot or Codex in the same repo.
2. The new agent calls Keel's MCP tools (or reads the compiled instructions) and gets the same story, context pack, decisions log and next step.
3. Work continues with no re-explaining.

## Functional requirements

46 requirements in nine groups; 36 are Must for the MVP release, 10 are Should and may slip to the first point release.

### Workflow engine and routing

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| WF-1 | Workflows are YAML files in `.keel/workflows/` defining stages, steps, inputs, output artifact types, gates and the skill each step runs | Must | Schema-validated by `keel check`; a user can add, remove or reorder a step and the change takes effect without code changes |
| WF-2 | Ship Product, Feature and Quick tracks for the Solo mobile and Solo web profiles | Must | Each track runs end to end on a sample Flutter and a sample Expo app |
| WF-3 | Router classifies each new change as Quick or Feature by estimated size and touched paths, and explains why | Must | Classification and reason shown before work starts; user override in one command |
| WF-4 | Escalation: a Quick change that touches paths tagged sensitive (auth, payments, schema; configurable globs) is moved to Feature | Must | Escalation recorded on the change with the matching path |
| WF-5 | Approval gates: a step marked `gate` ends in `pending-review`; `keel approve <id>` or `keel reject <id> -m` advances or returns it | Must | Gate decisions stored in git with who, when and the artifact hash |
| WF-6 | Artifact-length budgets per track (default: Quick 60 lines, Feature 300 lines) | Must | Generation that exceeds the budget is summarized or split; `keel stats` reports lines per change |
| WF-7 | Workflow packs are versioned; `keel upgrade` merges pack updates with user edits three-way and shows conflicts | Should | Upgrading a pack never silently overwrites a user-edited file |

### Artifact graph

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| AG-1 | Every artifact is a Markdown file with YAML front-matter: `id`, `type`, `status`, `links`, `owner`, `created`, `updated` | Must | `keel check` fails on missing or duplicate IDs and on links to missing artifacts |
| AG-2 | Artifact types: brief, requirement (FR/NFR), screen, design-token set, ADR, story, criterion, task, change, release checklist, decision | Must | Each type has a template and a JSON Schema |
| AG-3 | Changes are deltas (added, modified, removed requirements or criteria) that merge into the living spec when the change is done | Must | After merge, the living spec reflects the delta and the change is archived with a date |
| AG-4 | Refine any approved artifact in place; Keel lists downstream artifacts affected and marks them for review | Must | Editing a requirement flags its stories, criteria and tests as `needs-review` |
| AG-5 | Commits and PRs reference story or change IDs via a `Keel-Ref:` trailer, added by the agent skill | Must | `keel trace <id>` lists linked commits and PRs |
| AG-6 | A derived SQLite index enables fast queries; it is rebuilt from files and never the source of truth | Should | Deleting the index and running `keel index` restores identical query results |

### Navigation and visibility

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| NV-1 | `keel status` shows current phase, artifacts by status, open gates, blocked items and verification coverage | Must | Output fits one terminal screen for a project with 50 stories |
| NV-2 | `keel next` returns the 1–3 next actions with the command or skill to run each | Must | On a fresh project it points to the discovery interview; never returns an empty answer |
| NV-3 | The same answers are available as MCP tools inside any MCP-capable agent | Must | Identical results from CLI and MCP on the conformance projects |
| NV-4 | `keel ui` serves a local read-only dashboard: board by status, artifact graph, coverage, cost | Should | Opens in under 2 s on a 50-story project; no network calls |
| NV-5 | `keel explain` describes the current step, why it exists and what good output looks like | Should | Available for every step in the shipped packs |

### Discovery and planning

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| DP-1 | Discovery interview skill produces a one-page brief: problem, users, jobs, success metrics, constraints, assumptions | Must | Brief stays under 1 page (about 60 lines) and is approved through a gate |
| DP-2 | Lean PRD with numbered FR and NFR items and MoSCoW priority | Must | Every FR has an ID and at least one linked story by the end of planning |
| DP-3 | Screen map and design-token artifacts linked to stories | Must | Each story that changes UI links at least one screen |
| DP-4 | ADR template (MADR) with status; proposed ADRs for stack choices in the mobile profile | Must | Stack ADRs exist before the first story starts |
| DP-5 | Story generation from the PRD with Given/When/Then criteria, each criterion its own ID | Must | Every story has 1–7 criteria; criteria failing an INVEST-style lint are flagged |
| DP-6 | Import an existing PRD or README as source material for DP-2 | Should | Imported text is quoted with a link to its source file |

### Agent execution and portability

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| AE-1 | Instruction compiler: one source in `.keel/agents/` compiles to AGENTS.md, CLAUDE.md, `.github/copilot-instructions.md`, `.cursor/rules/`, within each tool's size limits | Must | `keel compile` is idempotent; warns when output exceeds a tool's limit |
| AE-2 | Each workflow step ships as an Agent Skill (portable SKILL.md subset) installed to `.agents/skills/`, `.claude/skills/` and `.github/skills/` | Must | Each of the 4 agents lists and runs the skills on the conformance projects |
| AE-3 | MCP server (stdio) exposes get\_status, next\_steps, get\_context, submit\_artifact, request\_review, record\_evidence, record\_decision, report\_cost | Must | Passes MCP inspector checks; works in all 4 agents |
| AE-4 | Context pack per story or change: linked requirements, criteria, ADRs, screens, decisions and the relevant files, under a token budget (default 20K) | Must | Pack size reported; budget configurable per profile |
| AE-5 | Session-start re-injection of the decisions log and current story via Claude Code hooks, Copilot and Cursor equivalents, or the first MCP call | Must | After compaction or an agent switch, the agent names the current story and its open criteria without being told |
| AE-6 | Agent conformance suite runs the same Quick change on each agent in headless mode | Should | Runs in CI on each Keel release; results published in the README |

### Verification and gates

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| VG-1 | Tests are linked to criteria by a tag or annotation (`@keel AC-123`) in Dart, TypeScript, Swift and Kotlin test files | Must | `keel verify` lists every criterion with its tests and last result |
| VG-2 | A story or change can be marked done only when each criterion has at least one linked passing test, or an explicit human waiver with a reason | Must | Agents calling submit with missing evidence get a refusal naming the uncovered criteria |
| VG-3 | Test results are read from JUnit XML or the platform's native report format | Must | Works with `flutter test`, Jest, XCTest and Gradle test output |
| VG-4 | GitHub Action `keel/verify` runs coverage, drift and dependency checks on each PR and posts a summary | Must | Fails the check on uncovered criteria or a missing dependency, per profile policy |
| VG-5 | Drift check: flags a PR that changes files linked to a requirement with no spec delta, and requirements with no linked code or tests | Must | Advisory by default; configurable to blocking |
| VG-6 | Dependency-existence gate: new dependencies must exist in the registry and be older than a threshold (default 30 days) | Must | Blocks a hallucinated or brand-new package on pub.dev, npm, CocoaPods/SPM or Maven |
| VG-7 | Review pack per change: what changed against the spec, deviations, risk areas, uncovered criteria, under 1 screen | Must | Generated at each gate and attached to the PR description |

### Memory

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| ME-1 | Decisions and constraints log in `.keel/memory/` with source (who, which step, link) | Must | `record_decision` from any agent appends an entry visible to all agents |
| ME-2 | Corrections the user gives an agent can be saved as constraints with one command | Should | Saved constraints appear in the next context pack |

### Migration

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| MG-1 | Import BMAD v6 artifacts: brief, PRD, architecture, epics, stories, sprint status | Must | 8 of 10 real BMAD projects import with no manual fixes; an import report lists unlinked items |
| MG-2 | Import Spec Kit artifacts: constitution, spec, plan, tasks, checklists | Must | Same bar as MG-1 on 10 Spec Kit projects |
| MG-3 | Export a Feature change as a Spec Kit feature folder so `/speckit.implement` can run on it | Should | Round trip Keel → Spec Kit → implement works on the sample app |

### Release and cost

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| RC-1 | Mobile release checklist artifact: version and build numbers, signing, store metadata, screenshots per device size, privacy labels / data-safety form, review notes, human submit step | Must | Checklist generated from the PRD and screens; release cannot be marked done until every item is ticked |
| RC-2 | Release notes generated from the stories and changes completed since the last release | Should | Notes link each line to its story ID |
| RC-3 | Token and cost ledger: each agent run reports tokens and cost through MCP or a hook; totals per step, story and release | Must | `keel cost` shows totals; unreported runs are counted and flagged |
| RC-4 | Cost warning before a step whose estimate exceeds a configured threshold | Should | Warning shows estimate and asks to continue |

## Non-functional requirements

| ID | Area | Requirement |
| --- | --- | --- |
| NF-1 | Local-first | Works fully offline except for agent calls; no account, no hosted service; all state in the repo |
| NF-2 | Portability | Every artifact is plain Markdown + YAML readable without Keel; uninstalling leaves a usable docs folder |
| NF-3 | Performance | `keel status`, `next` and `check` return in under 1 s on a 200-artifact project; `verify` adds under 30 s to CI excluding test time |
| NF-4 | Footprint | Compiled instruction files stay under each tool's limit (CLAUDE.md about 200 lines, Codex 32 KiB); MCP tool definitions under 5K tokens |
| NF-5 | Platforms | macOS, Linux and Windows (WSL and native); single binary or `npx`/`pipx` install |
| NF-6 | Security | No telemetry by default; opt-in telemetry is anonymous and documented; no secrets stored in `.keel/`; MCP server is local stdio only |
| NF-7 | Safety | Keel never pushes, publishes or submits on its own; store submission is always a human step |
| NF-8 | Robustness | A malformed artifact fails `keel check` with file and line; it never corrupts other artifacts or the index |
| NF-9 | Merge-friendliness | One artifact per file, stable ordering in front-matter, so two branches rarely conflict |
| NF-10 | Licensing | Engine, packs and adapters under MIT |
| NF-11 | Accessibility | Dashboard meets WCAG 2.2 AA; CLI output readable without color |
| NF-12 | Docs | Each command and step has `--help` and an `explain` entry; a sample Flutter app walks through J1 |

## Architecture

Truth lives in git, enforcement lives in CI, and agents are clients of a local engine. Hooks and agent features speed things up, but the workflow still holds when an agent ignores instructions.

&#91;embedded content: MVP architecture · agents, local engine, repo, CI\]

Agents never hold state: they read compiled files and call the MCP server, the engine writes plain files to the repo, and CI decides whether a change has the evidence to merge.

**Repository layout**

```
.keel/
  keel.yaml            profile, agents, budgets, sensitive paths
  workflows/           product.yaml, feature.yaml, quick.yaml
  agents/              instruction source compiled by keel compile
  artifacts/
    brief/ prd/ screens/ tokens/ adr/ stories/ changes/ release/
  spec/                living spec (merged deltas)
  memory/              decisions.md, constraints.md
  gates/               approval records (who, when, artifact hash)
  evidence/            test-to-criterion results per run
  ledger/              token and cost entries
  index.sqlite         derived, git-ignored
```

**Artifact front-matter (example)**

```
id: ST-014
type: story
status: in-progress
links: { implements: [FR-007], screens: [SC-003], adr: [ADR-002] }
criteria: [AC-041, AC-042, AC-043]
owner: adam
```

**CLI surface**

| Command | Does |
| --- | --- |
| `keel init` | Detects stack and agents, picks a profile, writes `.keel/` and agent files |
| `keel status` / `keel next` | State and the next actions |
| `keel new <change>` | Starts a change; router picks Quick or Feature |
| `keel approve` / `keel reject` | Decides a gate |
| `keel compile` | Regenerates agent instructions and skills |
| `keel verify` | Coverage, drift and dependency checks (also the CI action) |
| `keel import bmad\|speckit` / `keel export speckit` | Migration |
| `keel check` / `keel trace <id>` / `keel cost` / `keel ui` | Validation, trace, cost, dashboard |

**MCP tools:** `get_status`, `next_steps`, `get_context`, `submit_artifact`, `request_review`, `record_evidence`, `record_decision`, `report_cost`.

## Agent support

The MVP supports four agents through three channels: compiled instructions, Agent Skills and the MCP server. Hooks are used where an agent has them; CI catches what hooks miss.

| Agent | Instructions written | Skills path | MCP | Session-start re-injection | Headless run for conformance |
| --- | --- | --- | --- | --- | --- |
| Claude Code | CLAUDE.md (imports AGENTS.md) | `.claude/skills/` | Yes | SessionStart hook | `claude -p` |
| GitHub Copilot (VS Code, CLI, cloud agent) | AGENTS.md, `.github/copilot-instructions.md` | `.github/skills/`, `.agents/skills/` | Yes | First MCP call (`get_context`) | Copilot CLI |
| Cursor | AGENTS.md, `.cursor/rules/keel.mdc` | `.agents/skills/` | Yes | First MCP call; Cursor hooks where available | Cursor CLI agent |
| OpenAI Codex | AGENTS.md | `.agents/skills/` | Yes | First MCP call | `codex exec` |

Paths and hook names change often; each is re-checked against the agent's current docs before release, and the conformance suite (AE-6) guards against breakage. V1 adds Gemini CLI, Kiro, Windsurf/Devin and Cline/Roo, plus packaging as Agent Plugins 1.0.

## Milestones

The MVP takes about 16 weeks from the start of validation to a public 0.1, with a go/no-go gate at the end of each phase.

&#91;embedded content: MVP plan · 4 phases, 16 weeks, a gate after each\]

Weeks count from the start of validation; no start date is set yet. The founder's own app runs through every phase as the first test case, and V1 (team profile, tracker sync, parallel waves, more agents) starts after the week 16 release.

## Risks, assumptions and open questions

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Keel itself feels like ceremony and solo users leave | High | Quick track by default, length budgets (WF-6), overhead tracked as a release metric |
| Agents ignore instructions or skip skills | High | Evidence gate in CI (VG-2, VG-4) works without agent cooperation |
| Agent paths, hooks and limits change between releases | High | Thin adapters, conformance suite (AE-6), version-pinned adapter tables |
| BMAD or Spec Kit formats change and break importers | Medium | Import against pinned versions; report unlinked items instead of failing |
| Test-to-criterion tagging is too much friction | Medium | Agent skill adds tags when it writes tests; `keel verify --suggest` proposes links for untagged tests |
| Drift check gives false positives and gets ignored | Medium | Advisory by default; tuned on the founder's app before release |
| GitHub, Atlassian or Linear ship a similar layer | Medium | Stay neutral across agents and trackers; integrate with them in V1 |

**Assumptions**

- Solo mobile developers will run a CLI next to their agent and accept a `.keel/` folder in the repo.
- MCP and Agent Skills support stays in all four MVP agents through the release.
- Test frameworks in the four mobile stacks can carry a tag or annotation per test.

**Open questions**

- [ ] Final product name (Keel is a working name).
- [ ] Implementation language for the CLI: TypeScript (npx, matches MCP SDKs) or Go (single binary)?
- [ ] Should the MVP include the Spec Kit export (MG-3) or keep it as a Should?
- [ ] How should the router estimate size before any code exists: lines touched, files, or an LLM estimate?
- [ ] Which 10 design partners, and how many must be BMAD or Spec Kit users?
