import { CATEGORY_META } from "../content/categories.ts";
import type {
  AssetRef,
  BrandTone,
  ContentCategory,
  ContentItem,
  Platform,
  RestaurantProfile,
} from "../content/types.ts";
import { familyFor, focalFor } from "./families.ts";
import { buildPalette, accentField } from "./palette.ts";
import { clampWords } from "./text.ts";
import {
  CANVAS,
  CREATIVE_VERSION,
  DEFAULT_FOCAL,
  type Background,
  type Box,
  type Creative,
  type CreativeElement,
  type CreativeFormat,
  type Focal,
  type ImageElement,
  type LogoElement,
  type Palette,
  type Scrim,
  type ScrimDirection,
  type ShapeElement,
  type TemplateId,
  type TextElement,
  type TextStyle,
} from "./types.ts";

/**
 * Turning one finished content day into one finished creative.
 *
 * ## Why there is no AI call in this file
 *
 * Every word that reaches a poster here was written by the generator and then
 * checked by `lib/content/validate.ts` — the hook, the CTA — or typed by the
 * owner themselves: the restaurant name, the dish names, the logo. Composition
 * selects and arranges; it never writes.
 *
 * That is not a shortcut, it is the safety property. The anti-hallucination
 * work in M1-M3 guards the text the generator produces. A second model asked to
 * "design a poster" would produce new text that had never been through any of
 * it, and the first invented price would appear on an image the owner posts
 * rather than in a caption they read first. Keeping the poster's words a strict
 * subset of already-validated words means a creative *cannot* claim anything
 * the plan does not already claim.
 *
 * It is also the reason a thirty-day pack costs exactly what it costs today.
 * Composition is arithmetic: no tokens, no request, no rate limit.
 *
 * The AI still makes the creative decisions — which dish the day is about, what
 * the hook says, which category and platform the day serves, what the visual
 * should show. Those decisions arrive as fields on `ContentItem`. This file
 * reads them and picks a layout; it does not second-guess them.
 */

/* --------------------------------- format --------------------------------- */

/**
 * Categories whose poster leads with one hero dish.
 *
 * A plate fills a 4:5 frame better than a square one, and a taller post simply
 * occupies more of a phone screen as it goes past — which is the whole job of a
 * food photograph in a feed. Everything else stays square, so the month reads
 * as a deliberate mix of shapes rather than one canvas stamped thirty times.
 */
const PORTRAIT_CATEGORIES: readonly ContentCategory[] = [
  "produk",
  "best_seller",
  "perayaan",
] as const;

/**
 * The shape this post should be published in.
 *
 * Platform first, because that is what decides the aspect ratio a feed will
 * crop to: WhatsApp Status and TikTok are full-screen vertical, so anything
 * else is letterboxed. Within a feed the category decides, per above.
 */
export function formatFor(item: ContentItem): CreativeFormat {
  if (item.platform === "whatsapp" || item.platform === "tiktok") return "story";
  if (item.category === "reels") return "portrait";
  return PORTRAIT_CATEGORIES.includes(item.category) ? "portrait" : "square";
}

/**
 * Which layout to use.
 *
 * Thin on purpose: the decision is `familyFor`, which is where the month's
 * whole distribution lives. This keeps the old two-argument shape so callers
 * that only know whether a photograph exists — the pack builder, the studio —
 * do not have to care how the wheel turns.
 */
export function templateFor(item: ContentItem, image: AssetRef | null): TemplateId {
  return familyFor(item, image !== null);
}

/* ---------------------------------- text ---------------------------------- */

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The dish this day is about, in the owner's own words — or null.
 *
 * Only returns a dish the post itself mentions. A poster that names a dish the
 * caption never discusses is a different post from the one the owner is about
 * to publish, and the mismatch is exactly the sort of thing nobody notices
 * until a customer orders the wrong thing.
 *
 * The list searched is `bestSellers`, which the owner typed. Nothing here can
 * produce a dish name that was not already on their menu.
 */
export function dishInPost(
  item: ContentItem,
  bestSellers: readonly string[],
): string | null {
  const haystack = normalise(`${item.hook} ${item.caption} ${item.visualIdea}`);
  for (const dish of bestSellers) {
    const needle = normalise(dish);
    if (needle && haystack.includes(needle)) return dish.trim();
  }
  return null;
}

/**
 * The name the creative is filed under, e.g. "Nasi Lemak — Hari 01".
 *
 * The dish when the post is about one, the category otherwise. Editable by the
 * owner afterwards; this is only the starting point.
 */
export function defaultName(item: ContentItem, dish: string | null): string {
  const subject = dish ?? CATEGORY_META[item.category].label;
  return `${subject} — Hari ${String(item.day).padStart(2, "0")}`;
}

/* ------------------------------- typography ------------------------------- */

/**
 * How the type behaves for each brand tone.
 *
 * The tone is something the owner chose in onboarding, so this is their
 * decision expressed in type rather than a style we picked for them. `premium`
 * is the one that genuinely differs: lighter weight, wider letterspacing and
 * capitals, because that is what the look is.
 */
interface ToneType {
  weight: number;
  headline: number;
  tracking: number;
  transform: "none" | "uppercase";
}

const TONE_TYPE: Record<BrandTone, ToneType> = {
  friendly: { weight: 800, headline: 0.085, tracking: -0.015, transform: "none" },
  casual: { weight: 800, headline: 0.088, tracking: -0.02, transform: "none" },
  funny: { weight: 900, headline: 0.095, tracking: -0.025, transform: "none" },
  premium: { weight: 500, headline: 0.07, tracking: 0.03, transform: "uppercase" },
  family: { weight: 700, headline: 0.082, tracking: -0.01, transform: "none" },
  kampung: { weight: 700, headline: 0.082, tracking: -0.01, transform: "none" },
};

