import type { AssetRef, ContentItem, RestaurantProfile } from "../content/types.ts";
import {
  composeCreative,
  contentFingerprint,
  dishInText,
  photoNamesDish,
  photoWordsInText,
  subjectTiers,
} from "./compose.ts";
import { isGraphic } from "./direction.ts";
import { familyFor, photosWanted } from "./families.ts";
import { signatureOf } from "./photo.ts";
import { isImage, type Creative } from "./types.ts";

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
 *
 * Two sources, because photographs arrive two ways. `uploaded` is the set the
 * owner gave us in their profile, which is what a first pack is built from.
 * The creatives are read as well so a picture that only ever reached a poster —
 * dropped into one design in the studio — is still available to the rest of the
 * month.
 */
export function photoPool(
  creatives: readonly Creative[],
  uploaded: readonly AssetRef[] = [],
): AssetRef[] {
  const seen = new Map<string, AssetRef>();
  for (const ref of uploaded) {
    if (ref && !seen.has(ref.path)) seen.set(ref.path, ref);
  }
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

/** Lexicographic: the first difference decides. See `assignPhotos`. */
function cheaper(a: readonly number[], b: readonly number[]): boolean {
  for (const [i, value] of a.entries()) {
    if (value !== b[i]) return value < b[i];
  }
  return false;
}

/**
 * Which photographs each day should be built around, keyed by item id.
 *
 * Days whose layout has no photo slot — WhatsApp Status is text by nature, and
 * so are the typographic families — are absent from the map rather than mapped
 * to an empty list, so a caller cannot accidentally hand one a picture it has
 * nowhere to put.
 *
 * ## The dish comes first
 *
 * A poster that prints NASI LEMAK AYAM BEREMPAH across a photograph of teh
 * tarik is not a design problem, it is a wrong post — the owner will not
 * publish it, and if they do, a customer orders something that is not in the
 * picture. So before anything is dealt out, each day is asked what it is about
 * (the same `dishInPost` the poster's own label uses) and, when the owner has
 * a photograph whose filename names that dish, that is the picture it gets.
 *
 * This is the owner's knowledge, not ours. The match is against the filename
 * they typed, so nothing is inspected or guessed at; a library of `IMG_4821`
 * matches nothing and the month falls through to the rotation below exactly as
 * it did before. Where several of their photographs name the same dish they
 * take turns, so a month about one best seller is still a month of different
 * pictures. A day whose copy names a photograph the menu never mentions — the
 * sambal, the teh tarik — claims it the same way, by its filename.
 *
 * ## Everything else is dealt in turn
 *
 * The remaining days — and the remaining slots of a collage — take photographs
 * in turn, so a month is not the same picture thirty times when it does not
 * have to be. With one photo every eligible day gets that one; repeating the
 * owner's own food photograph is a normal thing for a restaurant's feed to do,
 * and the alternative is twenty-nine empty slots. What stops the repetition
 * showing is `focalFor`, which frames the same picture differently on each day
 * it appears.
 *
 * A collage asks for three and is given three, even when the pool holds one —
 * three crops of one photograph is a design, not a failure.
 */
export function assignPhotos(
  items: readonly ContentItem[],
  pool: readonly AssetRef[],
  bestSellers: readonly string[] = [],
): Map<string, AssetRef[]> {
  const out = new Map<string, AssetRef[]>();
  if (pool.length === 0) return out;

  // Counted per dish rather than globally: two days about the nasi lemak
  // should alternate between the two nasi lemak photographs, and neither
  // should be pushed along by a day about something else entirely.
  const turns = new Map<string, number>();
  //
  // Tier by tier, and within a tier the dish first. The menu is four lines
  // long and the month is thirty days: a day about the sambal, or about the
  // ayam berempah that is a *part* of the best seller's name rather than the
  // whole of it, names no dish at all — and yet the owner already wrote what
  // the picture is of on the picture. See `photoWordsInPost`.
  //
  // The dish leads inside a tier because the poster's printed label comes from
  // it and the two must agree. But a dish found in the caption's third
  // sentence does not outrank a photograph the hook names outright: day 10 of
  // the M6.5 acceptance pack opened "Sambal ikan bilis ni tak dibuat main."
  // and was handed the nasi lemak, because "nasi lemak" appeared further down
  // the same paragraph and the whole dish search ran before the filenames were
  // ever consulted.
  const matchFor = (item: ContentItem): AssetRef | null => {
    for (const tier of subjectTiers(item)) {
      const dish = dishInText(tier, bestSellers);
      if (dish) {
        const named = pool.filter((ref) => photoNamesDish(ref.name, dish));
        if (named.length > 0) {
          const turn = turns.get(dish) ?? 0;
          turns.set(dish, turn + 1);
          return named[turn % named.length];
        }
      }

      let claim: { ref: AssetRef; words: number } | null = null;
      for (const ref of pool) {
        const words = photoWordsInText(ref.name, tier);
        if (words > (claim?.words ?? 0)) claim = { ref, words };
      }
      if (claim) return claim.ref;
    }
    return null;
  };

  // The lead picture each family last took. The wheel gives a family two days a
  // month; if both are the same plate in the same layout, an owner scrolling
  // their own grid sees one page posted twice however the crop moved. The slip
  // below was supposed to prevent that and mostly does — but days 5 and 20 of
  // the M6.5 acceptance pack were both the editorial column on the same
  // photograph, so "mostly" is not the same as "does".
  const led = new Map<string, AssetRef>();

  // Whether the pool holds anything that is actually a photograph.
  //
  // A flat graphic is not a plate. Dealt a turn in the queue like one, the
  // single drawn glass of teh tarik in the acceptance pool came back on three
  // of thirty posts — twice in the same layout, four days apart, in the same
  // place on the page — for a nasi lemak shop whose copy on two of those days
  // was about the size of the room and the smell of sambal. That is not a
  // motif, it is filler.
  //
  // So the rotation deals photographs. The drawing is still placed, by the one
  // route that has a reason to place it: `matchFor`, the moment the copy talks
  // about what it draws. On the acceptance pack that is day 20, whose caption
  // is about cups of teh tarik on the front table — which is the difference
  // between a decision and a queue. A restaurant that uploaded nothing but
  // drawings still gets them; `photograph` is what makes that case fall
  // through rather than loop.
  const photograph = pool.some((ref) => !isGraphic(signatureOf(ref)));

  // What each day's own copy claims, decided before anything is dealt.
  //
  // Two passes rather than one, because the rotation has to be able to see
  // forwards. Day 16 of the acceptance pack was handed the roti canai by the
  // rotation; day 17 named the roti canai in its own caption and took it by
  // right. Neither rule was broken and the grid still showed the same
  // photograph twice in a row, which is the repeat an owner spots first,
  // because in a feed the two posts are touching.
  //
  // Asked rather than assumed: the composer decides which layout a day gets,
  // and this stays in step with it by consulting the same function. A day
  // whose family wants no picture claims none — and, as before, does not
  // consume a turn of `matchFor`'s per-dish rotation either.
  const wants = items.map((item) => photosWanted(item, true));
  const claims = items.map((item, i) => (wants[i] > 0 ? matchFor(item) : null));

  // How many days each picture has already carried, counted as the month is
  // dealt. A cursor alone spreads nothing: it only visits the pool in turn,
  // and every day that claimed a photograph by name, and every turn a guard
  // sent it past, pulls it out of step. On the M6.5 acceptance pack that came
  // to nine days of nasi lemak and two of the sambal out of the same library
  // of five — a month that looks like a shop with one photograph and a lot of
  // captions.
  const uses = new Map<string, number>();
  const take = (ref: AssetRef): void => {
    uses.set(ref.path, (uses.get(ref.path) ?? 0) + 1);
  };

  let n = 0;
  for (const [i, item] of items.entries()) {
    const wanted = wants[i];
    if (wanted === 0) continue;
    const family = familyFor(item, true);

    const picks: AssetRef[] = [];
    const named = claims[i];
    if (named) {
      picks.push(named);
      take(named);
    }

    // Yesterday's lead, and the picture tomorrow has already claimed.
    const before = i > 0 ? out.get(items[i - 1].id)?.[0] : undefined;
    const after = claims[i + 1] ?? undefined;

    while (picks.length < wanted) {
      // Dealt in turn, but the turn slips by one each time the pool comes
      // round. Straight round-robin has the period of the pool, and the family
      // wheel has a period of its own; where the two line up the same layout
      // gets the same plate twice in a month, which is the one repeat an owner
      // notices. The slip makes the two periods disagree.
      const cursor = (n + Math.floor(n / pool.length)) % pool.length;
      const lead = picks.length === 0;

      // Everything the deal would rather not do, worst first, and then the
      // turn. Ranked rather than enforced: a shop with one photograph and a
      // collage to fill breaks every one of these rules and still has to be
      // given three frames, so the questions are asked in the order they
      // matter and the least bad answer wins. Nothing here can fail to
      // choose.
      const cost = (ref: AssetRef, at: number): number[] => [
        // See `photograph`: a drawing is placed because the copy asked for
        // it, not because its turn came round.
        photograph && isGraphic(signatureOf(ref)) ? 1 : 0,
        // A collage of the same photograph twice reads as a mistake rather
        // than a composition.
        picks.includes(ref) ? 1 : 0,
        // A day does not lead on what the day either side of it leads on: in
        // a feed those two posts are touching. See `claims`.
        lead && (ref === before || ref === after) ? 1 : 0,
        // And a family does not lead on the plate it led on last time, or an
        // owner scrolling their own grid sees one page posted twice however
        // the crop moved.
        lead && led.get(family) === ref ? 1 : 0,
        // Then the library, evenly.
        uses.get(ref.path) ?? 0,
        (at - cursor + pool.length) % pool.length,
      ];

      let best = pool[cursor];
      let score = cost(best, cursor);
      for (const [at, ref] of pool.entries()) {
        const theirs = cost(ref, at);
        if (cheaper(theirs, score)) {
          best = ref;
          score = theirs;
        }
      }
      picks.push(best);
      take(best);
      n += 1;
    }
    if (picks.length > 0) led.set(family, picks[0]);
    out.set(item.id, picks);
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
  photos: ReadonlyMap<string, AssetRef[]>,
  now?: string,
): Creative {
  return composeCreative(profile, planId, item, {
    images: photos.get(item.id) ?? [],
    now,
  });
}

/* --------------------------------- stale ---------------------------------- */

/**
 * True when a design is showing words its day no longer has.
 *
 * Rewriting a day — "Jana semula", or editing the caption — replaces the copy
 * and stops there, because the words and the design are two documents. Left
 * alone that produces the one failure an owner cannot be asked to police
 * themselves: a poster whose headline is from the version before last, sitting
 * next to the caption that replaced it.
 *
 * Two designs are never called stale. One the owner has edited, because they
 * have already decided what that poster says and a rewrite elsewhere is not
 * permission to undo it. And one saved before designs recorded their source,
 * which has no digest to compare and is therefore left exactly as it is.
 */
export function isStale(creative: Creative, item: ContentItem): boolean {
  if (creative.edited) return false;
  if (!creative.source) return false;
  return creative.source !== contentFingerprint(item);
}

/** The saved designs whose words have moved on, in day order. */
export function staleCreatives(
  items: readonly ContentItem[],
  saved: readonly Creative[],
): Creative[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return saved
    .filter((creative) => {
      const item = byId.get(creative.itemId);
      return item ? isStale(creative, item) : false;
    })
    .sort((a, b) => a.day - b.day);
}

/** The photographs a saved design is built around, in slot order. */
export function creativePhotos(creative: Creative): AssetRef[] {
  return creative.elements
    .filter(isImage)
    .map((el) => el.source)
    .filter((ref): ref is AssetRef => ref !== null);
}

/**
 * Rebuilds one day's design around its current copy.
 *
 * The pictures come from the poster being replaced rather than from a fresh
 * assignment, so rewriting the words of day seven changes day seven's words
 * and nothing else — not which plate it is showing, and not any other day.
 * The owner's filename survives for the same reason: renaming a design is not
 * a decision about the copy.
 */
export function recomposeDay(
  profile: RestaurantProfile,
  item: ContentItem,
  previous: Creative,
  now?: string,
): Creative {
  return {
    ...composeCreative(profile, previous.planId, item, {
      images: creativePhotos(previous),
      now,
    }),
    name: previous.name,
    createdAt: previous.createdAt,
  };
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
 * The days that should be showing a photograph and are not.
 *
 * Used by the one explicit "put my photos on the rest of the month" action,
 * for the owner who generated a pack before uploading anything. Two ways a day
 * lands here, and they need different repairs:
 *
 *   - It has an image slot standing empty — a collage with two of its three
 *     frames filled is still a poster with a hole in it.
 *   - It has no image slot at all, because when it was composed the restaurant
 *     had no photographs and the day was given a typographic layout. Dropping a
 *     picture into that poster is impossible; it wants recomposing, which is
 *     what the caller does.
 *
 * Designs the owner has edited are left alone: they have already made a
 * decision about that poster, and quietly changing it afterwards is the sort
 * of help nobody asked for. So are days no photograph was dealt to — a
 * WhatsApp Status is text by nature and is not missing anything.
 */
export function daysNeedingPhotos(
  saved: readonly Creative[],
  assigned: ReadonlyMap<string, AssetRef[]>,
): Creative[] {
  return saved
    .filter((creative) => {
      if (creative.edited) return false;
      if ((assigned.get(creative.itemId) ?? []).length === 0) return false;
      const slots = creative.elements.filter((el) => el.kind === "image");
      if (slots.length === 0) return true;
      return slots.some((el) => el.kind === "image" && !el.source);
    })
    .sort((a, b) => a.day - b.day);
}
