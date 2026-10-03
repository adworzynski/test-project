---
id: ADR-002
type: adr
status: accepted
title: Local storage with SQLite (drift)
links:
  serves: [NFR-002]
owner: adam
created: 2026-10-03
updated: 2026-10-03
---

# ADR-002: Local storage with SQLite (drift)

## Context and problem statement
All data stays on the device and must work offline (NFR-002).

## Considered options
1. drift (SQLite)
2. shared_preferences with JSON

## Decision outcome
Chosen option: "drift", because the weekly view needs date queries.

### Consequences
- Good: typed queries and migrations.
- Bad: code generation step.