function headlineStyle(tone: BrandTone): TextStyle {
  const t = TONE_TYPE[tone];
  return {
    family: "display",
    weight: t.weight,
    size: t.headline,
    lineHeight: 1.08,
    letterSpacing: t.tracking,
    transform: t.transform,
  };
}

const LABEL_STYLE: TextStyle = {
  family: "body",
  weight: 700,
  size: 0.026,
  lineHeight: 1.2,
  letterSpacing: 0.08,
  transform: "uppercase",
};

const CTA_STYLE: TextStyle = {
  family: "body",
  weight: 700,
  size: 0.032,
  lineHeight: 1.2,
  letterSpacing: 0,
  transform: "none",
};

const BRAND_STYLE: TextStyle = {
  family: "body",
  weight: 700,
  size: 0.028,
  lineHeight: 1.2,
  letterSpacing: 0,
  transform: "none",
};

/* -------------------------------- elements -------------------------------- */

/**
 * Element ids are the role they play.
 *
 * Roles are unique within a template, so this is unique within a creative — and
 * being derived rather than generated keeps composition pure: the same day
 * composed twice produces byte-identical elements, which is what makes a saved
 * creative comparable with a freshly composed one.
 */
function text(
  role: TextElement["role"],
  value: string,
  box: Box,
  style: TextStyle,
  extra: Partial<Omit<TextElement, "kind" | "role" | "text" | "box" | "style">> = {},
): TextElement {
  return {
    kind: "text",
    id: role,
    order: 0,
    role,
    text: value,
    box,
    style,
    colour: "ink",
    align: "left",
    valign: "top",
    autoFit: true,
    plate: null,
    ...extra,
  };
}

/* --------------------------------- layout --------------------------------- */

const M = 0.07; // Page margin, as a fraction of the width.

/**
 * The small, deterministic differences between one day's poster and the next.
 *
 * A month composed by one template set is thirty posters that look the same,
 * and an owner scrolling their own grid notices that before they notice
 * anything else. So each day gets a *treatment*: the same elements, arranged
 * one of a few known-good ways.
 *
 * Three things this deliberately is not:
 *
 *   - It is not an anti-repetition rule. Nothing here rejects a day for being
 *     the same category, the same dish or the same template as the day before.
 *     M4A tried strict repetition rules on the copy and the writing got worse,
 *     not more varied; there is no reason to expect layout to behave better.
 *   - It is not random. The treatment is a function of the day number, so a
 *     creative composed twice is the same creative — which is what lets a saved
 *     design be compared with a freshly composed one.
 *   - It is not a licence to make a poster harder to read. Every variant is a
 *     rearrangement within the same palette and the same contrast guarantees.
 *     Where moving the type would have put it on the part of a photograph the
 *     scrim does not cover, the photograph moves instead of the type.
 *
 * The periods are 2, 4 and 3, so they come back into phase every twelfth day
 * rather than every second one.
 */
export interface Treatment {
  /** Lay the page on the slightly deeper surface tone rather than the base. */
  deeper: boolean;
  /** Centre the CTA pill on the page instead of aligning it to the margin. */
  centreCta: boolean;
  /** Move the type block. What that means is each template's own business. */
  alternate: boolean;
}

export function treatmentFor(item: ContentItem): Treatment {
  const n = Math.max(Math.trunc(item.day), 1) - 1;
  // Every period below is odd-stepped against the fifteen-day family wheel, so
  // the two days a month that share a family never share a treatment. An
  // earlier version used `n % 3`, which divides fifteen exactly — the second
  // hero day was the first hero day again, and half the compositions in this
  // file were never rendered at all.
  return {
    deeper: n % 4 >= 2,
    centreCta: n % 6 >= 3,
    alternate: n % 2 === 1,
  };
}

/**
 * Where the CTA pill sits, given the treatment. The same size either way.
 *
 * Tall enough for two lines. A call to action written by a person is a
 * sentence — "Save post ni untuk rujukan bila datang nanti" — not a button
 * label, and a pill sized for one line squeezes it until it looks like a
 * mistake.
 */
function ctaBox(t: Treatment, y: number): Box {
  const width = 0.68;
  return { x: t.centreCta ? (1 - width) / 2 : M, y, width, height: 0.088 };
}

/** The page colour for this treatment. Both carry `ink` at full contrast. */
function pageColour(palette: Palette, t: Treatment): string {
  return t.deeper ? palette.surface : palette.base;
}

/* -------------------------------- templates ------------------------------- */

/**
 * The placeholder every empty slot carries.
 *
 * One string, because it is an instruction to the owner rather than design, and
 * it is never exported — see `paintImage`.
 */
const PHOTO_SLOT = "Letak gambar makanan anda di sini";

interface Parts {
  headline: string;
  /** The dish, or null. Rendered as the small label above the headline. */
  label: string | null;
  cta: string;
  brand: string;
  logo: AssetRef | null;
  /** As many photographs as this family asked for. May be shorter. */
  images: readonly AssetRef[];
  /** How each slot frames its picture, indexed the same way. */
  focals: readonly Focal[];
  /** The occasion this day belongs to, for the festive family. */
  occasion: string | null;
  /** The town, for the family that is about the neighbourhood. */
  location: string;
  tone: BrandTone;
  palette: Palette;
  treatment: Treatment;
}

interface Built {
  background: Background;
  elements: CreativeElement[];
}

/* ------------------------------ small pieces ------------------------------ */

/**
 * One photo slot.
 *
 * Slot zero keeps the id `photo`, which is what the studio's "replace picture"
 * control has always looked for and what every creative already saved uses.
 */
