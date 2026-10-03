export interface Habit {
  name: string;
}

/** AC-001, AC-002: adds a habit; empty names are rejected. */
export function addHabit(habits: Habit[], name: string): Habit[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required');
  return [...habits, { name: trimmed }];
}
