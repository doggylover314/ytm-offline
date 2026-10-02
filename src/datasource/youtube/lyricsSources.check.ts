/**
 * Self-check for lyric source ranking. No test runner in this project, so:
 *
 *   npx esbuild src/datasource/youtube/lyricsSources.check.ts --bundle --platform=node
 *     --format=esm --outfile=check.mjs && node check.mjs
 *
 * The sources are raced in parallel, so without an explicit rank the winner is whichever
 * host answered first — which is exactly backwards: the slow exact-duration match is the one
 * worth waiting for. This pins that the table, not the network, decides.
 */
export {};

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const {
  LYRICS_SOURCES,
  pickBestLyrics,
  isIncompleteLookup,
  planLyricsWaves,
  rankOfSource,
  skippedAttempt,
  sortAttempts,
  unmetPrecondition,
} = await import("./lyricsSources");

const byId = (id: string) => {
  const source = LYRICS_SOURCES.find((entry) => entry.id === id);
  if (!source) throw new Error(`FAILED: no source called ${id}`);
  return source;
};

const synced = (count: number) => ({
  lines: Array.from({ length: count }, (_, i) => ({ text: `line ${i}`, startTimeSec: i })),
  timing: "synced" as const,
});

equal(LYRICS_SOURCES.length, 4, "every source is in the table");
check(
  rankOfSource("lrclib-exact") < rankOfSource("lrclib-search"),
  "a duration-exact match outranks a text search of the same corpus",
);
check(
  rankOfSource("lrclib-search") < rankOfSource("youtube-transcript"),
  "real lyrics outrank machine transcription",
);
check(
  rankOfSource("youtube-transcript") < rankOfSource("youtube-music"),
  "timed transcription outranks untimed official words, because this screen follows along",
);
check(
  rankOfSource("nonsense") > rankOfSource("youtube-music"),
  "an unknown source sorts to the end, never to the front",
);

// The whole point: passed in fastest-first, the table still picks the better source.
const raced = [
  { source: byId("lrclib-search"), lyrics: synced(20) },
  { source: byId("youtube-transcript"), lyrics: synced(30) },
  { source: byId("lrclib-exact"), lyrics: synced(25) },
];
equal(pickBestLyrics(raced)?.source.id, "lrclib-exact", "rank wins over arrival order");

equal(
  pickBestLyrics([
    { source: byId("lrclib-exact"), lyrics: null },
    { source: byId("lrclib-search"), lyrics: synced(12) },
  ])?.source.id,
  "lrclib-search",
  "a miss falls through to the next source down",
);

equal(
  pickBestLyrics([
    { source: byId("lrclib-exact"), lyrics: { lines: [], timing: "synced" } },
    { source: byId("lrclib-search"), lyrics: synced(4) },
  ])?.source.id,
  "lrclib-search",
  "an empty line list is a miss, not a hit",
);

equal(
  pickBestLyrics([{ source: byId("lrclib-exact"), lyrics: null }]),
  undefined,
  "nothing at all is undefined, not a crash",
);
equal(pickBestLyrics([]), undefined, "and so is an empty race");

equal(skippedAttempt(byId("youtube-music")).status, "skipped", "a source never run is skipped");
equal(skippedAttempt(byId("youtube-music")).durationMs, 0, "and cost no time");

const shuffled = sortAttempts([
  skippedAttempt(byId("youtube-music")),
  skippedAttempt(byId("lrclib-exact")),
  skippedAttempt(byId("lrclib-search")),
]);
equal(shuffled[0].id, "lrclib-exact", "attempts are listed in priority order, whatever order they finished in");
equal(shuffled[2].id, "youtube-music", "down to the last resort");

/* Preferred source: promoted, but never the only one that runs. */

equal(rankOfSource("youtube-music", "youtube-music"), -1, "a preferred source outranks the table");
check(
  rankOfSource("youtube-music", "youtube-music") < rankOfSource("lrclib-exact", "youtube-music"),
  "even ahead of the source that would otherwise be first",
);
equal(
  rankOfSource("lrclib-exact", "gone-source"),
  rankOfSource("lrclib-exact"),
  "a preference for a source that no longer exists changes nothing",
);