function frame(
  parts: Parts,
  index: number,
  box: Box,
  extra: Partial<Pick<ImageElement, "radius" | "scrim" | "order" | "fit">> = {},
): ImageElement {
  return {
    kind: "image",
    id: index === 0 ? "photo" : `photo-${index + 1}`,
    order: extra.order ?? 0,
    box,
    source: parts.images[index] ?? null,
    fit: extra.fit ?? "cover",
    radius: extra.radius ?? 0,
    focal: parts.focals[index] ?? DEFAULT_FOCAL,
    scrim: extra.scrim ?? null,
    placeholder: PHOTO_SLOT,
  };
}

/** A dark wash over a photograph. The only safe ground for type on a picture. */
function wash(opacity: number, direction: ScrimDirection = "bottom"): Scrim {
  return { colour: "photoScrim", opacity, direction };
}

/** The CTA as a filled pill — the loudest form, for the layouts that want one. */
function pill(
  parts: Parts,
  box: Box,
  plate: keyof Palette = "accent",
  ink: keyof Palette = "accentInk",
): TextElement {
  return text("cta", clampWords(parts.cta, 46), box, CTA_STYLE, {
    order: 40,
    colour: ink,
    align: "center",
    valign: "middle",
    plate: { colour: plate, radius: 0.5, padding: 0.03 },
  });
}

/** The CTA as a line of type. Quieter, and right for the restrained families. */
function quietCta(
  parts: Parts,
  box: Box,
  colour: keyof Palette,
  align: TextElement["align"] = "left",
): TextElement {
  return text("cta", clampWords(parts.cta, 60), box, CTA_STYLE, {
    order: 40,
    colour,
    align,
    valign: "middle",
  });
}

function brandLine(
  parts: Parts,
  box: Box,
  colour: keyof Palette,
  align: TextElement["align"] = "left",
): TextElement {
  return text("brand", parts.brand, box, BRAND_STYLE, {
    order: 20,
    colour,
    align,
    valign: "middle",
  });
}

/** The small line of capitals above a headline. Absent when there is nothing true to put there. */
function eyebrow(
  value: string,
  box: Box,
  colour: keyof Palette,
  align: TextElement["align"] = "left",
): TextElement {
  return text("subheading", value, box, LABEL_STYLE, {
    order: 25,
    colour,
    align,
  });
}

function mark(parts: Parts, box: Box): LogoElement[] {
  if (!parts.logo) return [];
  return [{ kind: "logo", id: "logo", order: 20, box, source: parts.logo }];
}

function block(
  id: string,
  box: Box,
  fill: keyof Palette,
  extra: Partial<Pick<ShapeElement, "radius" | "opacity" | "order">> = {},
): ShapeElement {
  return {
    kind: "shape",
    id,
    order: extra.order ?? 5,
    box,
    fill,
    radius: extra.radius ?? 0,
    opacity: extra.opacity ?? 1,
  };
}

function big(tone: BrandTone, factor: number): TextStyle {
  const base = headlineStyle(tone);
  return { ...base, size: base.size * factor };
}

/* --------------------------------- families -------------------------------- */

/**
 * Product Hero — the plate, as large as the page allows.
 *
 * Two arrangements, and the difference between them is where the photograph
 * stops. In `full` the picture is the whole page and the type sits in the band
 * at the bottom that the wash darkens. In `band` the picture takes the top half
 * and the type sits below it on the page itself.
 *
 * Type at the *top* of a full-bleed photo is missing on purpose: the wash is
 * transparent up there so the food is still the picture, and light type on an
 * unknown photograph is a coin toss we would be flipping on the owner's behalf.
 */
