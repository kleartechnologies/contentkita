import {
  canCarryType,
  chooseCrop,
  estimateImageFocalPoint,
  graphicCrop,
  maxZoom,
  typedRegion,
  washFor,
  type Signature,
} from "./photo.ts";
import { CANVAS, type Box, type CreativeFormat, type Focal, type TemplateId } from "./types.ts";

/**
 * The art direction layer: the decisions a designer makes before drawing.
 *
 * M6 chose a layout from the day number and then drew it the same way every
 * time — the same crop table regardless of what was in the picture, the same
 * pill under sixteen of thirty posters, the same page colour, the same brand
 * line at the same weight in the same corner. That is a template set, and a
 * month of it reads as one.
 *
 * What a person does instead is look at what they have and decide. Is there
 * anywhere on this photograph a headline could go? Is this even a photograph,
 * or is it a drawing that will look like clip art blown up to full bleed? Is
 * this hook four words or eighteen — because those are not the same size of
 * type. Does this call to action fit in a button, or will it wrap inside one
 * and look like a mistake?
 *
 * Every function here answers one of those questions, and every one of them is
 * pure: a day, a format, some text, and the thirteen numbers `photo.ts` read
 * off the picture at upload. No I/O, no canvas, no clock. That is what lets
 * `composeCreative` stay synchronous and byte-deterministic — the property the
 * whole studio rests on — while still making decisions that respond to the
 * actual content rather than to `day % 2`.
 *
 * ## On the periods
 *
 * Several of these rotate through a small set. Every period is chosen coprime
 * with the fifteen-day family wheel in `families.ts`, so the two days a month
 * that share a family never share a ground, a brand treatment or a call to
 * action. A period that divides fifteen — three, five — makes the second hero
 * day an exact reprint of the first, which is the bug `treatmentFor` already
 * had once and is not worth having twice.
 */

export {
  canCarryType,
  chooseCrop,
  estimateImageFocalPoint,
  graphicCrop,
  maxZoom,
  typedRegion,
  washFor,
};

/** Day 1 becomes 0. Anything malformed becomes day 1. */
function index(day: number): number {
  return Math.max(Math.trunc(day) || 1, 1) - 1;
}

/* --------------------------------- ground --------------------------------- */

/**
 * The colour the page is.
 *
 * The single cheapest thing wrong with the M6 month: every poster was either
 * cream or the one deep green, and half of them were cream. Thirty posts
 * alternating between two grounds read as two posts. `tint` — the page with a
 * little of the brand colour mixed in — is a third, and because it is derived
 * from the same accent it cannot clash with anything.
 *
 * Deliberately not "a different colour every day". The point is a restaurant
 * with a look, not a paint chart: three grounds, all built from the one colour
 * the owner gave us, rotating on a seven-day period so no two neighbouring
 * days and no two same-family days match.
 */
export type Ground = "base" | "surface" | "tint";

const GROUNDS: readonly Ground[] = [
  "base",
  "tint",
  "surface",
  "base",
  "tint",
  "base",
  "surface",
] as const;

export function chooseGround(day: number): Ground {
  return GROUNDS[index(day) % GROUNDS.length];
}

/* ------------------------------ photo treatment ---------------------------- */

/**
 * What this picture is *for* on this page.
 *
 * - `hero` — the whole page, with type over it. Wants a photograph with a calm
 *   edge or a dark one; anything else and the wash needed to make the type
 *   readable has already thrown the photograph away.
 * - `band` — a half, a third, a strip. Type sits on the page beside or below
 *   it, so the picture never has to carry a word. The safe answer, and the
 *   right one far more often than M6 assumed.
 * - `detail` — cropped in until the subject is texture. Needs pixels and needs
 *   something to find; a flat or small picture zoomed to 1.9 is a brown smear,
 *   which is precisely what four days of the M6 month were.
 * - `framed` — inset, page colour all the way round it. Restraint.
 * - `panel` — for a drawing rather than a photograph: contained, trimmed to its
 *   own edges, laid on a tinted panel and never washed. A logo-style graphic at
 *   full bleed behind a scrim is the most obviously automated thing a poster
 *   can do.
 */
