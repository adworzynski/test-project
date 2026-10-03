---
name: keel-next
description: Show where this Keel project stands and what to do next. Use at the start of a session, after context compaction, when switching agents, or whenever you are unsure what to work on.
---

# Keel: where are we, what's next

1. Call the MCP tool `get_context` with no arguments (CLI: `keel context --session`).
   It returns the current story or change, its open criteria, recent decisions and constraints.
2. Call `next_steps` (CLI: `keel next`). It returns 1–3 actions, each with the command or skill to run.
3. Tell the user, in three lines or fewer: the current phase, the item in progress, and the next action.
4. If the next action is a human gate (approve, reject, waive, submit), stop and ask the user.
   Don't approve on their behalf.
5. Otherwise run the named skill or command.

`get_status` (CLI: `keel status`) gives the full picture: artifacts by status, open gates, blocked
items, verification coverage and cost.