function productHero(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts.palette, t);

  if (!t.alternate) {
    const els: CreativeElement[] = [
      frame(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.55) }),
      text("headline", parts.headline, { x: M, y: 0.6, width: 1 - M * 2, height: 0.2 },
        headlineStyle(parts.tone),
        { order: 30, colour: "photoInk", valign: "bottom" }),
      pill(parts, ctaBox(t, 0.845)),
      brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.06, width: 0.6, height: 0.08 }, "photoInk"),
      ...mark(parts, { x: M, y: 0.06, width: 0.14, height: 0.08 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: M, y: 0.545, width: 1 - M * 2, height: 0.04 }, "photoInk"));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // Banded: the photograph ends at the halfway line and every word below it is
  // on the page colour, so no wash is needed and none is drawn.
  const els: CreativeElement[] = [
    frame(parts, 0, { x: 0, y: 0, width: 1, height: 0.5 }),
    brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.545, width: 0.6, height: 0.07 }, "inkSoft"),
    text("headline", parts.headline, { x: M, y: 0.68, width: 1 - M * 2, height: 0.15 },
      headlineStyle(parts.tone), { order: 30, colour: "ink" }),
    pill(parts, ctaBox(t, 0.855)),
    ...mark(parts, { x: M, y: 0.545, width: 0.14, height: 0.07 }),
  ];
  if (parts.label) {
    els.push(eyebrow(parts.label, { x: M, y: 0.635, width: 1 - M * 2, height: 0.04 }, "accent"));
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Editorial — a picture and a headline sharing the page, the way a magazine
 * does it.
 *
 * The distinguishing move is that nothing is centred and nothing is a pill: a
 * short rule, a line of capitals, a headline set against a lot of white, and
 * the call to action as a plain line of type. It is the quietest of the photo
 * families, which is what makes it read as considered next to a hero shot.
 */
function editorial(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts.palette, t);

  if (!t.alternate) {
    const els: CreativeElement[] = [
      frame(parts, 0, { x: 0, y: 0, width: 1, height: 0.54 }),
      block("rule", { x: M, y: 0.6, width: 0.13, height: 0.007 }, "accent"),
      text("headline", parts.headline, { x: M, y: 0.665, width: 1 - M * 2, height: 0.155 },
        headlineStyle(parts.tone), { order: 30, colour: "ink" }),
      quietCta(parts, { x: M, y: 0.835, width: 1 - M * 2, height: 0.055 }, "inkSoft"),
      brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.9, width: 0.6, height: 0.05 }, "ink"),
      ...mark(parts, { x: M, y: 0.895, width: 0.13, height: 0.06 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: M, y: 0.618, width: 0.7, height: 0.038 }, "accent"));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // The picture takes the right of the page from top to bottom and the words
  // run down a narrow column on the left, which forces a short headline into
  // several lines — the single most magazine-like thing type can do.
  const els: CreativeElement[] = [
    frame(parts, 0, { x: 0.44, y: 0, width: 0.56, height: 1 }),
    block("rule", { x: M, y: 0.115, width: 0.11, height: 0.007 }, "accent"),
    text("headline", parts.headline, { x: M, y: 0.31, width: 0.34, height: 0.3 },
      headlineStyle(parts.tone), { order: 30, colour: "ink" }),
    quietCta(parts, { x: M, y: 0.68, width: 0.32, height: 0.09 }, "inkSoft"),
    brandLine(parts, { x: M, y: 0.85, width: 0.32, height: 0.05 }, "ink"),
  ];
  if (parts.label) {
    els.push(eyebrow(parts.label, { x: M, y: 0.255, width: 0.34, height: 0.038 }, "accent"));
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Bold Typography — the sentence *is* the design.
 *
 * No photograph at all, so it is also part of what a restaurant with no
 * pictures gets. The two compositions differ in which way round the page runs:
 * words on the page with a colour block under them, or the whole page in
 * colour with the words on top.
 */
function boldType(parts: Parts): Built {
  const t = parts.treatment;

  if (!t.alternate) {
    const els: CreativeElement[] = [
      block("band", { x: 0, y: 0.62, width: 1, height: 0.38 }, "accent"),
      text("headline", parts.headline, { x: M, y: 0.13, width: 1 - M * 2, height: 0.42 },
        big(parts.tone, 1.45), { order: 30, colour: "ink" }),
      quietCta(parts, { x: M, y: 0.72, width: 1 - M * 2, height: 0.08 }, "accentInk"),
      brandLine(parts, { x: M, y: 0.87, width: 0.6, height: 0.05 }, "accentInk"),
      ...mark(parts, { x: 0.79, y: 0.85, width: 0.14, height: 0.08 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: M, y: 0.08, width: 0.7, height: 0.038 }, "accent"));
    }
    return { background: { kind: "solid", colour: pageColour(parts.palette, t) }, elements: els };
  }

  const els: CreativeElement[] = [
    text("headline", parts.headline, { x: M, y: 0.18, width: 1 - M * 2, height: 0.46 },
      big(parts.tone, 1.55), { order: 30, colour: "photoInk" }),
    block("rule", { x: M, y: 0.7, width: 0.16, height: 0.008 }, "photoInk"),
    quietCta(parts, { x: M, y: 0.75, width: 1 - M * 2, height: 0.08 }, "photoInk"),
    brandLine(parts, { x: M, y: 0.88, width: 0.6, height: 0.05 }, "photoInk"),
  ];
  return {
    background: { kind: "solid", colour: accentField(parts.palette) },
    elements: els,
  };
}

/**
 * Food Close-up — cropped so far into the picture that the subject is texture.
 *
 * The crop is the whole idea: steam, char, the edge of a bowl. It is what turns
 * a fourth appearance of the same photograph into a post nobody recognises as a
 * repeat, and it is the family that most depends on `focalFor` going in close.
 */
function closeup(parts: Parts): Built {
  const t = parts.treatment;

  if (!t.alternate) {
    const els: CreativeElement[] = [
      frame(parts, 0, { x: 0, y: 0, width: 1, height: 0.74 }),
      block("band", { x: 0, y: 0.74, width: 1, height: 0.26 }, "accent"),
      text("headline", parts.headline, { x: M, y: 0.765, width: 1 - M * 2, height: 0.11 },
        big(parts.tone, 0.85), { order: 30, colour: "accentInk" }),
      quietCta(parts, { x: M, y: 0.885, width: 0.52, height: 0.06 }, "accentInk"),
      brandLine(parts, { x: 0.48, y: 0.885, width: 1 - 0.48 - M, height: 0.06 }, "accentInk", "right"),
    ];
    return { background: { kind: "solid", colour: pageColour(parts.palette, t) }, elements: els };
  }

  const els: CreativeElement[] = [
    frame(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.5, "top") }),
    text("headline", parts.headline, { x: M, y: 0.1, width: 1 - M * 2, height: 0.2 },
      headlineStyle(parts.tone), { order: 30, colour: "photoInk" }),
    brandLine(parts, { x: M, y: 0.325, width: 0.6, height: 0.05 }, "photoInk"),
    pill(parts, ctaBox(t, 0.85)),
    ...mark(parts, { x: 0.79, y: 0.06, width: 0.14, height: 0.08 }),
  ];
  return { background: { kind: "solid", colour: pageColour(parts.palette, t) }, elements: els };
}

/**
 * Split Composition — the page divided cleanly in two, picture against colour.
 *
 * The hard edge is the point. Every other photo family softens the join with a
 * wash or a margin; this one does not, which is why it reads as a different
 * poster rather than a rearranged one.
 */
