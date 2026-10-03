---
name: keel-implement
description: Implement one Keel story or change test-first, tagging tests with criterion IDs, adding Keel-Ref commit trailers and proving each criterion with a passing test before marking it done. Use for the Build step of any track.
---

# Keel implement (tests first, evidence before done)

1. Pick the item: `next_steps` names it. Run `keel start <id>`. Keel refuses if gates are open,
   for example missing stack ADRs or an unapproved Feature plan.
2. Call `get_context` with the ID. Read the criteria, linked requirements, ADRs, screens,
   decisions and constraints in the context pack. Don't start before reading them.
3. For each criterion, write a failing test first, tagged in a comment directly above it:
   ```dart
   // @keel AC-012
   testWidgets('saving a habit shows it in the list', (tester) async { … });
   ```
   For a Quick change, the first test reproduces the bug and must fail before the fix.
4. Implement the smallest change that makes the tests pass. Follow accepted ADRs and constraints.
5. Commit in small steps; end each message with the trailer `Keel-Ref: <id>`.
6. Run `keel verify --run --record` (or run the tests yourself and call `record_evidence` with
   the report path). Fix every criterion that is failing, not run, or untested.
7. Run `keel done <id>` (or `submit_artifact` with `status: done`). Keel refuses and names the
   criteria still uncovered; never edit the status yourself.
8. If the work changed behavior beyond the criteria, add or modify criteria first (a change's
   `### MODIFIED` section), so the spec stays true.
9. Call `report_cost` with the tokens you used, if your agent doesn't report them automatically.
