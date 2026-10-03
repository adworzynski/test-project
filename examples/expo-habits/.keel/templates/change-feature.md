---
id: {{id}}
type: change
status: draft
title: {{title}}
track: feature
links: {}
criteria: [{{next_ac}}]
owner: {{owner}}
created: {{date}}
updated: {{date}}
---

# {{id}}: {{title}}

## Why
{{description}}

## Delta

### ADDED

#### {{next_ac}}: Observable behavior
- Given …
- When …
- Then …

### MODIFIED
<!-- Copy a requirement or criterion heading (e.g. "#### FR-003: …") and write its new text. -->

### REMOVED
<!-- "#### AC-010: Reason it no longer applies" -->

## Design
<!-- Components touched, data changes, ADRs (add to links.adr). Keep it short. -->

## Tasks
- [ ] {{next_tk}}: Write failing tests tagged `@keel {{next_ac}}`
- [ ] Implement until the tests pass
