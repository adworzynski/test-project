---
name: keel-discovery
description: Interview the user about a new app idea and write a one-page Keel brief (problem, users, jobs, success metrics, constraints, assumptions). Use when a Keel project has no approved brief or the user wants to start a new product.
---

# Keel discovery interview → one-page brief

Goal: a brief of about 60 lines at most that the user approves. Ask, don't assume.

1. Call `get_context`. If a brief already exists and is approved, stop and say so.
2. Interview the user in short rounds of 2–3 questions. Cover:
   - the problem and who has it today (primary and secondary users),
   - the jobs they hire the app for ("When …, I want to …, so I can …"),
   - how success is measured (numbers and time frames),
   - constraints: platforms, deadline, budget, regulations, offline needs,
   - the riskiest assumptions.
   Stop after about 10 questions; note open points as assumptions.
3. Write the brief with the sections of the template (`keel add brief "<app name>"` creates it,
   or call `submit_artifact` with type `brief` and the full Markdown).
4. Keep it under budget. If `submit_artifact` reports the budget is exceeded, shorten it.
5. Call `request_review` with the brief ID (CLI: `keel review <id> --request`). Show the user the
   review pack and ask them to run `keel approve <id>` or tell you what to change.
6. Record notable choices with `record_decision` (e.g. "iOS first, Android in v2").
