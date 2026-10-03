---
name: keel-release
description: Prepare a Keel release - generate the store release checklist (version, signing, metadata, screenshots, privacy labels, review notes) and release notes, and walk the user through it. Keel and the agent never submit; the user does.
---

# Keel release checklist

1. Call `get_status`. Every story must be done and every criterion covered; if not, list what is
   missing and stop.
2. Run `keel release <version>` (for example `keel release 1.0.0`). It creates `RL-…` from the
   PRD and screens: screenshots per device size, privacy items from data-related requirements,
   signing and metadata.
3. Run `keel release notes` and paste the notes into the checklist's release notes item.
4. Walk the user through each open item. Tick items (`- [x]`) only when the user confirms them or
   you verified them in the repo (for example the version in pubspec.yaml).
5. Never upload a build, submit for review or store credentials. The submit items are for the user.
6. When every box is ticked, the user runs `keel done <id>`.
