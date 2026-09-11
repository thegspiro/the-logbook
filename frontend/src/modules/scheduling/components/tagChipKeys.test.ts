import { describe, it, expect } from 'vitest';

import { tagChipKeys } from './tagChipKeys';

/**
 * `tagChipKeys` exists because the disclosure is per-chip state, so the list's
 * key decides which chip it belongs to. The lists that render these chips prove
 * that end of it against their own markup — see EditableTagList.test.tsx and
 * ShiftReportsSettingsPanel.test.tsx. What is pinned here is the function's two
 * properties: every entry gets its own key, and an entry's key does not move
 * when a different one is removed.
 */
describe('tagChipKeys', () => {
  it('gives every entry its own key, including a value that repeats', () => {
    expect(new Set(tagChipKeys(['Alpha', 'Bravo', 'Charlie'])).size).toBe(3);
    expect(new Set(tagChipKeys(['Alpha', 'Bravo', 'Alpha', 'Alpha'])).size).toBe(4);
  });

  it('leaves the other keys alone when an earlier entry is removed', () => {
    const before = tagChipKeys(['Alpha', 'Bravo', 'Charlie']);
    const after = tagChipKeys(['Bravo', 'Charlie']);

    // This is the property React needs and the one an index key does not have:
    // Bravo is still keyed as Bravo after the entry in front of it goes, so its
    // chip keeps its own disclosure instead of inheriting a neighbour's.
    expect(after).toEqual(before.slice(1));
  });

  it('does not collide with a value that contains the separator', () => {
    // The count goes first precisely so this holds: a stored value ending in a
    // NUL and a digit cannot spell another entry's generated key.
    expect(new Set(tagChipKeys(['Alpha', 'Alpha', 'Alpha\u00001'])).size).toBe(3);
  });
});