function split(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts.palette, t);

  if (!t.alternate) {
    // The field takes a little more than half. A column narrower than this
    // makes `autoFit` shrink a normal Malay sentence until the headline is
    // quieter than the photograph beside it, which inverts the layout.
    const els: CreativeElement[] = [
      block("field", { x: 0, y: 0, width: 0.54, height: 1 }, "accent"),
      frame(parts, 0, { x: 0.54, y: 0, width: 0.46, height: 1 }),
      text("headline", parts.headline, { x: 0.06, y: 0.28, width: 0.42, height: 0.32 },
        big(parts.tone, 0.82), { order: 30, colour: "accentInk" }),
      quietCta(parts, { x: 0.06, y: 0.68, width: 0.42, height: 0.09 }, "accentInk"),
      brandLine(parts, { x: 0.06, y: 0.86, width: 0.42, height: 0.05 }, "accentInk"),
      ...mark(parts, { x: 0.06, y: 0.09, width: 0.14, height: 0.08 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: 0.06, y: 0.225, width: 0.42, height: 0.038 }, "accentInk"));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  const els: CreativeElement[] = [
    frame(parts, 0, { x: 0, y: 0, width: 1, height: 0.45 }),
    block("field", { x: 0, y: 0.45, width: 1, height: 0.55 }, "accent"),
    text("headline", parts.headline, { x: M, y: 0.56, width: 1 - M * 2, height: 0.2 },
      headlineStyle(parts.tone), { order: 30, colour: "accentInk" }),
    pill(parts, ctaBox(t, 0.8), "base", "ink"),
    brandLine(parts, { x: M, y: 0.9, width: 0.6, height: 0.05 }, "accentInk"),
  ];
  if (parts.label) {
    els.push(eyebrow(parts.label, { x: M, y: 0.51, width: 1 - M * 2, height: 0.038 }, "accentInk"));
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Collage — three frames of the same restaurant on one page.
 *
 * With three photographs it is three photographs. With one it is three crops of
 * one, which is a normal thing for a designer to do and an honest one: every
 * frame is still the owner's own picture. `focalFor` gives each slot a
 * different crop for exactly this reason.
 */
function collage(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts.palette, t);
  const r = 0.03;

  if (!t.alternate) {
    const els: CreativeElement[] = [
      frame(parts, 0, { x: M, y: 0.09, width: 0.5, height: 0.44 }, { radius: r }),
      frame(parts, 1, { x: 0.585, y: 0.09, width: 0.345, height: 0.21 }, { radius: r }),
      frame(parts, 2, { x: 0.585, y: 0.32, width: 0.345, height: 0.21 }, { radius: r }),
      brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.025, width: 0.6, height: 0.05 }, "ink"),
      text("headline", parts.headline, { x: M, y: 0.615, width: 1 - M * 2, height: 0.17 },
        headlineStyle(parts.tone), { order: 30, colour: "ink" }),
      pill(parts, ctaBox(t, 0.83)),
      ...mark(parts, { x: M, y: 0.02, width: 0.13, height: 0.06 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: M, y: 0.567, width: 1 - M * 2, height: 0.038 }, "accent"));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  const gap = 0.015;
  const w = (1 - M * 2 - gap * 2) / 3;
  const els: CreativeElement[] = [
    text("headline", parts.headline, { x: M, y: 0.1, width: 1 - M * 2, height: 0.17 },
      headlineStyle(parts.tone), { order: 30, colour: "ink" }),
    frame(parts, 0, { x: M, y: 0.33, width: w, height: 0.3 }, { radius: r }),
    frame(parts, 1, { x: M + w + gap, y: 0.33, width: w, height: 0.3 }, { radius: r }),
    frame(parts, 2, { x: M + (w + gap) * 2, y: 0.33, width: w, height: 0.3 }, { radius: r }),
    pill(parts, ctaBox(t, 0.71)),
    brandLine(parts, { x: M, y: 0.86, width: 0.6, height: 0.05 }, "inkSoft"),
    ...mark(parts, { x: 0.79, y: 0.845, width: 0.14, height: 0.08 }),
  ];
  if (parts.label) {
    els.push(eyebrow(parts.label, { x: M, y: 0.052, width: 1 - M * 2, height: 0.038 }, "accent"));
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Menu Feature — one dish, named, on a card.
 *
 * The only family where the *name of the dish* is the largest thing after the
 * headline, which is what makes it useful on a day the post is about one item.
 * The name is `dishInPost`, so it came off the owner's own menu and appears in
 * the caption as well; nothing here can put a dish on a poster that the
 * restaurant does not sell.
 */
function menuCard(parts: Parts): Built {
  const t = parts.treatment;

  if (!t.alternate) {
    const els: CreativeElement[] = [
      frame(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.4, "full") }),
      block("card", { x: 0.1, y: 0.23, width: 0.8, height: 0.54 }, "base", { radius: 0.05, order: 10 }),
      text("headline", parts.headline, { x: 0.16, y: 0.345, width: 0.68, height: 0.2 },
        big(parts.tone, 0.9),
        { order: 30, colour: "ink", align: "center" }),
      block("rule", { x: 0.44, y: 0.585, width: 0.12, height: 0.006 }, "accent", { order: 30 }),
      pill(parts, { x: 0.24, y: 0.63, width: 0.52, height: 0.07 }),
      brandLine(parts, { x: 0.15, y: 0.715, width: 0.7, height: 0.045 }, "inkSoft", "center"),
    ];
    els.push(
      eyebrow(parts.label ?? parts.brand, { x: 0.15, y: 0.285, width: 0.7, height: 0.04 }, "accent", "center"),
    );
    return { background: { kind: "solid", colour: pageColour(parts.palette, t) }, elements: els };
  }

  const els: CreativeElement[] = [
    frame(parts, 0, { x: 0, y: 0, width: 0.42, height: 1 }),
    block("card", { x: 0.46, y: 0.12, width: 0.47, height: 0.76 }, "surface", { radius: 0.05, order: 10 }),
    text("headline", parts.headline, { x: 0.5, y: 0.26, width: 0.39, height: 0.26 },
      big(parts.tone, 0.85), { order: 30, colour: "ink" }),
    block("rule", { x: 0.5, y: 0.56, width: 0.1, height: 0.006 }, "accent", { order: 30 }),
    pill(parts, { x: 0.5, y: 0.62, width: 0.39, height: 0.07 }),
    brandLine(parts, { x: 0.5, y: 0.775, width: 0.39, height: 0.05 }, "inkSoft"),
  ];
  els.push(eyebrow(parts.label ?? parts.brand, { x: 0.5, y: 0.2, width: 0.39, height: 0.04 }, "accent"));
  return {
    background: { kind: "solid", colour: pageColour(parts.palette, t) },
    elements: els,
  };
}