export type PhotoTreatment = "hero" | "band" | "detail" | "framed" | "panel";

/**
 * The treatment this picture can actually take, given what the family wanted.
 *
 * Only ever downgrades. A family asking for a hero shot and getting a band has
 * lost some drama; a family asking for a hero shot and getting one it cannot
 * carry has lost the poster.
 */
export function choosePhotoTreatment(
  sig: Signature | null,
  wanted: PhotoTreatment,
): PhotoTreatment {
  // A drawing is a drawing whatever the layout hoped for.
  if (sig?.kind === "graphic") return "panel";
  if (wanted === "panel") return sig ? "framed" : "panel";

  if (wanted === "hero" && !canCarryType(sig)) return "band";
  // Under 1.5 there is either not enough resolution to enlarge or not enough
  // texture to find, and "close-up" becomes "slightly bigger".
  if (wanted === "detail" && maxZoom(sig) < 1.5) return "band";
  return wanted;
}

/**
 * True when this asset should be drawn as artwork rather than as a photograph.
 *
 * The one place the rest of the composer needs to ask. `photo.ts` is
 * deliberately conservative about saying yes — mistaking a photograph for a
 * drawing is the worse error, because it puts the owner's food in a small
 * contained box on a coloured panel.
 */
export function isGraphic(sig: Signature | null): boolean {
  return sig?.kind === "graphic";
}

/* ----------------------------- composition -------------------------------- */

/**
 * Which of a family's two arrangements this day gets.
 *
 * M6 answered this with `day % 2`, which is how the same photograph ended up
 * full-bleed behind a headline on a day the photograph had nowhere for a
 * headline to go. The day number is still the tiebreak — it has to be, or the
 * month stops being varied — but it is the *last* thing consulted, after the
 * questions that have real answers.
 */
export type Arrangement = "primary" | "alternate";

export interface CompositionBrief {
  day: number;
  family: TemplateId;
  format: CreativeFormat;
  /** The hook, as it will be set. Length decides whether a column works. */
  headline: string;
  signature: Signature | null;
  /** How many photographs this day was actually dealt. */
  photos: number;
  /** The day-derived flip, used when nothing in the content decides. */
  fallback: boolean;
}

/** Roughly, a headline that will not set in three lines in a narrow column. */
const LONG_HEADLINE = 62;

export function chooseComposition(brief: CompositionBrief): Arrangement {
  const { family, signature: sig, headline, format } = brief;
  const flip: Arrangement = brief.fallback ? "alternate" : "primary";
  const long = headline.trim().length > LONG_HEADLINE;

  // A drawing sent here by `redirectForGraphic` is the same drawing every
  // time, so every content-led rule below would answer the same way on every
  // one of those days and the redirect's own wheel would be the only thing
  // moving. `editorial` is where that bites — it picks its arrangement from
  // the picture's proportions, which for one drawing never change. The day's
  // flip decides instead, and being two-day against a three-day wheel it
  // yields six different posters before the first one comes round again.
  if (isGraphic(sig) && GRAPHIC_HOMES.includes(family)) return flip;

  switch (family) {
    // Primary is the full-bleed hero. Only worth it on a picture that can hold
    // a headline; otherwise the banded arrangement, where the type is on the
    // page and the photograph is left alone to be a photograph. Asking
    // `choosePhotoTreatment` rather than restating its rule is what keeps the
    // two from drifting apart.
    case "photo-band":
    case "local":
      return choosePhotoTreatment(sig, "hero") === "hero" ? flip : "alternate";

    // Mirror image: here it is the *alternate* that goes full bleed.
    case "closeup":
    case "festive":
      return choosePhotoTreatment(sig, "hero") === "hero" ? flip : "primary";

    // The primary lays a card over a full-bleed picture behind an even wash.
    // An even wash is the most expensive kind — it costs the whole photograph,
    // not just its lower third — so it is worth it only on a picture dark
    // enough to barely need one. Everything else takes the side-by-side.
    case "menu-card":
      if (!sig) return flip;
      return sig.brightness < 0.46 ? flip : "alternate";

    // The alternate is a magazine column four-tenths of the page wide. A long
    // Malay sentence in it comes back as six lines of two words.
    case "editorial":
      if (long) return "primary";
      // A tall photograph wants the full-height right-hand column; a wide one
      // wants the band across the top. This is the picture choosing the layout,
      // which is the ordinary way round.
      if (sig && sig.height > sig.width * 1.15) return "alternate";
      if (sig && sig.width > sig.height * 1.15) return "primary";
      return flip;

    // Same reasoning: the vertical cut is a column, and a long headline needs
    // the horizontal band instead.
    case "split":
      if (long && format === "square") return "alternate";
      return flip;

    // With fewer pictures than frames the row-of-three reads as one photograph
    // printed three times; the asymmetric arrangement, where one frame is
    // twice the size of the others, reads as a considered crop set.
    case "collage":
      return brief.photos >= 3 ? flip : "primary";

    default:
      return flip;
  }
}

