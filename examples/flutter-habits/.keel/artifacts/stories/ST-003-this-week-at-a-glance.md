---
id: ST-003
type: story
status: approved
title: This week at a glance
links:
  implements: [FR-003]
  screens: [SC-001]
  depends_on: [ST-002]
criteria: [AC-005]
owner: adam
created: 2026-10-03
updated: 2026-10-03
---

# ST-003: This week at a glance

As a user, I want to see the last 7 days for each habit, so one missed day doesn't discourage me.

## Acceptance criteria

### AC-005: Seven dots per habit
- Given a habit done on Monday and Wednesday
- When I open the Today screen on Thursday
- Then the habit shows 7 dots with Monday and Wednesday filled
