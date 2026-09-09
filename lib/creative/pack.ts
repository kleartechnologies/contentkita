import type { AssetRef, ContentItem, RestaurantProfile } from "../content/types.ts";
import { composeCreative, templateFor } from "./compose.ts";
import type { Creative } from "./types.ts";

/**
 * A month of content becoming a month of finished designs.
 *
 * ## What this file is for
 *
 * Phase A made one content day into one poster, on demand, when the owner
 * opened that day. Thirty days of that is thirty visits, and an owner who has
 * to open Day 01, wait, open Day 02, wait — thirty times — has not been handed
 * a month of content, they have been handed a month of homework.
 *
 * So this is the part that turns a plan into a pack. It is deliberately thin:
 * every design still comes out of `composeCreative`, which is the same
 * composer the studio uses, so there is exactly one creative architecture and
 * a poster generated here is byte-identical to the one the studio would have
 * shown for that day.
 *
 * ## What it costs
 *
 * Nothing. Not "nearly nothing" — nothing. There is no model call anywhere in
 * this file or anything it imports, and `pack.test.ts` proves it by running a
 * whole thirty-day generation with `fetch` replaced by a stub that throws. The
 * words were written and validated during content generation; composition
 * selects and arranges them. Thirty designs cost thirty small Firestore
 * writes and some arithmetic.
 *
 * ## What it never does
 *
 * It never overwrites a design the owner already has. Every function here that
 * decides what to generate starts from what is already saved and works out the
 * difference, which is what makes running it twice produce thirty creatives
 * rather than sixty — and what makes a retry after a partial failure safe.
 */

/* --------------------------------- status --------------------------------- */

/**
 * How far along a pack is.
 *
 * `partial` is the important one. A run that saved twenty-eight of thirty is
 * not a failure — the owner has twenty-eight usable posters — but it is not
 * ready either, and calling it ready would mean they find the two gaps
 * themselves, probably on the day they wanted to post one of them.
 */
export type PackStatus =
  | "not_started"
  | "generating"
  | "ready"
  | "partial"
  | "failed";

export interface PackProgress {
  /** Days in the plan. */
  total: number;
  /** Days with a design saved. */
  ready: number;
  /** Days whose last attempt failed. */
  failed: number;
  /** True while a run is in flight. */
  running: boolean;
}

export function packStatus(p: PackProgress): PackStatus {
  if (p.running) return "generating";
  if (p.total <= 0) return "not_started";
  // Ready is the only state that may claim the pack is finished, and it needs
  // every day persisted — not every day attempted.
  if (p.ready >= p.total) return "ready";
  if (p.ready === 0) return p.failed > 0 ? "failed" : "not_started";
  return "partial";
}

/** The default label for a pack, e.g. "30 Hari Content — Tenders Maju". */
export function defaultPackName(profile: RestaurantProfile, days: number): string {
  const name = profile.name.trim();
  return name ? `${days} Hari Content — ${name}` : `${days} Hari Content`;
}

/* --------------------------------- photos --------------------------------- */

/**
 * Every photograph the owner has actually put into a design, once each.
 *
 * This is the whole supply of restaurant-specific imagery in the product, and
 * that is the point: there is no stock library to fall back on. A poster gets
 * a picture of this restaurant's food or it gets an empty slot, because the
 * third option — somebody else's nasi lemak presented as theirs — is the same
 * kind of lie as an invented price.
 *
 * Logos are excluded on purpose. A logo is a mark, not a photograph, and
 * stretched across a poster it is neither.
 *
 * Ordered oldest first so the assignment below is stable: adding a photo
 * changes which days are new, not which days already had one.
 */
