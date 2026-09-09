/**
 * Where a content day lives, said in a URL.
 *
 * Day ids are stable within an owner — day 7 of every pack is `…-d7` — so a
 * bare `/content/…` link is ambiguous the moment somebody owns two packs. In
 * the app that ambiguity is invisible, because the pack the owner is reading is
 * already in memory; on a fresh load of a pasted or bookmarked link there is
 * nothing to fall back on but the newest pack, which is the wrong month.
 *
 * So the pack travels with the link. `ActivePackSync` reads it back, and
 * `selectPack` ignores an id that is not in the owner's own list — a hand-typed
 * one selects nothing, and the security rules would refuse it anyway.
 */
export function contentHref(itemId: string, packId?: string | null): string {
  const path = `/content/${itemId}`;
  return packId ? `${path}?packId=${encodeURIComponent(packId)}` : path;
}

/** The pack workspace, opened on a particular pack. */
export function packHref(packId: string): string {
  return `/pack?packId=${encodeURIComponent(packId)}`;
}