/**
 * Question — one question, set large enough that answering it is the obvious
 * thing to do.
 *
 * Photograph-free and centred, which is the opposite of every other family
 * here. On an engagement day that difference is the post: a picture of food
 * would compete with the question, and the question is the point.
 */
function question(parts: Parts): Built {
  const t = parts.treatment;

  if (!t.alternate) {
    const els: CreativeElement[] = [
      text("headline", parts.headline, { x: 0.11, y: 0.27, width: 0.78, height: 0.34 },
        big(parts.tone, 1.2),
        { order: 30, colour: "photoInk", align: "center", valign: "middle" }),
      quietCta(parts, { x: 0.14, y: 0.68, width: 0.72, height: 0.08 }, "photoInk", "center"),
      brandLine(parts, { x: 0.14, y: 0.86, width: 0.72, height: 0.05 }, "photoInk", "center"),
    ];
    return {
      background: { kind: "solid", colour: accentField(parts.palette) },
      elements: els,
    };
  }

  // A drawn frame, four rules inset from the edge. Cheap, and it turns a page
  // of type into something that looks placed rather than left over.
  const i = 0.045;
  const w = 0.008;
  const els: CreativeElement[] = [
    block("frame-top", { x: i, y: i, width: 1 - i * 2, height: w }, "accent"),
    block("frame-bottom", { x: i, y: 1 - i - w, width: 1 - i * 2, height: w }, "accent"),
    block("frame-left", { x: i, y: i, width: w, height: 1 - i * 2 }, "accent"),
    block("frame-right", { x: 1 - i - w, y: i, width: w, height: 1 - i * 2 }, "accent"),
    text("headline", parts.headline, { x: 0.14, y: 0.29, width: 0.72, height: 0.32 },
      big(parts.tone, 1.1),
      { order: 30, colour: "ink", align: "center", valign: "middle" }),
    pill(parts, { x: 0.24, y: 0.68, width: 0.52, height: 0.07 }),
    brandLine(parts, { x: 0.14, y: 0.85, width: 0.72, height: 0.05 }, "inkSoft", "center"),
  ];
  return {
    background: { kind: "solid", colour: pageColour(parts.palette, t) },
    elements: els,
  };
}

/**
 * Minimal — one small picture and a great deal of air.
 *
 * The restraint is the design. It is also the family that flatters an
 * indifferent photograph most, because a small picture with space around it
 * asks far less of the picture than a full-bleed one does — which matters when
 * the photographs came off a phone in a busy kitchen.
 */