equal(
  pickBestLyrics(
    [
      { source: byId("lrclib-exact"), lyrics: synced(30) },
      { source: byId("youtube-music"), lyrics: { lines: [{ text: "a" }], timing: "none" as const } },
    ],
    "youtube-music",
  )?.source.id,
  "youtube-music",
  "the preferred source wins when it has anything at all",
);
equal(
  pickBestLyrics(
    [
      { source: byId("lrclib-exact"), lyrics: synced(30) },
      { source: byId("youtube-music"), lyrics: null },
    ],
    "youtube-music",
  )?.source.id,
  "lrclib-exact",
  "but a preference is not a restriction: an empty favourite falls through",
);

const defaultWaves = planLyricsWaves();
equal(defaultWaves.length, 2, "by default the expensive sources are held back to a second wave");
equal(defaultWaves[0].length, 2, "the two cheap sources race first");
check(
  defaultWaves[1].every((source) => source.wave === 2),
  "and only wave two sources are held back",
);

const promotedWaves = planLyricsWaves("youtube-music");
check(
  promotedWaves[0].some((source) => source.id === "youtube-music"),
  "a preferred wave-two source joins the first round rather than waiting behind the others",
);
check(
  promotedWaves[0].every((source) => source.id !== "youtube-transcript"),
  "without dragging the other expensive source along with it",
);
equal(
  promotedWaves.flat().length,
  LYRICS_SOURCES.length,
  "every source still appears exactly once across the plan",
);
equal(
  planLyricsWaves("lrclib-exact")[0].length,
  2,
  "preferring a source already in wave one does not duplicate it",
);

equal(
  sortAttempts(
    [skippedAttempt(byId("lrclib-exact")), skippedAttempt(byId("youtube-music"))],
    "youtube-music",
  )[0].id,
  "youtube-music",
  "the status list leads with the source the listener chose",
);

/* Preconditions: an unanswerable source must say so, not report a miss it never looked for. */

equal(
  unmetPrecondition(byId("lrclib-exact"), { durationSec: 210 }),
  null,
  "a track with a duration can be matched",
);
equal(
  unmetPrecondition(byId("youtube-music"), {}),
  null,
  "sources that do not match on length are unaffected",
);
check(
  unmetPrecondition(byId("lrclib-exact"), {}) !== null,
  "LRCLIB cannot be asked about a track with no duration",
);
check(
  unmetPrecondition(byId("lrclib-search"), { durationSec: 0 }) !== null,
  "a zero duration is no duration, not a zero-length song",
);
equal(
  skippedAttempt(byId("lrclib-exact"), unmetPrecondition(byId("lrclib-exact"), {}) ?? "").detail,
  "Needs a track duration to match on",
  "and the reason reaches the status list instead of a bare 'No match'",
);


/* Incomplete lookups: worth asking again only when a better source failed to answer. */

const attempt = (id: string, status: "hit" | "miss" | "error" | "timeout") => ({ ...skippedAttempt(byId(id)), status });
check(
  isIncompleteLookup([attempt("lrclib-exact", "error"), attempt("youtube-music", "hit")], "youtube-music"),
  "LRCLIB busy while plain words won: ask again later",
);
check(
  !isIncompleteLookup(
    [attempt("lrclib-exact", "miss"), attempt("lrclib-search", "miss"), attempt("youtube-music", "hit")],
    "youtube-music",
  ),
  "every better source said no: settled",
);
check(
  !isIncompleteLookup([attempt("lrclib-exact", "hit"), attempt("youtube-transcript", "error")], "lrclib-exact"),
  "a failure below the winner changes nothing",
);
check(isIncompleteLookup([attempt("lrclib-search", "timeout")], undefined), "nothing found while a source timed out");

console.log("lyricsSources self-check passed");
