---
name: keel-architecture
description: Propose Keel ADRs (MADR format) for the stack choices of the app, such as state management, local storage, backend, navigation and testing. Use after the PRD is approved and before the first story starts.
---

# Keel stack decisions (ADRs)

1. Call `get_context`; read the PRD, NFRs and constraints. Look at the code that exists (pubspec.yaml,
   package.json, Package.swift, build.gradle) so decisions match reality.
2. For each decision that is expensive to change later, create one ADR (`keel add adr "<decision>"`):
   - Flutter: state management, local storage, navigation, backend/sync, testing approach.
   - Expo/React Native: state, storage, navigation (expo-router), backend, testing (Jest + Maestro).
   - SwiftUI: architecture (MV/TCA), persistence (SwiftData/Core Data), networking, testing.
   - Compose: DI, persistence (Room/DataStore), navigation, testing.
3. Each ADR: context, 2–3 considered options, the chosen option with "because …", consequences.
   Under 60 lines. Link the requirements it serves: `links: { serves: [NFR-001] }`.
4. Prefer mainstream, maintained packages; check each exists on the official registry.
5. `request_review` each ADR. The user accepts with `keel approve <id>` (status becomes accepted).
6. Record a one-line summary of each accepted ADR with `record_decision`.
