/**
 * A key for a new agenda item, accepted by the server (lowercase letters, digits, - or _, at most 50 characters)
 * and unused on the agenda.
 *
 * It is random rather than counted or taken from the title. The minutes section made from an item is named after
 * its key, and a later sync decides "same item" by key, so a key must never be handed out again after its item is
 * removed: a counter would give a deleted item's key to the next one added and sync would rewrite the old section
 * to match it. It is given once and kept, so renaming an item does not change it.
 */
export const newAgendaItemKey = (taken: ReadonlySet<string>): string => {
  let key: string;
  do {
    key = `item_${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
  } while (taken.has(key));
  return key;
};
