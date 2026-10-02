/** True for the Liked Songs collection, which the API identifies inconsistently. */
export function isLikedSongsId(id?: string, kind?: string): boolean {
  return kind === "liked-songs" || id === "LM";
}
