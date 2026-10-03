/// In-memory habit store. Stories ST-001 and ST-002 grow it.
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