function minimal(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts.palette, t);
  const style: TextStyle = { ...big(parts.tone, 0.78), lineHeight: 1.3 };

  if (!t.alternate) {
    // The photograph has to be the largest thing on the page. Restraint here
    // means one picture and a lot of margin — a small picture in the middle of
    // a cream field is not restraint, it is a poster that did not finish.
    const els: CreativeElement[] = [
      frame(parts, 0, { x: 0.12, y: 0.1, width: 0.76, height: 0.52 }),
      text("headline", parts.headline, { x: 0.13, y: 0.725, width: 0.74, height: 0.13 },
        style, { order: 30, colour: "ink", align: "center" }),
      quietCta(parts, { x: 0.15, y: 0.87, width: 0.7, height: 0.05 }, "inkSoft", "center"),
      brandLine(parts, { x: 0.15, y: 0.925, width: 0.7, height: 0.045 }, "ink", "center"),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: 0.15, y: 0.675, width: 0.7, height: 0.038 }, "accent", "center"));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  const els: CreativeElement[] = [
    text("headline", parts.headline, { x: 0.15, y: 0.1, width: 0.7, height: 0.15 },
      style, { order: 30, colour: "ink", align: "center" }),
    frame(parts, 0, { x: 0, y: 0.31, width: 1, height: 0.34 }),
    quietCta(parts, { x: 0.15, y: 0.75, width: 0.7, height: 0.06 }, "inkSoft", "center"),
    brandLine(parts, { x: 0.15, y: 0.87, width: 0.7, height: 0.045 }, "ink", "center"),
  ];
  if (parts.label) {
    els.push(eyebrow(parts.label, { x: 0.15, y: 0.7, width: 0.7, height: 0.038 }, "accent", "center"));
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Community — the post that is about where the restaurant is.
 *
 * The eyebrow is the town rather than a dish, because that is the subject. It
 * falls back to the dish when the owner never told us where they are, and to
 * nothing when there is neither: an invented neighbourhood is the same class of
 * mistake as an invented price.
 */
function local(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts.palette, t);
  const where = parts.location.trim() || parts.label;

  if (!t.alternate) {
    const els: CreativeElement[] = [
      frame(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.55) }),
      text("headline", parts.headline, { x: M, y: 0.6, width: 1 - M * 2, height: 0.19 },
        headlineStyle(parts.tone), { order: 30, colour: "photoInk", valign: "bottom" }),
      brandLine(parts, { x: M, y: 0.805, width: 0.6, height: 0.05 }, "photoInk"),
      pill(parts, ctaBox(t, 0.875)),
    ];
    if (where) {
      els.push(
        text("subheading", where, { x: M, y: 0.06, width: 0.5, height: 0.06 }, LABEL_STYLE, {
          order: 25,
          colour: "accentInk",
          align: "center",
          valign: "middle",
          plate: { colour: "accent", radius: 0.5, padding: 0.028 },
        }),
      );
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // A postcard: the town at the top, the picture across the middle, the
  // sentence underneath. Centred, because this is the family about belonging
  // somewhere and every other photo family on the wheel is set left.
  const els: CreativeElement[] = [
    block("field", { x: 0, y: 0, width: 1, height: 0.2 }, "accent"),
    frame(parts, 0, { x: 0.07, y: 0.235, width: 0.86, height: 0.4 }, { radius: 0.03 }),
    text("headline", parts.headline, { x: 0.1, y: 0.685, width: 0.8, height: 0.14 },
      big(parts.tone, 0.85), { order: 30, colour: "ink", align: "center" }),
    quietCta(parts, { x: 0.12, y: 0.855, width: 0.76, height: 0.055 }, "inkSoft", "center"),
    brandLine(parts, { x: 0.12, y: 0.915, width: 0.76, height: 0.05 }, "ink", "center"),
  ];
  // The town if we were told one, the restaurant's own name if we were not.
  // Never an invented neighbourhood, and never an empty band.
  els.push(
    eyebrow(where || parts.brand, { x: 0.1, y: 0.085, width: 0.8, height: 0.055 }, "accentInk", "center"),
  );
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Festive — the day the Malaysia calendar claimed.
 *
 * The one rule that matters here is that it still has to look like this
 * restaurant. A festive post rendered in gold and green with a generic greeting
 * is a poster from a template site; the owner's palette, the owner's type and
 * the owner's photograph, with the occasion named, is a post from their shop.
 *
 * The occasion is named by `lib/calendar`, which holds gazetted dates as
 * literals — so the greeting is never a date the model remembered.
 */
function festive(parts: Parts): Built {
  const t = parts.treatment;
  const name = parts.occasion ?? parts.label;

  if (!t.alternate) {
    const els: CreativeElement[] = [
      block("band-top", { x: 0, y: 0, width: 1, height: 0.022 }, "accent"),
      block("band-bottom", { x: 0, y: 0.978, width: 1, height: 0.022 }, "accent"),
      frame(parts, 0, { x: M, y: 0.1, width: 1 - M * 2, height: 0.42 }, { radius: 0.02 }),
      text("headline", parts.headline, { x: 0.11, y: 0.625, width: 0.78, height: 0.16 },
        big(parts.tone, 0.92), { order: 30, colour: "ink", align: "center" }),
      pill(parts, { x: 0.24, y: 0.815, width: 0.52, height: 0.07 }),
      brandLine(parts, { x: 0.15, y: 0.9, width: 0.7, height: 0.045 }, "inkSoft", "center"),
    ];
    if (name) {
      els.push(eyebrow(name, { x: 0.11, y: 0.567, width: 0.78, height: 0.04 }, "accent", "center"));
    }
    return {
      background: { kind: "solid", colour: parts.palette.surface },
      elements: els,
    };
  }

  const els: CreativeElement[] = [
    frame(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.6) }),
    text("headline", parts.headline, { x: 0.11, y: 0.6, width: 0.78, height: 0.19 },
      big(parts.tone, 0.95),
      { order: 30, colour: "photoInk", align: "center", valign: "bottom" }),
    pill(parts, { x: 0.24, y: 0.845, width: 0.52, height: 0.07 }),
    brandLine(parts, { x: 0.15, y: 0.925, width: 0.7, height: 0.045 }, "photoInk", "center"),
  ];
  if (name) {
    els.push(eyebrow(name, { x: 0.11, y: 0.545, width: 0.78, height: 0.04 }, "photoInk", "center"));
  }
  return { background: { kind: "solid", colour: pageColour(parts.palette, t) }, elements: els };
}

/**
 * Storytelling — type first, with a picture below it the owner can swap.
 *
 * The variant swaps the order of the two blocks: picture over words, or words
 * over picture. Both keep the CTA on the same line at the foot of the page, so
 * a month of these still reads as one set rather than as thirty one-offs.
 */
function typePoster(parts: Parts): Built {
  const t = parts.treatment;
  const wordsFirst = t.alternate;

  const photoY = wordsFirst ? 0.47 : 0.17;
  const labelY = wordsFirst ? 0.185 : 0.53;
  const headlineY = wordsFirst ? 0.23 : 0.575;

  const els: CreativeElement[] = [
    // A rule in the brand colour along the top. One decisive piece of brand
    // that costs nothing and does not depend on the owner having uploaded
    // anything at all.
    block("rule", { x: 0, y: 0, width: 1, height: 0.014 }, "accent"),
    frame(parts, 0, { x: M, y: photoY, width: 1 - M * 2, height: 0.34 }, { radius: 0.06, order: 10 }),
    text("headline", parts.headline, { x: M, y: headlineY, width: 1 - M * 2, height: 0.21 },
      headlineStyle(parts.tone), { order: 30, colour: "ink" }),
    pill(parts, ctaBox(t, 0.845)),
    brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.055, width: 0.6, height: 0.08 }, "ink"),
    ...mark(parts, { x: M, y: 0.055, width: 0.14, height: 0.08 }),
  ];

  if (parts.label) {
    els.push(eyebrow(parts.label, { x: M, y: labelY, width: 1 - M * 2, height: 0.04 }, "accent"));
  }

  return {
    background: { kind: "solid", colour: pageColour(parts.palette, t) },
    elements: els,
  };
}

