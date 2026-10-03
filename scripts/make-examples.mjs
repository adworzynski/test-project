// Regenerates examples/ by driving the real CLI, so the sample artifacts always match this version.
// Usage: npm run build && node scripts/make-examples.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const env = { ...process.env, KEEL_USER: 'adam', KEEL_NOW: '2026-10-03T09:00:00Z', NO_COLOR: '1' };

function keel(dir, ...args) {
  return execFileSync('node', [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
}
function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}
/** Replaces an artifact's body, keeping the front-matter Keel wrote. */
function body(dir, id, text, fm = {}) {
  const dirs = ['brief', 'prd', 'screens', 'tokens', 'adr', 'stories', 'changes'].map((d) => path.join(dir, '.keel/artifacts', d));
  for (const d of dirs) {
    for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) {
      if (!f.startsWith(id + '-')) continue;
      const p = path.join(d, f);
      let s = fs.readFileSync(p, 'utf8');
      const end = s.indexOf('\n---', 3) + 4;
      let head = s.slice(0, end);
      for (const [k, v] of Object.entries(fm)) head = head.replace(new RegExp(`^${k}: .*$`, 'm'), `${k}: ${v}`);
      fs.writeFileSync(p, head + '\n\n' + text.trim() + '\n');
      return;
    }
  }
  throw new Error(`no ${id}`);
}
function gate(dir, ...ids) {
  for (const id of ids) {
    keel(dir, 'review', id, '--request');
    keel(dir, 'approve', id);
  }
}

// ---------------------------------------------------------------- Flutter: full Product track planning
const fl = path.join(ROOT, 'examples', 'flutter-habits');
fs.rmSync(fl, { recursive: true, force: true });
write(fl, 'pubspec.yaml', `name: habits
description: A small habit tracker, the Keel sample app.
publish_to: none
version: 0.1.0+1

environment:
  sdk: ">=3.5.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter

dev_dependencies:
  flutter_test:
    sdk: flutter
`);
write(fl, 'lib/habit_store.dart', `/// In-memory habit store. Stories ST-001 and ST-002 grow it.
class Habit {
  Habit(this.name);
  final String name;
  final Set<DateTime> doneDays = {};
}

class HabitStore {
  final List<Habit> habits = [];

  /// AC-001, AC-002: adds a habit; empty names are rejected.
  Habit add(String name) {
    final trimmed = name.trim();
    if (trimmed.isEmpty) throw ArgumentError('Name is required');
    final habit = Habit(trimmed);
    habits.add(habit);
    return habit;
  }
}
`);
write(fl, 'lib/main.dart', `import 'package:flutter/material.dart';

void main() => runApp(const HabitsApp());

class HabitsApp extends StatelessWidget {
  const HabitsApp({super.key});

  @override
  Widget build(BuildContext context) => const MaterialApp(home: Scaffold(body: Center(child: Text('Today'))));
}
`);
write(fl, 'test/habit_store_test.dart', `import 'package:flutter_test/flutter_test.dart';
import 'package:habits/habit_store.dart';

void main() {
  group('HabitStore', () {
    // @keel AC-001
    test('a saved habit is listed', () {
      final store = HabitStore()..add('Read');
      expect(store.habits.map((h) => h.name), ['Read']);
    });

    // @keel AC-002
    test('empty names are rejected', () {
      expect(() => HabitStore().add('  '), throwsArgumentError);
    });
  });
}
`);
write(fl, '.gitignore', '.dart_tool/\nbuild/\n');
keel(fl, 'init', '--name', 'habits', '--no-git-hook');

keel(fl, 'add', 'brief', 'Habits');
body(fl, 'BR-001', `
# BR-001: Habits

## Problem
People who want to build small daily habits lose track after a few days, because existing apps are
cluttered with social features and streak pressure.

## Users
- Primary: adults starting one to three new habits
- Secondary: people restarting a habit after a break

## Jobs to be done
- When I start a new habit, I want to check it off in one tap, so I keep going without friction.
- When I miss a day, I want to see my longer-term progress, so one miss doesn't make me quit.

## Success metrics
- 30% of new users check off a habit on 5 of their first 7 days
- Median time from launch to check-off under 5 seconds

## Constraints
- Platforms: iOS and Android, offline-first, no account
- Time and budget: one developer, evenings, first store release in 8 weeks

## Assumptions to test
- Users prefer a weekly view to streak counters
`);
gate(fl, 'BR-001');

keel(fl, 'add', 'prd', 'Habits PRD', '--link', 'derived_from:BR-001');
body(fl, 'PRD-001', `
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
`);
gate(fl, 'PRD-001');

