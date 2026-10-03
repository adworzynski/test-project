---
id: PRD-001
type: prd
status: approved
title: Habits PRD
links:
  derived_from: [BR-001]
owner: adam
created: 2026-10-03
updated: 2026-10-03
---

# PRD-001: Habits PRD

## Scope
- MVP: create habits, check them off daily, see this week at a glance.
- Out of scope: accounts, sync, social features, reminders (v2).

## Functional requirements

### FR-001: Create a habit [Must]
The user creates a habit with a name of 1–40 characters.

### FR-002: Check off a habit [Must]
The user marks a habit done for today with one tap and can undo it the same day.

### FR-003: Weekly view [Should]
The user sees the last 7 days for each habit.

### FR-004: Delete a habit [Could]
The user deletes a habit after confirming.

## Non-functional requirements

### NFR-001: Cold start [Must]
Cold start under 2 s on a mid-range Android phone.

### NFR-002: Offline [Must]
Every feature works without a network connection.
