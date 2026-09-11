/**
 * Keys for a list of these chips.
 *
 * A chip owns its disclosure state, so the list's key is what decides which
 * chip that state belongs to. An index key hands it to whoever slides into the
 * vacated position when an earlier chip is removed, and the open row reappears
 * on a chip nobody touched.
 *
 * The value is the natural key, right up until the list holds the same string
 * twice — where React's behaviour is undefined and the state lands wherever it
 * lands. That is not hypothetical here: these lists are persisted as `List[str]`
 * with no uniqueness constraint (`apparatus_type_skills`), and renaming one
 * entry onto another used to be accepted, so a duplicate can already be stored.
 * Guarding the write path does nothing for a row written before the guard.
 *
 * So the key is the value *and* which occurrence of it this is. Removing or
 * reordering a *different* entry leaves every other key exactly as it was,
 * which is the case that matters, and no two entries ever share a key.
 *
 * What it deliberately does not claim: removing one copy of a repeated value
 * renumbers the copies after it, so the survivor is remounted and its open row
 * closes. That is not a shortcut — it is the ceiling. A `string[]` carries no
 * identity for its entries, so after a removal nothing in the data says which
 * of two identical strings went; any scheme derived from this prop alone has to
 * guess. Closing a row is the mild way to be wrong. The alternative, keying by
 * value alone, renders the removed entry's chip as well as the survivor's —
 * verified, not assumed, and pinned in EditableTagList.test.tsx.
 *
 * Carrying real per-entry identity means ids in the prop and in the state of
 * both panels that own these lists; the persisted shape would not have to
 * change, but the component's interface would.
 */
export const tagChipKeys = (items: string[]): string[] => {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const seen = occurrences.get(item) ?? 0;
    occurrences.set(item, seen + 1);
    // Count, separator, value — in that order, so the first NUL in the key is
    // always the separator and the pair is recoverable from it. Suffixing
    // instead would collide the moment a stored value happened to end in a NUL
    // and a digit, which JSON can carry even though the input cannot type it.
    return `${seen}\u0000${item}`;
  });
};