/* -------------------------------- headline -------------------------------- */

/**
 * How big, how tight and how leaded this particular sentence should be set.
 *
 * The M6 headline was one size with one leading — `1.08` — for every hook on
 * every poster, and `autoFit` did the rest. That is the definition of type
 * that is fitted rather than designed: a four-word hook and an eighteen-word
 * one came out the same height, one swimming in its box and the other shrunk
 * until it was quieter than the photograph next to it.
 *
 * Two things a person does instead, both of them mechanical enough to encode:
 *
 *   1. **Short copy is set large.** A four-word hook is an opportunity for a
 *      poster that is mostly one enormous sentence. A long one is set smaller
 *      and given room to breathe, because it is being read rather than seen.
 *   2. **Leading follows size.** Display type at a tenth of the page wants
 *      leading tighter than its own size — lines that lock together into a
 *      block. Body-scale type at a thirtieth wants the opposite or it sets as
 *      a brick. One number cannot do both, which is why `1.08` looked cramped
 *      at the bottom of the page and loose at the top.
 *
 * Tracking follows the same curve: large type needs to be pulled in, small
 * type left alone.
 */
export interface HeadlineTreatment {
  /** The size to set, as a fraction of canvas width. */
  size: number;
  lineHeight: number;
  /** Fraction of the font size. Callers with a tracked tone keep their own. */
  tracking: number;
}

export function chooseHeadlineTreatment(
  headline: string,
  size: number,
  measure = 1,
): HeadlineTreatment {
  const chars = headline.trim().length;

  // The scale curve. Under about five words a hook can carry the whole page;
  // over about twenty it is a paragraph and must stop pretending otherwise.
  const scale =
    chars <= 24 ? 1.42 : chars <= 40 ? 1.18 : chars <= 62 ? 1 : chars <= 90 ? 0.86 : 0.74;
  const set = fitToMeasure(size * scale, measure);

  return {
    size: set,
    lineHeight: leadingFor(set),
    tracking: trackingFor(set),
  };
}

/**
 * How wide a character is, as a fraction of the type size.
 *
 * A single number for a mixed-case serif headline, which is all this needs to
 * be: it is used to ask "roughly how many characters will fit on a line", and
 * the difference between an estimate and a measurement there is a fraction of
 * a character. Measuring properly would mean a font and a canvas, and the
 * composer has neither — it runs on the server, before anything is drawn.
 */
const CHAR_WIDTH = 0.46;

/**
 * A headline needs about this many characters on a line to look set rather
 * than stacked. Below it the rag becomes a column of single words.
 */
const MIN_MEASURE = 11;

/**
 * Bring the size down until the column can hold a readable line.
 *
 * The scale curve above asks "how much text is there"; this asks "how much
 * room is it going in". Both matter, and only asking the first is what put a
 * twenty-six character hook into a two-fifths-width editorial column at full
 * display size and set it as "Teh Ais / selalu / habis / awal." — four lines,
 * never more than two words, in a poster with a third of its page empty.
 *
 * Floored at three-fifths of the requested size rather than solved exactly: a
 * genuinely narrow column should end up with smallish type, but a headline
 * that shrinks without limit stops being the headline.
 */
