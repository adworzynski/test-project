---
id: ST-001
type: story
status: in-progress
title: Create a habit
links:
  implements: [FR-001]
  screens: [SC-002]
criteria: [AC-001, AC-002]
owner: adam
created: 2026-10-03
updated: 2026-10-03
started: 2026-10-03T09:00:00Z
---

# ST-001: Create a habit

As a new user, I want to create a habit by name, so that I can start tracking it.

## Acceptance criteria

### AC-001: A saved habit is listed
- Given the Today screen with no habits
- When I create a habit named "Read"
- Then "Read" is listed on the Today screen

### AC-002: Empty names are rejected
- Given the New habit screen
- When I save with an empty or whitespace-only name
- Then the message "Name is required" is shown and nothing is saved

## Tasks
- [x] TK-001: Write failing tests tagged `@keel AC-001` and `@keel AC-002`
- [ ] Implement until the tests pass
