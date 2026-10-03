---
name: keel-stories
description: Split the approved Keel PRD into small user stories, each with 1-7 Given/When/Then acceptance criteria that have their own AC IDs. Use after the PRD, screens and ADRs are approved.
---

# Keel stories with acceptance criteria

1. Call `get_context`; read the PRD, screen map and accepted ADRs.
2. Create one story per small, independently testable slice (`keel add story "<title>"`):
   - "As a …, I want …, so that …" in one sentence.
   - `links: { implements: [FR-…], screens: [SC-…], adr: [ADR-…] }`. UI stories must link a screen;
     set `ui: false` for stories without UI.
   - `## Acceptance criteria` with 1–7 sections `### AC-…: Observable behavior`, each with
     `- Given …`, `- When …`, `- Then …` lines. List the IDs in front-matter `criteria`.
   - Use `depends_on` links when one story needs another first.
3. Criteria must be testable: no "fast", "easy", "intuitive" or "etc."; give numbers instead.
4. Every Must and Should FR needs at least one story. Run `keel check` and fix what it reports.
5. Keep each story under 80 lines; split bigger ones (INVEST: independent, small, testable).
6. `request_review` the stories (one call per story) and ask the user to approve them.
