---
name: keel-prd
description: Draft a lean Keel PRD from the approved brief, with numbered FR and NFR requirements and MoSCoW priorities. Use after the brief is approved, or to import an existing PRD or README as source material.
---

# Keel lean PRD

1. Call `get_context`; read the approved brief. If the user has an existing PRD, README, Notion or
   Confluence export, run `keel import prd <file>` first. It is quoted as a source artifact (SRC-…)
   with a link to the file; cite it rather than retyping it.
2. Write one PRD (`keel add prd "<app name> PRD"`, or `submit_artifact` type `prd`):
   - `## Scope`: the MVP cut and what is out of scope.
   - `## Functional requirements`: one section per requirement,
     `### FR-007: Short name [Must]`, then one or two sentences of user-visible behavior.
   - `## Non-functional requirements`: `### NFR-002: Quality [Should]` with a measurable target.
   - Use Must, Should, Could, Won't. Keep requirements product-level: no frameworks, no tables.
3. Link the PRD to the brief: `links: { derived_from: [BR-001] }`.
4. Stay under the PRD budget (300 lines by default). Merge overlapping requirements.
5. `request_review` the PRD and ask the user to approve it (`keel approve <id>`).