keel(fl, 'add', 'screen-map', 'Habits screens');
body(fl, 'SM-001', `
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
`);
keel(fl, 'add', 'design-tokens', 'Habits tokens');
keel(fl, 'add', 'adr', 'State management with Riverpod');
body(fl, 'ADR-001', `
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
`, { links: '{ serves: [NFR-001] }' });
keel(fl, 'add', 'adr', 'Local storage with SQLite (drift)');
body(fl, 'ADR-002', `
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
`, { links: '{ serves: [NFR-002] }' });
gate(fl, 'SM-001', 'DT-001', 'ADR-001', 'ADR-002');
keel(fl, 'decide', 'Riverpod for state, drift for storage', '--link', 'ADR-001', '--step', 'architecture');

keel(fl, 'add', 'story', 'Create a habit', '--link', 'implements:FR-001', '--link', 'screens:SC-002');
body(fl, 'ST-001', `
# ST-001: Create a habit

As a new user, I want to create a habit by name, so that I can start tracking it.

## Acceptance criteria

### AC-001: A saved habit is listed
- Given the Today screen with no habits
- When I create a habit named "Read"
- Then "Read" is listed on the Today screen

### AC-002: Empty names are rejected
- Given the New habit screen
- When I save with an empty or whitespace-only name
- Then the message "Name is required" is shown and nothing is saved

## Tasks
- [x] TK-001: Write failing tests tagged \`@keel AC-001\` and \`@keel AC-002\`
- [ ] Implement until the tests pass
`, { criteria: '[AC-001, AC-002]' });
keel(fl, 'add', 'story', 'Check off a habit', '--link', 'implements:FR-002', '--link', 'screens:SC-001', '--link', 'depends_on:ST-001');
body(fl, 'ST-002', `
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
`, { criteria: '[AC-003, AC-004]' });
keel(fl, 'add', 'story', 'This week at a glance', '--link', 'implements:FR-003', '--link', 'screens:SC-001', '--link', 'depends_on:ST-002');
body(fl, 'ST-003', `
# ST-003: This week at a glance

As a user, I want to see the last 7 days for each habit, so one missed day doesn't discourage me.

## Acceptance criteria

### AC-005: Seven dots per habit
- Given a habit done on Monday and Wednesday
- When I open the Today screen on Thursday
- Then the habit shows 7 dots with Monday and Wednesday filled
`, { criteria: '[AC-005]' });
gate(fl, 'ST-001', 'ST-002', 'ST-003');
keel(fl, 'start', 'ST-001');
keel(fl, 'spec');

// ---------------------------------------------------------------- Expo: planning in progress
const ex = path.join(ROOT, 'examples', 'expo-habits');
fs.rmSync(ex, { recursive: true, force: true });
write(ex, 'package.json', JSON.stringify({
  name: 'habits-expo',
  version: '0.1.0',
  private: true,
  main: 'expo-router/entry',
  scripts: { start: 'expo start', test: 'jest' },
  dependencies: { expo: '~54.0.0', 'expo-router': '~6.0.0', react: '19.1.0', 'react-native': '0.81.4' },
  devDependencies: { jest: '^29.7.0', 'jest-expo': '~54.0.0', typescript: '~5.9.2' },
  jest: { preset: 'jest-expo' },
}, null, 2) + '\n');
write(ex, 'app.json', JSON.stringify({ expo: { name: 'Habits', slug: 'habits', version: '0.1.0', ios: { buildNumber: '1' }, android: { versionCode: 1 } } }, null, 2) + '\n');
write(ex, 'src/habits.ts', `export interface Habit {
  name: string;
}

/** AC-001, AC-002: adds a habit; empty names are rejected. */
export function addHabit(habits: Habit[], name: string): Habit[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required');
  return [...habits, { name: trimmed }];
}
`);
write(ex, 'src/__tests__/habits.test.ts', `import { addHabit } from '../habits';

describe('habits', () => {
  // @keel AC-001
  it('a saved habit is listed', () => {
    expect(addHabit([], 'Read').map((h) => h.name)).toEqual(['Read']);
  });

  // @keel AC-002
  it('empty names are rejected', () => {
    expect(() => addHabit([], '  ')).toThrow('Name is required');
  });
});
`);
write(ex, '.gitignore', 'node_modules/\n.expo/\n');
keel(ex, 'init', '--name', 'habits-expo', '--agents', 'claude,copilot', '--no-git-hook');
keel(ex, 'add', 'brief', 'Habits for Expo');
body(ex, 'BR-001', `
# BR-001: Habits for Expo

## Problem
The same habit tracker as the Flutter sample, built with Expo, to show Keel on a React Native stack.

## Users
- Primary: adults starting one to three new habits

## Success metrics
- 30% of new users check off a habit on 5 of their first 7 days

## Constraints
- Platforms: iOS and Android via Expo, offline-first
`);
keel(ex, 'review', 'BR-001', '--request');
console.log('examples regenerated');