/**
 * Brand Statement — a full-bleed colour field with the hook set large.
 *
 * Also what WhatsApp Status always gets, because a Status is glanced at on a
 * phone held at arm's length and is one message rather than a designed page.
 * No image slot: a photo the owner has not supplied would be the only thing on
 * it that was not theirs.
 *
 * The variant lifts the block and puts the CTA on a pale plate instead of
 * leaving it as plain type. The field stays the same colour either way — it is
 * the one derived to carry white type, and swapping it for a lighter one to be
 * different would be trading readability for variety.
 */
function textFirst(parts: Parts): Built {
  const t = parts.treatment;
  const field = accentField(parts.palette);
  const lifted = t.alternate;
  const headlineY = lifted ? 0.24 : 0.3;

  const els: CreativeElement[] = [
    text("headline", parts.headline, { x: 0.1, y: headlineY, width: 0.8, height: 0.3 },
      big(parts.tone, 1.05),
      { order: 30, colour: "photoInk", align: "center", valign: "middle" }),
    brandLine(parts, { x: 0.1, y: 0.84, width: 0.8, height: 0.05 }, "photoInk", "center"),
    lifted
      ? pill(parts, { x: 0.19, y: 0.58, width: 0.62, height: 0.07 }, "base", "ink")
      : quietCta(parts, { x: 0.12, y: 0.63, width: 0.76, height: 0.08 }, "photoInk", "center"),
    ...mark(parts, { x: 0.43, y: 0.75, width: 0.14, height: 0.06 }),
  ];

  if (parts.label) {
    els.push(
      eyebrow(parts.label, { x: 0.1, y: headlineY - 0.065, width: 0.8, height: 0.04 }, "photoInk", "center"),
    );
  }

  return { background: { kind: "solid", colour: field }, elements: els };
}

/** Every family, by the id the creative is stored under. */
const LAYOUTS: Record<TemplateId, (parts: Parts) => Built> = {
  "photo-band": productHero,
  "type-poster": typePoster,
  "text-first": textFirst,
  editorial,
  "bold-type": boldType,
  closeup,
  split,
  collage,
  "menu-card": menuCard,
  question,
  minimal,
  local,
  festive,
};


/* --------------------------------- compose -------------------------------- */

export interface ComposeOptions {
  /**
   * The photographs to build around, when there are any.
   *
   * A collage day asks for three and every other photo family asks for one —
   * see `photosWanted`. Handed fewer than it asked for, a layout draws the
   * slots it can fill and leaves the rest empty rather than inventing filler.
   */
  images?: readonly AssetRef[];
  /**
   * The photograph to build around, when there is one.
   *
   * Absent, the creative starts with an empty slot and a typographic layout.
   * That is the deliberate answer to "what if the restaurant has no photo":
   * the alternative is a stock picture of somebody else's nasi lemak presented
   * as theirs, which is the image equivalent of an invented opening hour.
   *
   * The logo is not promoted into this slot — a logo is not a food photograph —
   * and neither is the menu upload, which is usually a PDF and, when it is a
   * photograph, is a photograph of a menu: legible at A4, illegible behind a
   * headline.
   */
  image?: AssetRef | null;
  now?: string;
}

/**
 * One content day in, one creative out. Pure: same inputs, same creative.
 */
export function composeCreative(
  profile: RestaurantProfile,
  planId: string,
  item: ContentItem,
  options: ComposeOptions = {},
): Creative {
  const images = options.images ?? (options.image ? [options.image] : []);
  const now = options.now ?? new Date().toISOString();
  const format = formatFor(item);
  // Whether the *restaurant* has photographs, not whether this day was dealt
  // one. A day whose family wants none — the typographic families ask for zero
  // — must still be recognised as belonging to a restaurant that has pictures,
  // or the composer falls through to the no-photo path and hands back a
  // different layout from the one the pack builder dealt against.
  const template = familyFor(
    item,
    images.length > 0 || profile.photos.length > 0,
  );
  const palette = buildPalette({
    brandColours: profile.brandColours,
    visualStyle: profile.visualStyle,
  });
  const dish = dishInPost(item, profile.bestSellers);

  const parts: Parts = {
    // The hook is the headline. It was written to stop a scroll, which is the
    // same job a headline has, and it has already been through the validator.
    headline: item.hook.trim(),
    label: dish,
    cta: item.cta.trim(),
    brand: profile.name.trim(),
    logo: profile.logo,
    images,
    focals: images.map((_, slot) => focalFor(item, slot)),
    occasion: item.occasion?.name ?? null,
    location: profile.location,
    tone: profile.tone,
    palette,
    // Derived from the day rather than passed in, so the studio and the pack
    // generator compose the same poster for the same day. If this were an
    // option, "Kembali ke asal" could quietly hand the owner a different
    // layout from the one they had.
    treatment: treatmentFor(item),
  };

  const built = LAYOUTS[template](parts);

  return {
    id: item.id,
    planId,
    itemId: item.id,
    day: item.day,
    name: defaultName(item, dish),
    template,
    platform: item.platform satisfies Platform,
    format,
    canvas: CANVAS[format],
    palette,
    background: built.background,
    elements: built.elements,
    generatorVersion: CREATIVE_VERSION,
    createdAt: now,
    updatedAt: now,
    edited: false,
  };
}
