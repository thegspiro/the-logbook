import { slugKey } from './outlineKeys';

const MAX_KEY_LENGTH = 50;

/** A slot key the server accepts: starts with a letter, at most 50 characters, and not already used. */
export const newSlotKey = (title: string, taken: ReadonlySet<string>): string => {
  let base = slugKey(title);
  if (!/^[a-z]/.test(base)) base = `slot_${base}`;
  base = base.slice(0, MAX_KEY_LENGTH - 3);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
};
