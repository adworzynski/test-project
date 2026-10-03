---
id: SM-001
type: screen-map
status: approved
title: Habits screens
links: {}
owner: adam
created: 2026-10-03
updated: 2026-10-03
---

# SM-001: Habits screens

## Flows
- First run: SC-001 (empty) → SC-002 → SC-001

## Screens

### SC-001: Today
- Purpose: list habits with a check-off control and this week's dots.
- Key elements: habit rows, add button, weekly dots.
- States: empty, loading, error
- Requirements: FR-002, FR-003

### SC-002: New habit
- Purpose: create a habit.
- Key elements: name field, save button, validation message.
- States: invalid name
- Requirements: FR-001
