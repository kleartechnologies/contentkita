import { CATEGORY_META } from "../content/categories.ts";
import type {
  AssetRef,
  BrandTone,
  ContentCategory,
  ContentItem,
  Platform,
  RestaurantProfile,
} from "../content/types.ts";
import { buildPalette, accentField } from "./palette.ts";
import { clampWords } from "./text.ts";
import {
  CANVAS,
  CREATIVE_VERSION,
  type Background,
  type Box,
  type Creative,
  type CreativeElement,
  type CreativeFormat,
  type Palette,
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
 * `photo-band` needs a real photograph and is only reachable when one exists —
 * see `ComposeOptions.image`. WhatsApp Status is read at arm's length on a
 * phone and is text-first by nature, so it gets the type-led layout regardless.
 */
export function templateFor(item: ContentItem, image: AssetRef | null): TemplateId {
  if (item.platform === "whatsapp") return "text-first";
  return image ? "photo-band" : "type-poster";
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
  return {
    deeper: n % 2 === 1,
    centreCta: Math.floor(n / 2) % 2 === 1,
    alternate: n % 3 === 2,
  };
}

/** Where the CTA pill sits, given the treatment. The same size either way. */
function ctaBox(t: Treatment, y: number): Box {
  const width = 0.62;
  return { x: t.centreCta ? (1 - width) / 2 : M, y, width, height: 0.07 };
}

/** The page colour for this treatment. Both carry `ink` at full contrast. */
function pageColour(palette: Palette, t: Treatment): string {
  return t.deeper ? palette.surface : palette.base;
}

/* -------------------------------- templates ------------------------------- */

interface Parts {
  headline: string;
  /** The dish, or null. Rendered as the small label above the headline. */
  label: string | null;
  cta: string;
  brand: string;
  logo: AssetRef | null;
  image: AssetRef | null;
  tone: BrandTone;
  palette: Palette;
  treatment: Treatment;
}

/**
 * A photograph and the type that sits with it.
 *
 * Two arrangements, and the difference between them is where the photograph
 * stops. In `full` the picture is the whole page and the type sits in the band
 * at the bottom that the scrim darkens. In `band` the picture takes the top
 * half and the type sits below it on the page itself.
 *
 * Those are the two that can be done safely. A third — type at the *top* of a
 * full-bleed photo — is missing on purpose: the scrim is transparent up there
 * so the food is still the picture, and light type on an unknown photograph is
 * a coin toss we would be flipping on the owner's behalf.
 */
function photoBand(parts: Parts): {
  background: Background;
  elements: CreativeElement[];
} {
  const t = parts.treatment;
  const page = pageColour(parts.palette, t);

  if (!t.alternate) {
    const els: CreativeElement[] = [
      {
        kind: "image",
        id: "photo",
        order: 0,
        box: { x: 0, y: 0, width: 1, height: 1 },
        source: parts.image,
        fit: "cover",
        radius: 0,
        // Weighted to the lower half, where the type sits. A flat wash over the
        // whole photo would dull the food, which is the reason for the photo.
        scrim: { colour: "base", opacity: 0.55 },
        placeholder: "Letak gambar makanan anda di sini",
      },
      text("headline", parts.headline, { x: M, y: 0.6, width: 1 - M * 2, height: 0.2 },
        headlineStyle(parts.tone),
        { order: 30, colour: "accentInk", valign: "bottom" }),
    ];

    if (parts.label) {
      els.push(
        text("subheading", parts.label, { x: M, y: 0.545, width: 1 - M * 2, height: 0.04 },
          LABEL_STYLE, { order: 25, colour: "accentInk" }),
      );
    }

    els.push(
      text("cta", clampWords(parts.cta, 46), ctaBox(t, 0.845),
        CTA_STYLE,
        {
          order: 40,
          colour: "accentInk",
          align: "center",
          valign: "middle",
          plate: { colour: "accent", radius: 0.5, padding: 0.03 },
        }),
      text("brand", parts.brand, { x: parts.logo ? 0.24 : M, y: 0.06, width: 0.6, height: 0.08 },
        BRAND_STYLE, { order: 20, colour: "accentInk", valign: "middle" }),
    );

    if (parts.logo) {
      els.push({
        kind: "logo",
        id: "logo",
        order: 20,
        box: { x: M, y: 0.06, width: 0.14, height: 0.08 },
        source: parts.logo,
      });
    }

    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // Banded: the photograph ends at the halfway line and every word below it is
  // on the page colour, so no scrim is needed and none is drawn.
  const els: CreativeElement[] = [
    {
      kind: "image",
      id: "photo",
      order: 0,
      box: { x: 0, y: 0, width: 1, height: 0.5 },
      source: parts.image,
      fit: "cover",
      radius: 0,
      scrim: null,
      placeholder: "Letak gambar makanan anda di sini",
    },
    text("brand", parts.brand, { x: parts.logo ? 0.24 : M, y: 0.545, width: 0.6, height: 0.07 },
      BRAND_STYLE, { order: 20, colour: "inkSoft", valign: "middle" }),
    text("headline", parts.headline, { x: M, y: 0.68, width: 1 - M * 2, height: 0.15 },
      headlineStyle(parts.tone), { order: 30, colour: "ink" }),
    text("cta", clampWords(parts.cta, 46), ctaBox(t, 0.855),
      CTA_STYLE,
      {
        order: 40,
        colour: "accentInk",
        align: "center",
        valign: "middle",
        plate: { colour: "accent", radius: 0.5, padding: 0.03 },
      }),
  ];

  if (parts.label) {
    els.push(
      text("subheading", parts.label, { x: M, y: 0.635, width: 1 - M * 2, height: 0.04 },
        LABEL_STYLE, { order: 25, colour: "accent" }),
    );
  }

  if (parts.logo) {
    els.push({
      kind: "logo",
      id: "logo",
      order: 20,
      box: { x: M, y: 0.545, width: 0.14, height: 0.07 },
      source: parts.logo,
    });
  }

  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Type first, with an empty slot the owner can drop a photograph into.
 *
 * The variant swaps the order of the two blocks: picture over words, or words
 * over picture. Both keep the CTA on the same line at the foot of the page, so
 * a month of these still reads as one set rather than as thirty one-offs.
 */
function typePoster(parts: Parts): {
  background: Background;
  elements: CreativeElement[];
} {
  const t = parts.treatment;
  const wordsFirst = t.alternate;

  const photoY = wordsFirst ? 0.47 : 0.17;
  const labelY = wordsFirst ? 0.185 : 0.53;
  const headlineY = wordsFirst ? 0.23 : 0.575;

  const els: CreativeElement[] = [
    // A rule in the brand colour along the top. One decisive piece of brand
    // that costs nothing and does not depend on the owner having uploaded
    // anything at all.
    {
      kind: "shape",
      id: "rule",
      order: 5,
      box: { x: 0, y: 0, width: 1, height: 0.014 },
      fill: "accent",
      radius: 0,
      opacity: 1,
    },
    {
      kind: "image",
      id: "photo",
      order: 10,
      box: { x: M, y: photoY, width: 1 - M * 2, height: 0.34 },
      source: parts.image,
      fit: "cover",
      radius: 0.06,
      scrim: null,
      placeholder: "Letak gambar makanan anda di sini",
    },
    text("headline", parts.headline, { x: M, y: headlineY, width: 1 - M * 2, height: 0.21 },
      headlineStyle(parts.tone), { order: 30, colour: "ink" }),
    text("cta", clampWords(parts.cta, 46), ctaBox(t, 0.845),
      CTA_STYLE,
      {
        order: 40,
        colour: "accentInk",
        align: "center",
        valign: "middle",
        plate: { colour: "accent", radius: 0.5, padding: 0.03 },
      }),
    text("brand", parts.brand, { x: parts.logo ? 0.24 : M, y: 0.055, width: 0.6, height: 0.08 },
      BRAND_STYLE, { order: 20, colour: "ink", valign: "middle" }),
  ];

  if (parts.label) {
    els.push(
      text("subheading", parts.label, { x: M, y: labelY, width: 1 - M * 2, height: 0.04 },
        LABEL_STYLE, { order: 25, colour: "accent" }),
    );
  }

  if (parts.logo) {
    els.push({
      kind: "logo",
      id: "logo",
      order: 20,
      box: { x: M, y: 0.055, width: 0.14, height: 0.08 },
      source: parts.logo,
    });
  }

  return {
    background: { kind: "solid", colour: pageColour(parts.palette, t) },
    elements: els,
  };
}

/**
 * A full-bleed colour field with the hook set large and centred.
 *
 * For WhatsApp Status, which is glanced at on a phone held at arm's length. No
 * image slot: a Status is a single message, and a photo the owner has not
 * supplied would be the only thing on it that was not theirs.
 *
 * The variant lifts the block and puts the CTA on a pale plate instead of
 * leaving it as plain type. The field stays the same colour either way — it is
 * the one derived to carry white type, and swapping it for a lighter one to be
 * different would be trading readability for variety.
 */
function textFirst(parts: Parts): {
  background: Background;
  elements: CreativeElement[];
} {
  const t = parts.treatment;
  const field = accentField(parts.palette);
  const lifted = t.alternate;
  const headlineY = lifted ? 0.24 : 0.3;

  const els: CreativeElement[] = [
    text("headline", parts.headline, { x: 0.1, y: headlineY, width: 0.8, height: 0.3 },
      { ...headlineStyle(parts.tone), size: headlineStyle(parts.tone).size * 1.05 },
      { order: 30, colour: "accentInk", align: "center", valign: "middle" }),
    text("brand", parts.brand, { x: 0.1, y: 0.84, width: 0.8, height: 0.05 },
      BRAND_STYLE, { order: 20, colour: "accentInk", align: "center", valign: "middle" }),
  ];

  if (lifted) {
    els.push(
      text("cta", clampWords(parts.cta, 46), { x: 0.19, y: 0.58, width: 0.62, height: 0.07 },
        CTA_STYLE,
        {
          order: 40,
          // `base` is the page colour the palette already guarantees `ink` on.
          colour: "ink",
          align: "center",
          valign: "middle",
          plate: { colour: "base", radius: 0.5, padding: 0.03 },
        }),
    );
  } else {
    els.push(
      text("cta", clampWords(parts.cta, 60), { x: 0.12, y: 0.63, width: 0.76, height: 0.08 },
        CTA_STYLE, { order: 40, colour: "accentInk", align: "center", valign: "middle" }),
    );
  }

  if (parts.label) {
    els.push(
      text("subheading", parts.label, { x: 0.1, y: headlineY - 0.065, width: 0.8, height: 0.04 },
        LABEL_STYLE, { order: 25, colour: "accentInk", align: "center" }),
    );
  }

  if (parts.logo) {
    els.push({
      kind: "logo",
      id: "logo",
      order: 20,
      box: { x: 0.43, y: 0.75, width: 0.14, height: 0.06 },
      source: parts.logo,
    });
  }

  return { background: { kind: "solid", colour: field }, elements: els };
}

/* --------------------------------- compose -------------------------------- */

export interface ComposeOptions {
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
  const image = options.image ?? null;
  const now = options.now ?? new Date().toISOString();
  const format = formatFor(item);
  const template = templateFor(item, image);
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
    image,
    tone: profile.tone,
    palette,
    // Derived from the day rather than passed in, so the studio and the pack
    // generator compose the same poster for the same day. If this were an
    // option, "Kembali ke asal" could quietly hand the owner a different
    // layout from the one they had.
    treatment: treatmentFor(item),
  };

  const built =
    template === "photo-band"
      ? photoBand(parts)
      : template === "text-first"
        ? textFirst(parts)
        : typePoster(parts);

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
