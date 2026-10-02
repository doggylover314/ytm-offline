/**
 * Self-check for undoing a failed library edit. Runs through `pnpm run check`.
 *
 * The case that matters: other changes made while the failed edit was in flight must survive
 * its undo. Restoring the whole library from before the edit lost them.
 */
/* Hand-rolled rather than node:assert, so this file needs no Node type declarations and the
   app's `tsc --noEmit` keeps passing over it. */
export {};

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`FAILED: ${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const { restoreEntry } = await import("./libraryRevert");
const is = (id: string) => (item: string) => item === id;
const self = (item: string) => item;

// A failed like: the song comes back out, and a like that landed meanwhile stays.
deepEqual(restoreEntry(["b", "a", "x"], ["x"], is("a"), self), ["b", "x"], "failed like");

// A failed unlike: the song goes back where it was, among what is there now.
deepEqual(restoreEntry(["x", "z"], ["x", "a", "z"], is("a"), self), ["x", "a", "z"], "failed unlike");
deepEqual(restoreEntry(["new", "x", "z"], ["x", "a", "z"], is("a"), self), ["new", "x", "a", "z"], "failed unlike after an addition");

// Its neighbour before it may be gone: the next one back is used, then the top of the list.
deepEqual(restoreEntry(["x"], ["x", "y", "z", "a"], is("a"), self), ["x", "a"], "neighbours removed");
deepEqual(restoreEntry(["q", "r"], ["x", "a"], is("a"), self), ["a", "q", "r"], "no neighbour left");
deepEqual(restoreEntry(["x", "y"], ["a", "x", "y"], is("a"), self), ["a", "x", "y"], "it was first");

// Neighbours that moved: it follows its old neighbour.
deepEqual(restoreEntry(["z", "x"], ["x", "a", "z"], is("a"), self), ["z", "x", "a"], "neighbour moved");

// Already back (a refresh brought it): the current copy is kept, not duplicated.
deepEqual(restoreEntry(["a", "x"], ["x", "a"], is("a"), self), ["a", "x"], "already back");

// Nothing to undo leaves the list as it is.
deepEqual(restoreEntry(["x", "y"], ["x", "y"], is("q"), self), ["x", "y"], "nothing to undo");

// Neighbours are found by key, not identity: a refresh replaces them with copies. The old copy
// of the entry itself is what goes back.
const before = [{ id: "b", title: "B" }, { id: "a", title: "Old" }];
deepEqual(
  restoreEntry([{ id: "b", title: "B2" }], before, (item) => item.id === "a", (item) => item.id),
  [{ id: "b", title: "B2" }, { id: "a", title: "Old" }],
  "objects",
);

console.log("libraryRevert checks passed");
