---
id: ADR-001
type: adr
status: accepted
title: State management with Riverpod
links:
  serves: [NFR-001]
owner: adam
created: 2026-10-03
updated: 2026-10-03
---

# ADR-001: State management with Riverpod

## Context and problem statement
Screens share the habit list and today's state. We need testable state without a lot of boilerplate (NFR-001).

## Considered options
1. Riverpod
2. Bloc
3. setState with InheritedWidget

## Decision outcome
Chosen option: "Riverpod", because providers are easy to override in tests and it adds little code.

### Consequences
- Good: widget tests can inject a fake store.
- Bad: one more package to keep up to date.
