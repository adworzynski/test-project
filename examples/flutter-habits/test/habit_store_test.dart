import 'package:flutter_test/flutter_test.dart';
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
