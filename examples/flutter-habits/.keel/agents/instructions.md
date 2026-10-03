# Working in this repository with Keel

This project uses Keel: one traceable graph from brief to release, stored as Markdown in `.keel/`.
Keel decides what comes next and what counts as done. You (the agent) do the work; Keel keeps the
state, checks the evidence and remembers decisions across sessions and agents.

## Start of every session
1. Call the Keel MCP tool `get_context` (or run `keel context --session`) before anything else.
   Do it again after context compaction, `/clear`, or when you take over from another agent.
2. When unsure what to do, call `next_steps` (or run `keel next`) and follow the first action.

## Rules
- Work on one story (`ST-…`) or change (`CH-…`) at a time. It must be `in-progress`: run `keel start <id>`.
- Tests first. Tag each test with the criteria it proves, in a comment directly above it:
  `// @keel AC-012` (Dart, TypeScript, Swift, Kotlin). Put several IDs on one tag if needed.
- End every commit message with a trailer line: `Keel-Ref: <story or change id>`.
- Never declare work done yourself. Run the tests and `keel verify --run --record`, then
  `keel done <id>`. If Keel refuses, fix the criteria it names. Only a human may waive a criterion.
- Never edit `status:` in front-matter by hand. Use `keel` commands or the MCP tools.
- Keep artifacts short: brief ≤ 60 lines, Quick change ≤ 60, a whole Feature change ≤ 300.
  If Keel says a draft is over budget, summarize or split it; don't pad.
- When you choose between options, record it (`record_decision`, or `keel decide "…"`).
  When the user corrects you, save the correction as a constraint (`keel constrain "…"`).
- Only add dependencies that exist in the official registry and are more than 30 days old.
  Never invent package names; CI blocks unknown or brand-new packages.
- For a bug or small change, run `keel new "<description>"`. Keel routes it to the Quick or
  Feature track and explains why. Respect an escalation to Feature.
- Follow accepted ADRs in `.keel/artifacts/adr/` and the constraints in `.keel/memory/constraints.md`.
- Keel never pushes, publishes or submits to a store. Neither do you unless the user asks.

## Where things are
| Path | What |
| --- | --- |
| `.keel/artifacts/` | brief, PRD (FR/NFR), screens, tokens, ADRs, stories, changes, release |
| `.keel/spec/` | living spec: each requirement with its current criteria (generated) |
| `.keel/memory/` | `decisions.md`, `constraints.md` |
| `.keel/workflows/` | the tracks and their steps |

## Keel skills
Run these as skills in your agent (Claude Code: `/keel-discovery`, etc.; others: "use the keel-discovery skill").

| Skill | Step |
| --- | --- |
| keel-next | Show state and the next actions |
| keel-discovery | Interview → one-page brief |
| keel-prd | Brief → lean PRD with FR/NFR |
| keel-screens | Screen map and design tokens |
| keel-architecture | Stack ADRs |
| keel-stories | PRD → stories with Given/When/Then criteria |
| keel-implement | One story or change, tests first |
| keel-change | New bug fix or feature change note |
| keel-release | Release checklist |

## CLI cheat sheet
`keel status` · `keel next` · `keel start <id>` · `keel context <id>` · `keel verify --run --record` ·
`keel done <id>` · `keel review <id> --request` · `keel trace <id>` · `keel new "<description>"`
