import type { ContentItem } from "../content/types.ts";
import { DEFAULT_FOCAL, type Focal, type TemplateId } from "./types.ts";

/**
 * Which *kind of poster* each day of the month is.
 *
 * The failure this file exists to fix: a month where every post is the same
 * poster with a different photograph and a different sentence. Changing the
 * colours does not fix it, and neither does adding a fourth layout — an owner
 * scrolling their own grid reads thirty variations on one idea long before
 * they read any of the words.
 *
 * So a day is assigned a *family* rather than a template: a hero shot, a
 * magazine spread, a wall of type, a close-up, a split field, a collage, a menu
 * card, a question. Families differ in what carries the page and where the eye
 * lands first, which is the difference a feed actually shows. Within a family
 * the treatment picks between compositions, so the two hero days in a fortnight
 * are not the same hero day twice.
 *
 * Three properties this has to keep:
 *
 *   - **Deterministic.** The family is a function of the day number. A creative
 *     composed twice is the same creative, which is what lets the studio's
 *     "Kembali ke asal" hand back the design the owner started from.
 *   - **Spread.** Neighbouring days never share a family, and over thirty days
 *     every family appears. That is arithmetic below, not a search.
 *   - **Honest about photographs.** A restaurant with no pictures is given the
 *     typographic families rather than thirty empty slots, and never a stock
 *     photograph of somebody else's food.
 */

/* -------------------------------- the wheel ------------------------------- */

/**
 * The rotation, in order.
 *
 * Fifteen entries for thirty days, so each entry is used exactly twice a month.
 * Photo-led families appear more than once in the list because the product is
 * image-first: twenty-four of thirty days are built on the owner's own
 * photographs and six are typographic, which is roughly the mix a restaurant
 * page that people actually follow tends to have.
 */
const WHEEL: readonly TemplateId[] = [
  "photo-band", // hero: the plate, full bleed
  "editorial", // magazine: picture and headline share the page
  "bold-type", // a wall of type, no photograph
  "closeup", // cropped into the food
  "split", // half picture, half colour field
  "photo-band",
  "menu-card", // one dish, named, on a card
  "collage", // three frames
  "minimal", // one small picture, a lot of air
  "type-poster", // storytelling: words above, picture below
  "question", // a question, set large
  "split",
  "local", // the town, the neighbourhood, the regulars
  "editorial",
  "text-first", // a brand statement on a colour field
] as const;

/**
 * Step four places each day.
 *
 * Four and fifteen share no factor, so the walk visits all fifteen entries
 * before repeating and consecutive days land four apart — far enough that no
 * two neighbours are the same family, including across the fifteen-day seam.
 * `families.test.ts` asserts both rather than trusting the arithmetic here.
 */
const STRIDE = 4;

/**
 * What a restaurant with no photographs gets.
 *
 * Not a punishment and not a smaller product: these are real layouts that do
 * not want a picture in the first place. A poster with an empty grey rectangle
 * where the food should be is worse than a poster that was never going to have
 * food on it, and a stock photograph is not an option — see `photoPool`.
 */
const TYPE_ONLY: readonly TemplateId[] = [
  "bold-type",
  "question",
  "text-first",
] as const;

/**
 * How many frames each family composes with. One unless stated here.
 *
 * The three at zero are the typographic families — they have no image slot at
 * all, which is why they are also the fallback for a restaurant that has not
 * uploaded anything.
 */
const SLOTS: Partial<Record<TemplateId, number>> = {
  collage: 3,
  "bold-type": 0,
  question: 0,
  "text-first": 0,
};

function dayIndex(item: ContentItem): number {
  return Math.max(Math.trunc(item.day), 1) - 1;
}

/**
 * The family this day's poster belongs to.
 *
 * Three things override the wheel, in order:
 *
 *   1. WhatsApp Status is glanced at on a phone held at arm's length and is one
 *      message rather than a designed page, so it is always the statement
 *      layout. This is the behaviour the product already had.
 *   2. A day the Malaysia calendar claimed is festive — it has to *look* like
 *      the occasion or the post is just a normal post with the wrong caption.
 *      Still the restaurant's palette and type, never a generic greeting card.
 *   3. Without photographs the wheel is replaced by the typographic families.
 */
export function familyFor(item: ContentItem, hasPhoto: boolean): TemplateId {
  if (item.platform === "whatsapp") return "text-first";
  const n = dayIndex(item);
  if (item.occasion && hasPhoto) return "festive";
  if (!hasPhoto) return TYPE_ONLY[n % TYPE_ONLY.length];
  return WHEEL[(n * STRIDE) % WHEEL.length];
}

/**
 * How many photographs to hand this day.
 *
 * Asked by the pack builder before it hands anything out, so a day is never
 * given a picture it has nowhere to put and never left one short of what its
 * layout needs.
 */
export function photosWanted(item: ContentItem, hasPhoto: boolean): number {
  if (!hasPhoto) return 0;
  return SLOTS[familyFor(item, true)] ?? 1;
}

/* -------------------------------- framing --------------------------------- */

/**
 * Crops, in the order they are handed out.
 *
 * The point of this table is a restaurant with three photographs. Framed the
 * same way every time, three pictures across thirty days reads as three
 * pictures across thirty days. Framed wide, then tight on the middle, then
 * cropped into the top corner, the same three pictures carry the month without
 * the owner having to shoot anything new.
 *
 * Nothing here goes past `2` — beyond that a phone photograph starts showing
 * its pixels, and a soft poster is worse than a familiar one. The vertical
 * points sit above centre because that is where food is in a plate shot taken
 * from a normal sitting height.
 */
const CROPS: readonly Focal[] = [
  { x: 0.5, y: 0.5, zoom: 1 },
  { x: 0.5, y: 0.42, zoom: 1.35 },
  { x: 0.62, y: 0.55, zoom: 1.15 },
  { x: 0.38, y: 0.45, zoom: 1.6 },
  { x: 0.5, y: 0.6, zoom: 1.25 },
  { x: 0.55, y: 0.35, zoom: 1.45 },
] as const;

/**
 * How this day frames the picture in one of its slots.
 *
 * Both the day and the slot are in the sum, so a collage's three frames are
 * three different crops even when they are three copies of the same
 * photograph — which is exactly what happens when the owner uploaded one.
 */
export function focalFor(item: ContentItem, slot = 0): Focal {
  const family = familyFor(item, true);
  if (family === "closeup") {
    // The whole family is the crop: go in, and vary where rather than whether.
    const base = CROPS[(dayIndex(item) + slot) % CROPS.length];
    return { x: base.x, y: base.y, zoom: 1.9 };
  }
  if (family === "minimal") return DEFAULT_FOCAL;
  // Five and six share no factor, so a month walks all six framings; the slot
  // is added rather than multiplied so a collage's three frames are three
  // consecutive — and therefore three different — crops.
  return CROPS[(dayIndex(item) * 5 + slot) % CROPS.length];
}

/** Every family, for tests and for the distribution report. */
export const FAMILIES: readonly TemplateId[] = [
  ...new Set<TemplateId>([...WHEEL, ...TYPE_ONLY, "festive"]),
];