export function fitToMeasure(size: number, measure: number): number {
  if (measure >= 1) return size;
  const room = measure / (CHAR_WIDTH * MIN_MEASURE);
  return Math.max(size * 0.6, Math.min(size, room));
}

/** Leading for a given size. Big type locks up, small type opens out. */
export function leadingFor(size: number): number {
  if (size >= 0.115) return 0.94;
  if (size >= 0.09) return 1;
  if (size >= 0.07) return 1.08;
  if (size >= 0.05) return 1.18;
  return 1.3;
}

/** Tracking for a given size, as a fraction of it. */
export function trackingFor(size: number): number {
  if (size >= 0.115) return -0.038;
  if (size >= 0.09) return -0.028;
  if (size >= 0.07) return -0.018;
  return -0.008;
}

/**
 * The pictures for a multi-frame family, with the drawings moved to the back.
 *
 * Slot zero is the dominant frame in every family that has more than one, so
 * whatever lands there is what the poster is about. A flat illustration
 * letterboxed into the biggest frame on the page is the §19 failure in its
 * most visible form — the restaurant's own food gets a thumbnail and a piece
 * of clip art gets the spread.
 *
 * Stable within each group, so a day dealt three photographs is dealt them in
 * the order the pool chose and nothing moves.
 */
export function orderImages<T>(
  images: readonly T[],
  signatureOf: (image: T) => Signature | null,
): T[] {
  const photographs = images.filter((image) => !isGraphic(signatureOf(image)));
  if (photographs.length === 0 || photographs.length === images.length) {
    return [...images];
  }
  return [...photographs, ...images.filter((image) => isGraphic(signatureOf(image)))];
}

/* ---------------------------------- cta ----------------------------------- */

/**
 * How the call to action is drawn.
 *
 * M6 had two — a filled pill or a plain line — and used the pill on sixteen of
 * thirty posters. A month of identical green buttons is the single loudest
 * signal that nobody arranged any of it, and it is the one an owner notices
 * without being able to say why.
 *
 * - `pill` — filled, high contrast. Still the right answer sometimes.
 * - `underline` — a rule the width of the words. Reads as typography.
 * - `plain` — just the sentence, in the soft ink. The most restrained.
 * - `none` — no call to action on the poster at all. It is still the last line
 *   of the caption the owner copies, so nothing is lost, and a poster that
 *   ends on its headline is a real design.
 */
export type CtaTreatment = "pill" | "underline" | "plain" | "none";

const CTA_WHEEL: readonly CtaTreatment[] = [
  "pill",
  "underline",
  "plain",
  "underline",
  "pill",
  "plain",
  "none",
] as const;

/**
 * Roughly how many characters of CTA-scale type fit across a fraction of the
 * canvas.
 *
 * A crude average character width of about 1/58th of the canvas at the CTA
 * size. Crude is fine: this is used to *refuse* a pill, and refusing one pill
 * that would have fitted costs nothing, while accepting one that does not is
 * Day 04 of the M6 pack — a two-line call to action wrapped inside a button
 * sized for one.
 */
export function ctaBudget(room: number, lines = 1): number {
  return Math.max(12, Math.floor(room * 58 * lines));
}

export interface CtaBrief {
  day: number;
  /** The call to action, untruncated. */
  text: string;
  /** Width available, as a fraction of the canvas. */
  room: number;
  /** The family's preference, when it has a structural one. */
  prefer?: CtaTreatment;
  /** True when the CTA sits on a photograph rather than on the page. */
  onPhoto?: boolean;
}

export function chooseCtaTreatment(brief: CtaBrief): CtaTreatment {
  const text = brief.text.trim();
  if (!text) return "none";

  const wheel = CTA_WHEEL[index(brief.day) % CTA_WHEEL.length];
  const wanted = brief.prefer ?? wheel;

  // A pill has to hold its sentence on one line inside its own padding, or it
  // is not a button, it is a box with a mistake in it.
  if (wanted === "pill") {
    const inner = Math.max(brief.room - 0.06, 0.1);
    if (text.length > ctaBudget(inner)) {
      return brief.onPhoto ? "plain" : "underline";
    }
  }

  // An underline under two lines of type underlines the second one, which is
  // not what an underline means. Long copy goes plain.
  if (wanted === "underline" && text.length > ctaBudget(brief.room)) return "plain";

  return wanted;
}

