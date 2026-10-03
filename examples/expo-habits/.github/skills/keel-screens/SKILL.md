---
name: keel-screens
description: Draft the Keel screen map (SC-… screens, flows, states) and a design-token set from the approved PRD. Use after the PRD is approved, for any app with a user interface.
---

# Keel screen map and design tokens

1. Call `get_context`; read the approved PRD.
2. Create a screen map (`keel add screen-map "<app> screens"`):
   - `## Flows`: the main paths, e.g. `First run: SC-001 → SC-002`.
   - One `### SC-…: Name` section per screen with Purpose, Key elements, States (empty, loading,
     error, offline, permission denied) and `Requirements: FR-…` naming the requirements it serves.
   - Mobile: follow Apple HIG and Material conventions for navigation and touch targets (≥ 44 pt / 48 dp).
3. Create design tokens (`keel add design-tokens "<app> tokens"`): colors with on-colors, type
   scale, spacing, radius. Check text/background contrast is at least 4.5:1.
4. If the user has Figma designs, cite frame names next to each screen instead of inventing layouts.
5. `request_review` both artifacts and ask the user to approve them.
