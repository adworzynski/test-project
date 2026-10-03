# Walkthrough: the Habits sample app

`examples/flutter-habits` is a small Flutter app that was taken through the Product track with the
real CLI (`scripts/make-examples.mjs` regenerates it). Its `.keel/` folder shows what each step
produces. This page follows the same steps on your own app, and points at the sample's files.

`examples/expo-habits` is the same idea on Expo, stopped at the first gate (brief waiting for review).

## J1: from idea to a store-ready build

### 1. Init

```sh
cd my-app
keel init
```

Keel detects the stack from `pubspec.yaml` (Flutter), `package.json` with `expo` (Expo), `Package.swift`
or an `.xcodeproj` (SwiftUI), Gradle files (Compose), or another `package.json` (web). It looks for
`.claude/`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.vscode/`, `.cursor/`, `.codex/` and
`AGENTS.md` to find your agents, and writes files for all four when it finds none. It also writes a
CI workflow and a commit-msg hook (`--no-ci`, `--no-git-hook` to skip them).

`keel next` now says: *Discovery: One-page brief*, with the `keel-discovery` skill.

### 2. Brief (gate)

In your agent run the `keel-discovery` skill. It asks about the problem, users, jobs, success
metrics, constraints and assumptions, then writes `BR-001` (sample:
`.keel/artifacts/brief/BR-001-habits.md`, 35 lines against a 60-line budget) and requests review.

```sh
keel review BR-001        # the review pack: size, what to check
keel approve BR-001       # or: keel reject BR-001 -m "Success metrics need numbers"
```

The decision lands in `.keel/gates/BR-001.yaml` with your name, the time and the artifact hash.

### 3. PRD, screens, tokens, stack ADRs (gates)

Run `keel-prd`, `keel-screens` and `keel-architecture`. Requirements are sections
(`### FR-002: Check off a habit [Must]`), screens are sections (`### SC-001: Today` with
`Requirements: FR-002, FR-003`), and each stack decision is an ADR in MADR form. Approve each one.
An approved ADR becomes `accepted`; stories can't start until at least one stack ADR is accepted.

### 4. Stories (gate)

`keel-stories` splits the PRD into stories. Each links the requirements and screens it touches and
has 1–7 criteria with their own IDs:

```markdown
### AC-001: A saved habit is listed
- Given the Today screen with no habits
- When I create a habit named "Read"
- Then "Read" is listed on the Today screen
```

`keel check` reports stories without criteria, vague criteria ("fast", "intuitive"), UI stories
without a screen, and Must/Should requirements without a story.

### 5. Build each story (evidence gate)

```sh
keel next                  # Start ST-001 (Create a habit)
keel start ST-001
keel context ST-001        # the context pack your agent works from
```

In the agent, `keel-implement` writes failing tests first, tagged with the criteria they prove
(sample: `examples/flutter-habits/test/habit_store_test.dart`), then the code, and commits with
`Keel-Ref: ST-001`. Then:

```sh
keel verify --run --record   # runs `flutter test --machine`, maps results to AC-001 and AC-002
keel done ST-001
```

Without passing evidence `keel done` exits with code 2 and lists the uncovered criteria. Only a
person can accept a criterion without a test: `keel waive AC-002 -m "<why>"`.

The sample stops here: ST-001 is in progress and its tests exist but haven't been run. With
Flutter installed, run the two commands above in `examples/flutter-habits` to finish it.

### 6. Release (checklist gate)

```sh
keel release 1.0.0
keel release notes
```

`RL-001` lists version and build (from `pubspec.yaml`), signing, store metadata, screenshots per
device size for your screens, privacy declarations for requirements that touch data, review notes,
and a submit step that only you can tick. `keel done RL-001` refuses while a box is open, a story is
unfinished or a criterion lacks evidence.

## J2: a bug fix on the Quick track

```sh
keel new "Fix crash when a habit name has an emoji" --affects FR-001
```

The router prints the track and why ("description reads like a small fix", "touches 1 file"). The
change note has two sections, `## Why` and `## Delta`, and stays under 60 lines. Start it, write a
reproduction test tagged with the new criterion, fix, verify, and finish:

```sh
keel start CH-001
keel verify --run --record
keel done CH-001
```

`keel done` merges the delta (ADDED criteria stay with the change; MODIFIED and REMOVED ones are
applied to the stories and PRD), regenerates `.keel/spec/`, and moves the change to
`.keel/artifacts/changes/archive/` with the date. If the fix touched `lib/auth/…`, Keel moves the
change to the Feature track instead, records the path, and asks for plan approval.

## J3: bring a BMAD or Spec Kit project

```sh
keel import bmad            # reads _bmad-output/ (v6) or docs/ (v4)
keel import speckit         # reads .specify/memory/constitution.md and specs/*/
keel status
```

Each import writes `.keel/import-report-<source>.md`: what was created, how source IDs map to Keel
IDs, what couldn't be linked, and what was left in place. To keep using Spec Kit's commands during
the move, `keel export speckit CH-004` writes `specs/NNN-…/spec.md`, `plan.md` and `tasks.md`.

## J4: switch agents mid-story

Close Claude Code and open Codex, Copilot or Cursor in the same repo. Their instructions tell them to
call `get_context` first; it returns the current story, its open criteria, recent decisions,
constraints and the next step. Claude Code gets the same brief from its SessionStart hook after
startup, `/clear` and compaction.