/**
 * The longest CTA this treatment can take, for `ctaLine` to trim to.
 *
 * `ctaLine` never cuts mid-sentence, so a tight budget means the poster shows
 * the first sentence of the call to action and the caption shows the rest.
 * That is a better poster than one showing all of it at half the size.
 */
export function ctaLimit(treatment: CtaTreatment, room: number): number {
  if (treatment === "pill") return ctaBudget(Math.max(room - 0.06, 0.1));
  if (treatment === "underline") return ctaBudget(room);
  return ctaBudget(room, 2);
}

/* --------------------------------- brand ---------------------------------- */

/**
 * The signature treatment, for the families that need it rather than the wheel.
 *
 * A brand line directly under a call to action has to be told apart from it at
 * a glance, and two lines of similar-sized body text stacked and centred read
 * as one muddy block whichever way the wheel happened to land that day. Small
 * tracked capitals are unmistakably a signature, so the centred families ask
 * for them by name.
 */
export const LETTERED_BRAND: BrandTreatment = {
  size: 0.022,
  weight: 700,
  tracking: 0.16,
  transform: "uppercase",
};

/**
 * How the restaurant's own name is set.
 *
 * In M6 it was the same size, the same weight and the same corner on twenty-
 * eight of thirty posters, which stops reading as a signature and starts
 * reading as a watermark — the thing a free tool stamps on your work. A name
 * set as small capitals on one poster, as a confident line on the next and as
 * a quiet footnote on a third is the same restaurant signing its own work
 * three different ways, which is what a designer does with a logotype.
 */
export interface BrandTreatment {
  size: number;
  weight: number;
  tracking: number;
  transform: "none" | "uppercase";
}

const BRAND_WHEEL: readonly BrandTreatment[] = [
  { size: 0.028, weight: 700, tracking: 0, transform: "none" },
  { size: 0.022, weight: 700, tracking: 0.16, transform: "uppercase" },
  { size: 0.036, weight: 800, tracking: -0.012, transform: "none" },
  { size: 0.024, weight: 600, tracking: 0.1, transform: "uppercase" },
] as const;

export function chooseBrandTreatment(day: number): BrandTreatment {
  return BRAND_WHEEL[index(day) % BRAND_WHEEL.length];
}

/* --------------------------------- crops ---------------------------------- */

/**
 * How close to stand, before the picture gets a say.
 *
 * A rotation rather than a constant, because a restaurant with four
 * photographs needs the same plate framed differently on the days it comes
 * back round. What it is *not* is the final zoom: `chooseCrop` caps this by
 * what the file can actually take, so a 720-pixel photograph asked for 1.6
 * gets 1.0 and stays sharp. In M6 this table was the last word, which is how
 * a 720-pixel picture ended up enlarged past its own detail on four days.
 *
 * Seven entries, walked with a stride of three: coprime, so a month visits all
 * seven, and the slot is added rather than multiplied so a collage's three
 * frames are three consecutive and therefore three different framings.
 */
const ZOOMS: readonly number[] = [1, 1.35, 1.15, 1.6, 1.25, 1.45, 1.08] as const;

export function chooseCropZoom(day: number, slot = 0): number {
  return ZOOMS[(index(day) * 3 + slot) % ZOOMS.length];
}

/**
 * Where to point the crop, relative to what the picture says is interesting.
 *
 * Zoom alone is not framing. Days 16 and 23 of the M6.5 acceptance pack were
 * the same plate of nasi lemak, at 1.6, pointed at the same pixel, in a box of
 * the same shape — one square and one portrait, and on the page they were one
 * photograph printed twice with different words on it. That is the "same photo,
 * same crop, different text" failure, and no amount of zoom variety fixes it,
 * because seven zooms means every seventh day is the same zoom.
 *
 * So the crop also moves. Four offsets, walked by day: four and seven are
 * coprime, so a picture has to come back twenty-eight days later before it is
 * framed the same way twice, and fifteen days later before it is framed the
 * same way in the same family — which no month is long enough to do.
 *
 * The slot is added rather than multiplied, so a collage's three frames are
 * three consecutive offsets and therefore three different ones — the same
 * reason `chooseCropZoom` adds it.
 *
 * The offsets are small on purpose. This is a photographer stepping half a pace
 * to one side, not a different picture: `chooseCrop` clamps the result inside
 * the subject the signature found, so a pan can change what is in the corners
 * of the frame but can never walk off the food.
 */
