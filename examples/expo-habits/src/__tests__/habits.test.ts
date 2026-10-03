import { addHabit } from '../habits';

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
