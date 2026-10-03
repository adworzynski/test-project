---
name: keel-change
description: Start a Keel change for a bug fix or a new feature. Keel routes it to the Quick or Feature track and explains why; then write the change note with its spec delta. Use whenever the user reports a bug or asks for a change after the initial build.
---

# Keel change note (Quick or Feature)

1. Run `keel new "<one-line description>"`. Add `--paths <files>` if you already know which files
   change. Keel prints the track (Quick or Feature) and the reasons, and creates `CH-…`.
   Tell the user the track and reasons; they may override with `keel route <id> --track <track>`.
2. Fill in the change note (`.keel/artifacts/changes/CH-….md`):
   - Quick (≤ 60 lines): `## Why` (what's wrong, how to reproduce) and `## Delta` with usually one
     `#### AC-…` under `### ADDED` that the bug breaks. Link the requirement: `links.affects`.
   - Feature (≤ 300 lines): `## Why`, `## Delta` (ADDED / MODIFIED / REMOVED requirements and
     criteria; a MODIFIED section repeats the heading of the item it replaces), `## Design`, `## Tasks`.
3. Feature track: `request_review` the change and wait for the user to `keel approve` it.
   Quick track: run `keel start <id>` directly.
4. Continue with the keel-implement skill.
5. If Keel escalates a Quick change to Feature (a sensitive path such as auth, payments or schema),
   say so, add the design section, and ask for approval.