const SHIFTS: readonly { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 0.08, y: -0.05 },
  { x: -0.07, y: 0.04 },
  { x: 0.03, y: 0.09 },
] as const;

export function chooseCropShift(day: number, slot = 0): { x: number; y: number } {
  return SHIFTS[(index(day) + slot) % SHIFTS.length];
}

/** Where a mounted drawing sits on the page. See `chooseCardPlacement`. */
/**
 * The zoom a crop may keep once the shape of its box is known.
 *
 * `chooseCrop` decides how close to stand without knowing where the picture is
 * going: the focal points for a day are worked out once, before any layout
 * function has chosen a box for them. That costs nothing while the two shapes
 * agree, and compounds badly when they do not. A `cover` fit into a box wider
 * than the picture has already thrown away the top and the bottom; a zoom on
 * top of that throws away the sides as well, and the two together can leave a
 * tenth of the photograph on the page.
 *
 * Day 17 of the M6.5 acceptance pack is what that costs. The photograph is the
 * best one in the pool — a man lifting a sheet of roti canai dough over a
 * counter, 1920x2560 — dropped into a band twice as wide as it is tall and
 * then zoomed to 1.6. What reached the poster was a white shape with no hands,
 * no face and no counter anywhere in it.
 *
 * So the extra the layout asked for is scaled by how far the two shapes agree.
 * A picture in a box of its own proportions keeps all of it. One in a box that
 * has already halved it keeps half of it. Never more than was asked for, never
 * below 1, and nothing at all for a drawing, which is trimmed rather than
 * cropped.
 */
export function fitCropToBox(
  focal: Focal,
  box: Box,
  sig: Signature | null,
  format: CreativeFormat,
): Focal {
  if (!sig || sig.kind === "graphic" || focal.zoom <= 1) return focal;
  const canvas = CANVAS[format];
  const slot = (box.width * canvas.width) / (box.height * canvas.height);
  const picture = sig.width / sig.height;
  if (!(slot > 0) || !(picture > 0)) return focal;
  const agree = Math.min(slot, picture) / Math.max(slot, picture);
  return { ...focal, zoom: 1 + (focal.zoom - 1) * agree };
}

export type CardPlacement = "centre" | "left" | "right";

/**
 * Where to put a drawing that is being mounted rather than cropped into.
 *
 * A photograph has a crop, so the same plate twice is two framings. A drawing
 * has none: it is trimmed to its own edges and that is the only version of it
 * there is. So the variety has to come from where it is placed on the page and
 * how the type is ranged against it — which is what a designer with one
 * illustration and six pages to fill actually does.
 *
 * Days 6 and 16 of the M6.5 acceptance pack are why this exists. Both are the
 * minimal family, both took the same arrangement — the flip is `day % 2` and
 * both days are odd — and both mounted the same mug in the same place at the
 * same size. Two page colours apart, they were one poster printed twice.
 *
 * Three placements against a two-day flip is six pages before anything comes
 * round, which is more days than one drawing gets in a month.
 */
const PLACEMENTS: readonly CardPlacement[] = ["centre", "right", "left"] as const;

export function chooseCardPlacement(day: number): CardPlacement {
  return PLACEMENTS[index(day) % PLACEMENTS.length];
}

/**
 * How big to mount it, as a fraction of the slot the layout offered.
 *
 * Placement alone is not enough arithmetic. Three placements against the
 * two-day arrangement flip come round every six days, and a drawing that lands
 * on two days twelve apart — days 3 and 15 of the acceptance pack — is the
 * same page again. Five sizes against those two periods is thirty, which is
 * exactly a month: within one pack, one drawing is never mounted the same way
 * twice.
 *
 * The sizes are a designer's range and not a random one. A drawing at full
 * slot is the page's subject; at three-quarters it is an illustration with the
 * page around it. Nothing here goes small enough to look like a mistake.
 */
