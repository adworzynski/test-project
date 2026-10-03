---
id: ST-002
type: story
status: approved
title: Check off a habit
links:
  implements: [FR-002]
  screens: [SC-001]
  depends_on: [ST-001]
criteria: [AC-003, AC-004]
owner: adam
created: 2026-10-03
updated: 2026-10-03
---

# ST-002: Check off a habit

As a user, I want to check off a habit for today, so that I see my progress.

## Acceptance criteria

### AC-003: One tap marks today done
- Given a habit not done today
- When I tap its checkbox
- Then it shows as done for today

### AC-004: Undo the same day
- Given a habit done today
- When I tap its checkbox again
- Then it shows as not done
