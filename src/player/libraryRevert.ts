/**
 * `items` with the entry that `matches` put back the way `before` had it, and nothing else
 * touched. Undoes one failed optimistic edit — a save, a removal, a like — on the list as it is
 * now, so edits and refreshes that landed while it was in flight survive the undo.
 *
 * An entry `before` did not have is taken out. One it had is left alone if it is there (a
 * refresh may have brought a newer copy) and otherwise goes back after the nearest entry that
 * came before it and still does, so entries added since do not shift it; first if none is left.
 * `key` identifies those neighbours, which a refresh replaces with equal copies.
 */
export function restoreEntry<T>(
  items: readonly T[],
  before: readonly T[],
  matches: (item: T) => boolean,
  key: (item: T) => string,
): T[] {
  const index = before.findIndex(matches);
  if (index < 0) return items.filter((item) => !matches(item));
  if (items.some(matches)) return [...items];
  const restored = [...items];
  const keys = restored.map(key);
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const at = keys.indexOf(key(before[previous]));
    if (at >= 0) {
      restored.splice(at + 1, 0, before[index]);
      return restored;
    }
  }
  restored.unshift(before[index]);
  return restored;
}