const CARD_SIZES: readonly number[] = [1, 0.84, 0.95, 0.78, 0.9] as const;

export function chooseCardScale(day: number): number {
  return CARD_SIZES[index(day) % CARD_SIZES.length];
}

/**
 * The side of a photograph a layout is about to put type on.
 *
 * Handed to `chooseCrop`, which nudges the subject away from it. This is the
 * difference between a headline that lands in the empty half of a picture and
 * one that lands on the food — and it is the reason `photo.ts` bothers to find
 * a subject at all.
 */
export function keepClearFor(
  family: TemplateId,
  arrangement: Arrangement,
): "top" | "bottom" | "left" | "right" | null {
  if (family === "photo-band" && arrangement === "primary") return "bottom";
  if (family === "local" && arrangement === "primary") return "bottom";
  if (family === "closeup" && arrangement === "alternate") return "top";
  if (family === "festive" && arrangement === "alternate") return "bottom";
  return null;
}

/* -------------------------------- redirect -------------------------------- */

/**
 * Families in which the picture *is* the page.
 *
 * Handed a drawing rather than a photograph, every one of these produces the
 * same failure: clip art enlarged past its own resolution, usually behind a
 * dark wash, usually on white that is not the poster's white. `Teh-tarik.jpg`
 * in the M6 acceptance pack was exactly this on three separate days.
 */
const PHOTO_LED: readonly TemplateId[] = [
  "photo-band",
  "closeup",
  "local",
  "festive",
  "split",
  "menu-card",
] as const;

/**
 * Where a graphic-led day goes instead.
 *
 * All three take exactly one image, so the pack builder's deal is unaffected —
 * `photosWanted` asked for one and one is still used — and all three treat the
 * picture as an element inside a page rather than as the page, which is the
 * only way a drawing looks deliberate.
 *
 * Chosen by the length of the hook, not by the day, and that is the whole
 * point. A restaurant owns one drawing, so every day that redirects redirects
 * with the *same picture*: two such days are the same poster with different
 * words unless something about them differs. Two attempts at this by day
 * arithmetic both failed on the acceptance pack, and failed in the same way —
 * the drawing landed on days 6 and 30, and 24 is a multiple of both wheels
 * that were tried. Any wheel has that hole somewhere; the run of days that
 * happen to be dealt the drawing is not something a modulus can be picked
 * against.
 *
 * The hook can be, and it is a better reason anyway — it is the §5 question,
 * asked of the one thing that is genuinely different about these days:
 *
 *   - A hook of a few words is an opportunity for type. `type-poster` sets it
 *     large at the top and the drawing supports it underneath.
 *   - A long hook needs a column and something beside it. `editorial` gives
 *     the drawing the full height of one half of the page, which is also the
 *     best frame a tall drawing gets anywhere in the set.
 *   - Everything between goes to `minimal`, where the drawing is the middle of
 *     the page and the words sit under it.
 *
 * The arrangement still comes from the day's flip (see `chooseComposition`),
 * so two days in the same length band still differ unless they also share a
 * parity.
 */
/** The three families a drawing is ever sent to. */
const GRAPHIC_HOMES: readonly TemplateId[] = [
  "type-poster",
  "minimal",
  "editorial",
] as const;

const SHORT_HOOK = 36;
const LONG_HOOK = 58;

export function redirectForGraphic(
  family: TemplateId,
  sig: Signature | null,
  day: number,
  headline = "",
): TemplateId {
  if (!isGraphic(sig)) return family;
  if (!PHOTO_LED.includes(family)) return family;

  const chars = headline.trim().length;
  // No hook to read — an older caller, or an empty day. The day decides, which
  // is what this did before and is still better than always answering the same.
  if (chars === 0) return GRAPHIC_HOMES[index(day) % GRAPHIC_HOMES.length];
  if (chars <= SHORT_HOOK) return "type-poster";
  if (chars >= LONG_HOOK) return "editorial";
  return "minimal";
}