export function photoPool(creatives: readonly Creative[]): AssetRef[] {
  const seen = new Map<string, AssetRef>();
  for (const creative of creatives) {
    for (const el of creative.elements) {
      if (el.kind !== "image" || !el.source) continue;
      if (!seen.has(el.source.path)) seen.set(el.source.path, el.source);
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.path.localeCompare(b.path),
  );
}

/**
 * Which photograph each day should be built around, keyed by item id.
 *
 * Days whose layout has no photo slot — WhatsApp Status is text by nature —
 * are absent from the map rather than mapped to null, so a caller cannot
 * accidentally hand one a picture it has nowhere to put.
 *
 * With several photos the eligible days take them in turn, so a month is not
 * the same picture thirty times when it does not have to be. With one photo
 * every eligible day gets that one; repeating the owner's own food photograph
 * is a normal thing for a restaurant's feed to do, and the alternative is
 * twenty-nine empty slots.
 */
export function assignPhotos(
  items: readonly ContentItem[],
  pool: readonly AssetRef[],
): Map<string, AssetRef> {
  const out = new Map<string, AssetRef>();
  if (pool.length === 0) return out;

  let n = 0;
  for (const item of items) {
    // Asked rather than assumed: the composer decides which layout a day gets,
    // and this stays in step with it by consulting the same function.
    if (templateFor(item, pool[0]) !== "photo-band") continue;
    out.set(item.id, pool[n % pool.length]);
    n += 1;
  }
  return out;
}

/* -------------------------------- what to do ------------------------------- */

/** The days of the plan that have no design saved yet, in day order. */
export function missingItems(
  items: readonly ContentItem[],
  saved: readonly Creative[],
): ContentItem[] {
  const have = new Set(saved.map((creative) => creative.itemId));
  return items.filter((item) => !have.has(item.id)).sort((a, b) => a.day - b.day);
}

/**
 * Composes the design for one day of a pack.
 *
 * Split out so the runner below can be tested with a composer that fails, and
 * so there is one place that decides what a pack day is made of.
 */
export function composePackDay(
  profile: RestaurantProfile,
  planId: string,
  item: ContentItem,
  photos: ReadonlyMap<string, AssetRef>,
  now?: string,
): Creative {
  return composeCreative(profile, planId, item, {
    image: photos.get(item.id) ?? null,
    now,
  });
}

/* --------------------------------- the run -------------------------------- */

export interface PackFailure {
  itemId: string;
  day: number;
  message: string;
}

export interface PackRunResult {
  saved: Creative[];
  failures: PackFailure[];
}

export interface PackRunOptions {
  /**
   * How many days are written at once.
   *
   * Small on purpose. Thirty simultaneous writes from a phone on a Malaysian
   * mobile connection is how a run half-finishes; a handful in flight keeps
   * the connection busy without queueing thirty requests behind each other.
   */
  concurrency?: number;
  /** Called as each day lands, so the screen can count up rather than spin. */
  onSaved?: (creative: Creative) => void;
  onFailed?: (failure: PackFailure) => void;
  signal?: AbortSignal;
}

/**
 * Composes and persists a list of days, a few at a time.
 *
 * `build` and `persist` are passed in rather than imported: it keeps this
 * runner testable without Firebase, and it keeps the decision about *what* a
 * day contains out of the loop that writes it.
 *
 * A day that fails does not stop the run. Twenty-nine posters and one gap is a
 * better outcome for the owner than nine posters and an error, and the gap is
 * reported so it can be retried on its own.
 */
export async function runPack(
  targets: readonly ContentItem[],
  build: (item: ContentItem) => Creative,
  persist: (creative: Creative) => Promise<void>,
  options: PackRunOptions = {},
): Promise<PackRunResult> {
  const saved: Creative[] = [];
  const failures: PackFailure[] = [];
  const width = Math.max(1, Math.min(options.concurrency ?? 4, 8));

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      if (options.signal?.aborted) return;
      const index = next;
      next += 1;
      if (index >= targets.length) return;

      const item = targets[index];
      try {
        const creative = build(item);
        await persist(creative);
        saved.push(creative);
        options.onSaved?.(creative);
      } catch (err) {
        const failure: PackFailure = {
          itemId: item.id,
          day: item.day,
          message: err instanceof Error ? err.message : String(err),
        };
        failures.push(failure);
        options.onFailed?.(failure);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(width, targets.length) }, () => worker()),
  );

  saved.sort((a, b) => a.day - b.day);
  failures.sort((a, b) => a.day - b.day);
  return { saved, failures };
}

/* --------------------------------- photos in ------------------------------- */

/**
 * The days that could show a photograph and currently show an empty slot.
 *
 * Used by the one explicit "put my photos on the rest of the month" action.
 * Designs the owner has edited are left alone: they have already made a
 * decision about that poster, and quietly changing it afterwards is the sort
 * of help nobody asked for.
 */
export function daysNeedingPhotos(saved: readonly Creative[]): Creative[] {
  return saved
    .filter((creative) => {
      if (creative.edited) return false;
      const slot = creative.elements.find((el) => el.kind === "image");
      return Boolean(slot) && !slot?.source;
    })
    .sort((a, b) => a.day - b.day);
}
