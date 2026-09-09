import { CATEGORY_META } from "../content/categories.ts";
import type {
  AssetRef,
  BrandTone,
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
 * The shape this post should be published in.
 *
 * Platform first, because that is what decides the aspect ratio a feed will
 * crop to. A Reels day on Instagram is portrait even though the rest of
 * Instagram is square, because a square Reel wastes half the screen.
 */
export function formatFor(item: ContentItem): CreativeFormat {
  if (item.platform === "whatsapp" || item.platform === "tiktok") return "story";
  if (item.platform === "instagram" && item.category === "reels") return "portrait";
  return "square";
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

/* -------------------------------- templates ------------------------------- */

const M = 0.07; // Page margin, as a fraction of the width.

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
}

function photoBand(parts: Parts): {
  background: Background;
  elements: CreativeElement[];
} {
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
    text("cta", clampWords(parts.cta, 46), { x: M, y: 0.845, width: 0.62, height: 0.07 },
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

  return { background: { kind: "solid", colour: parts.palette.base }, elements: els };
}

function typePoster(parts: Parts): {
  background: Background;
  elements: CreativeElement[];
} {
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
      box: { x: M, y: 0.17, width: 1 - M * 2, height: 0.34 },
      source: null,
      fit: "cover",
      radius: 0.06,
      scrim: null,
      placeholder: "Letak gambar makanan anda di sini",
    },
    text("headline", parts.headline, { x: M, y: 0.575, width: 1 - M * 2, height: 0.21 },
      headlineStyle(parts.tone), { order: 30, colour: "ink" }),
    text("cta", clampWords(parts.cta, 46), { x: M, y: 0.845, width: 0.62, height: 0.07 },
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
      text("subheading", parts.label, { x: M, y: 0.53, width: 1 - M * 2, height: 0.04 },
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

  return { background: { kind: "solid", colour: parts.palette.base }, elements: els };
}

/**
 * A full-bleed colour field with the hook set large and centred.
 *
 * For WhatsApp Status, which is glanced at on a phone held at arm's length. No
 * image slot: a Status is a single message, and a photo the owner has not
 * supplied would be the only thing on it that was not theirs.
 */
function textFirst(parts: Parts): {
  background: Background;
  elements: CreativeElement[];
} {
  const field = accentField(parts.palette);
  const els: CreativeElement[] = [
    text("headline", parts.headline, { x: 0.1, y: 0.3, width: 0.8, height: 0.3 },
      { ...headlineStyle(parts.tone), size: headlineStyle(parts.tone).size * 1.05 },
      { order: 30, colour: "accentInk", align: "center", valign: "middle" }),
    text("cta", clampWords(parts.cta, 60), { x: 0.12, y: 0.63, width: 0.76, height: 0.08 },
      CTA_STYLE, { order: 40, colour: "accentInk", align: "center", valign: "middle" }),
    text("brand", parts.brand, { x: 0.1, y: 0.84, width: 0.8, height: 0.05 },
      BRAND_STYLE, { order: 20, colour: "accentInk", align: "center", valign: "middle" }),
  ];

  if (parts.label) {
    els.push(
      text("subheading", parts.label, { x: 0.1, y: 0.235, width: 0.8, height: 0.04 },
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
