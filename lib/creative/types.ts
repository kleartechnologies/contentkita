import type { AssetRef, Platform } from "../content/types.ts";

/**
 * A creative, as structured data.
 *
 * The whole point of this file is that a finished poster is never a flattened
 * image. It is a document: a canvas, a palette and an ordered list of elements,
 * each of which the owner can still edit, replace or move. A PNG is something
 * this model can be rendered *to* — it is never what is stored.
 *
 * That constraint is what keeps the product honest later. Thirty flattened
 * images would mean an owner who wants to fix one word has to regenerate, and
 * a brand colour change means thirty regenerations. Thirty documents means
 * both are edits.
 *
 * ## Why coordinates are fractions
 *
 * Every `Box` is a fraction of the canvas — `0.5` is half the width — and every
 * font size is a fraction of the canvas *width*, which is the dimension text
 * wraps against. Sizing by width rather than height is what lets one number
 * read the same on a 1080x1080 square and a 1080x1920 story.
 * A template written once therefore lays out correctly on a 1080x1080 Instagram
 * square and a 1080x1920 story without a second set of numbers, and rendering
 * at export resolution is a multiplication rather than a re-layout. Absolute
 * pixels would have meant one template per format, which is how a small
 * template set turns into a large one.
 */

/* ---------------------------------- canvas -------------------------------- */

/**
 * The shapes a post is actually published in. Not a free-form width and height:
 * a creative that is not one of these is not a size any platform wants.
 */
export type CreativeFormat = "square" | "portrait" | "story";

export interface Canvas {
  width: number;
  height: number;
}

export const CANVAS: Record<CreativeFormat, Canvas> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

/** Fractions of the canvas, `0` to `1`. See the note at the top of this file. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* --------------------------------- colour --------------------------------- */

/**
 * The six colours a creative is allowed to use.
 *
 * A fixed set rather than free colour-per-element, because the failure mode of
 * generated design is not "too few colours" — it is a poster wearing nine of
 * them. Elements reference these roles, so changing the brand colour changes
 * the whole creative coherently.
 */
export interface Palette {
  /** The page behind everything. */
  base: string;
  /** Cards, plates and bands laid on the base. */
  surface: string;
  /** Body text on `base`. */
  ink: string;
  /** Secondary text on `base`. */
  inkSoft: string;
  /** The brand colour. Buttons, rules, emphasis. */
  accent: string;
  /** Text that sits *on* `accent`, chosen for contrast against it. */
  accentInk: string;
}

export type Background =
  | { kind: "solid"; colour: string }
  /** `angle` is degrees clockwise from vertical: 0 is top-to-bottom. */
  | { kind: "gradient"; from: string; to: string; angle: number };

/* -------------------------------- typography ------------------------------- */

/**
 * Two families, not a font marketplace.
 *
 * Both resolve to a system stack at render time. A web font would have to be
 * fetched, embedded and licensed before it could be drawn into an exported PNG,
 * and none of that buys an owner anything on their first poster.
 */
export type FontFamily = "display" | "body";

export interface TextStyle {
  family: FontFamily;
  weight: number;
  /** Fraction of canvas width. See the note at the top of this file. */
  size: number;
  /** Multiple of the font size. */
  lineHeight: number;
  /** Fraction of the font size, so it scales with it. */
  letterSpacing: number;
  transform: "none" | "uppercase";
}

/* -------------------------------- elements -------------------------------- */

/**
 * What a piece of text is *for*, which is what decides how it is styled and
 * what the editor calls it. Distinct from the text itself, so an owner
 * rewriting a headline still has a headline.
 */
export type TextRole = "headline" | "subheading" | "body" | "cta" | "brand";

export type ElementKind = "text" | "image" | "logo" | "shape";

interface ElementBase {
  id: string;
  /** Draw order, ascending. Lowest is furthest back. */
  order: number;
  box: Box;
}

export interface TextElement extends ElementBase {
  kind: "text";
  role: TextRole;
  text: string;
  style: TextStyle;
  /** A key of `Palette`, resolved at render time. */
  colour: keyof Palette;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  /**
   * Shrink the type until the text fits its box.
   *
   * On by default for anything the owner can rewrite. A hook is written to be
   * read in a feed, not to fit a box, and an owner who types a longer one
   * should get smaller type rather than a poster with the end cut off.
   */
  autoFit: boolean;
  /** A filled pill behind the text. Used for CTAs, `null` everywhere else. */
  plate: { colour: keyof Palette; radius: number; padding: number } | null;
}

export interface ImageElement extends ElementBase {
  kind: "image";
  /** `null` is an empty slot, and is drawn as one. */
  source: AssetRef | null;
  fit: "cover" | "contain";
  /** Corner radius as a fraction of the box's shorter side. */
  radius: number;
  /**
   * A wash laid over the photo so text above it stays readable.
   *
   * Not decoration: white type on an unknown photograph is a coin toss, and
   * the photograph is the owner's, so it cannot be checked in advance.
   */
  scrim: { colour: keyof Palette; opacity: number } | null;
  /** Shown when `source` is null. Says the slot is empty; never fakes a photo. */
  placeholder: string;
}

export interface LogoElement extends ElementBase {
  kind: "logo";
  /** The owner's uploaded logo. Never generated, never substituted. */
  source: AssetRef | null;
}

export interface ShapeElement extends ElementBase {
  kind: "shape";
  fill: keyof Palette;
  radius: number;
  opacity: number;
}

export type CreativeElement =
  | TextElement
  | ImageElement
  | LogoElement
  | ShapeElement;

/* -------------------------------- creative -------------------------------- */

/**
 * The layouts the composer may choose between.
 *
 * Deliberately few. Each one exists because a kind of post needs it, not
 * because a template gallery needs filling.
 */
export type TemplateId = "photo-band" | "type-poster" | "text-first";

export interface Creative {
  /** Same id as the content day it belongs to. One creative per day. */
  id: string;
  planId: string;
  itemId: string;
  day: number;
  /** The owner's filename for this creative, e.g. "Nasi Lemak — Hari 01". */
  name: string;
  template: TemplateId;
  platform: Platform;
  format: CreativeFormat;
  canvas: Canvas;
  palette: Palette;
  background: Background;
  elements: CreativeElement[];
  /**
   * Which build composed this. Bumped when the templates change, so a creative
   * saved by an older build is recognisable rather than silently mixed in.
   */
  generatorVersion: string;
  createdAt: string;
  updatedAt: string;
  /** True once the owner has changed anything. Guards against silent recompose. */
  edited: boolean;
}

export const CREATIVE_VERSION = "creative-1";

/* --------------------------------- helpers -------------------------------- */

export function isText(el: CreativeElement): el is TextElement {
  return el.kind === "text";
}

export function isImage(el: CreativeElement): el is ImageElement {
  return el.kind === "image";
}

export function isLogo(el: CreativeElement): el is LogoElement {
  return el.kind === "logo";
}

/** Elements in the order they should be drawn: back to front. */
export function ordered(creative: Creative): CreativeElement[] {
  return [...creative.elements].sort((a, b) => a.order - b.order);
}

/** The one element of a role, or null. Roles are unique within a template. */
export function textOfRole(
  creative: Creative,
  role: TextRole,
): TextElement | null {
  for (const el of creative.elements) {
    if (isText(el) && el.role === role) return el;
  }
  return null;
}
