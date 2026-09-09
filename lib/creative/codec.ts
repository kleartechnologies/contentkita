import type { AssetRef, Platform } from "../content/types.ts";
import {
  CANVAS,
  CREATIVE_VERSION,
  type Background,
  type Box,
  type Creative,
  type CreativeElement,
  type CreativeFormat,
  type ImageElement,
  type LogoElement,
  type Palette,
  type ShapeElement,
  type TemplateId,
  type TextElement,
  type TextRole,
  type TextStyle,
} from "./types.ts";

/**
 * The wire format for a creative.
 *
 * Same contract as `lib/firebase/codecs.ts`: encoding is total, decoding is
 * defensive, and a document that cannot be trusted decodes to `null` so the
 * caller composes a fresh creative rather than rendering a broken one. A
 * half-decoded poster is worse than no poster, because the owner would post it.
 *
 * Firestore rejects `undefined`, so every optional field is written explicitly
 * as `null`.
 */

/* ------------------------------- primitives ------------------------------- */

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Fractions outside 0-1 are a corrupt document, not a creative decision. */
function fraction(value: unknown, fallback: number): number {
  const n = num(value, fallback);
  return Math.min(Math.max(n, -1), 2);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function colourKey(value: unknown): keyof Palette {
  return oneOf(
    value,
    ["base", "surface", "ink", "inkSoft", "accent", "accentInk"] as const,
    "ink",
  );
}

function box(value: unknown): Box {
  const d = (value ?? {}) as Record<string, unknown>;
  return {
    x: fraction(d.x, 0),
    y: fraction(d.y, 0),
    width: fraction(d.width, 1),
    height: fraction(d.height, 0.1),
  };
}

function asset(value: unknown): AssetRef | null {
  if (typeof value !== "object" || value === null) return null;
  const d = value as Record<string, unknown>;
  const path = str(d.path).trim();
  if (!path) return null;
  return {
    path,
    url: str(d.url),
    name: str(d.name),
    contentType: str(d.contentType),
    size: num(d.size, 0),
    uploadedAt: str(d.uploadedAt),
  };
}

function encodeAsset(ref: AssetRef | null): AssetRef | null {
  return ref
    ? {
        path: ref.path,
        url: ref.url,
        name: ref.name,
        contentType: ref.contentType,
        size: ref.size,
        uploadedAt: ref.uploadedAt,
      }
    : null;
}

/* ------------------------------- sub-objects ------------------------------ */

function textStyle(value: unknown): TextStyle {
  const d = (value ?? {}) as Record<string, unknown>;
  return {
    family: oneOf(d.family, ["display", "body"] as const, "body"),
    weight: Math.min(Math.max(num(d.weight, 700), 100), 900),
    // A size of zero renders nothing and a size of one renders a single glyph
    // the height of the poster; both are corruption rather than design.
    size: Math.min(Math.max(num(d.size, 0.04), 0.005), 0.4),
    lineHeight: Math.min(Math.max(num(d.lineHeight, 1.2), 0.7), 3),
    letterSpacing: Math.min(Math.max(num(d.letterSpacing, 0), -0.2), 0.5),
    transform: oneOf(d.transform, ["none", "uppercase"] as const, "none"),
  };
}

function palette(value: unknown): Palette {
  const d = (value ?? {}) as Record<string, unknown>;
  return {
    base: str(d.base, "#FFFFFF"),
    surface: str(d.surface, "#F1EEEA"),
    ink: str(d.ink, "#1A1614"),
    inkSoft: str(d.inkSoft, "#6B625B"),
    accent: str(d.accent, "#B45309"),
    accentInk: str(d.accentInk, "#FFFFFF"),
  };
}

function background(value: unknown): Background {
  const d = (value ?? {}) as Record<string, unknown>;
  if (d.kind === "gradient") {
    return {
      kind: "gradient",
      from: str(d.from, "#FFFFFF"),
      to: str(d.to, "#F1EEEA"),
      angle: num(d.angle, 0),
    };
  }
  return { kind: "solid", colour: str(d.colour, "#FFFFFF") };
}

/* -------------------------------- elements -------------------------------- */

const TEXT_ROLES: readonly TextRole[] = [
  "headline",
  "subheading",
  "body",
  "cta",
  "brand",
];

function decodeElement(value: unknown): CreativeElement | null {
  if (typeof value !== "object" || value === null) return null;
  const d = value as Record<string, unknown>;
  const id = str(d.id).trim();
  if (!id) return null;

  const common = { id, order: num(d.order, 0), box: box(d.box) };

  switch (d.kind) {
    case "text": {
      const plate = d.plate;
      const el: TextElement = {
        ...common,
        kind: "text",
        role: oneOf(d.role, TEXT_ROLES, "body"),
        text: str(d.text),
        style: textStyle(d.style),
        colour: colourKey(d.colour),
        align: oneOf(d.align, ["left", "center", "right"] as const, "left"),
        valign: oneOf(d.valign, ["top", "middle", "bottom"] as const, "top"),
        autoFit: d.autoFit !== false,
        plate:
          typeof plate === "object" && plate !== null
            ? {
                colour: colourKey((plate as Record<string, unknown>).colour),
                radius: num((plate as Record<string, unknown>).radius, 0.5),
                padding: num((plate as Record<string, unknown>).padding, 0.03),
              }
            : null,
      };
      return el;
    }
    case "image": {
      const scrim = d.scrim;
      const el: ImageElement = {
        ...common,
        kind: "image",
        source: asset(d.source),
        fit: oneOf(d.fit, ["cover", "contain"] as const, "cover"),
        radius: num(d.radius, 0),
        scrim:
          typeof scrim === "object" && scrim !== null
            ? {
                colour: colourKey((scrim as Record<string, unknown>).colour),
                opacity: Math.min(
                  Math.max(num((scrim as Record<string, unknown>).opacity, 0.5), 0),
                  1,
                ),
              }
            : null,
        placeholder: str(d.placeholder),
      };
      return el;
    }
    case "logo": {
      const el: LogoElement = { ...common, kind: "logo", source: asset(d.source) };
      return el;
    }
    case "shape": {
      const el: ShapeElement = {
        ...common,
        kind: "shape",
        fill: colourKey(d.fill),
        radius: num(d.radius, 0),
        opacity: Math.min(Math.max(num(d.opacity, 1), 0), 1),
      };
      return el;
    }
    default:
      return null;
  }
}

function encodeElement(el: CreativeElement): Record<string, unknown> {
  const common = {
    id: el.id,
    kind: el.kind,
    order: el.order,
    box: { x: el.box.x, y: el.box.y, width: el.box.width, height: el.box.height },
  };
  switch (el.kind) {
    case "text":
      return {
        ...common,
        role: el.role,
        text: el.text,
        style: { ...el.style },
        colour: el.colour,
        align: el.align,
        valign: el.valign,
        autoFit: el.autoFit,
        plate: el.plate ? { ...el.plate } : null,
      };
    case "image":
      return {
        ...common,
        source: encodeAsset(el.source),
        fit: el.fit,
        radius: el.radius,
        scrim: el.scrim ? { ...el.scrim } : null,
        placeholder: el.placeholder,
      };
    case "logo":
      return { ...common, source: encodeAsset(el.source) };
    case "shape":
      return { ...common, fill: el.fill, radius: el.radius, opacity: el.opacity };
  }
}

/* -------------------------------- creative -------------------------------- */

export interface CreativeDoc {
  ownerId: string;
  creativeId: string;
  planId: string;
  itemId: string;
  day: number;
  name: string;
  template: string;
  platform: string;
  format: string;
  canvas: { width: number; height: number };
  palette: Palette;
  background: Background;
  elements: Record<string, unknown>[];
  generatorVersion: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

export function encodeCreative(
  creative: Creative,
  ownerId: string,
  now = new Date().toISOString(),
): CreativeDoc {
  return {
    ownerId,
    creativeId: creative.id,
    planId: creative.planId,
    itemId: creative.itemId,
    day: creative.day,
    name: creative.name,
    template: creative.template,
    platform: creative.platform,
    format: creative.format,
    canvas: { ...creative.canvas },
    palette: { ...creative.palette },
    background: { ...creative.background },
    elements: creative.elements.map(encodeElement),
    generatorVersion: creative.generatorVersion,
    createdAt: creative.createdAt || now,
    updatedAt: now,
    edited: creative.edited,
  };
}

const FORMATS: readonly CreativeFormat[] = ["square", "portrait", "story"];
const TEMPLATES: readonly TemplateId[] = ["photo-band", "type-poster", "text-first"];
const PLATFORMS: readonly Platform[] = [
  "instagram",
  "tiktok",
  "facebook",
  "whatsapp",
];

export function decodeCreative(data: unknown, itemId: string): Creative | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.elements)) return null;

  const elements: CreativeElement[] = [];
  for (const raw of d.elements) {
    const el = decodeElement(raw);
    // One unreadable element makes the layout untrustworthy. Better to compose
    // a fresh creative than to render a poster with a hole where a headline was.
    if (!el) return null;
    elements.push(el);
  }
  if (elements.length === 0) return null;

  const format = oneOf(d.format, FORMATS, "square");
  const stored = d.canvas as Record<string, unknown> | undefined;
  const now = new Date().toISOString();

  return {
    id: str(d.creativeId, itemId),
    planId: str(d.planId),
    itemId: str(d.itemId, itemId),
    day: Math.max(num(d.day, 1), 1),
    name: str(d.name).trim() || "Creative",
    template: oneOf(d.template, TEMPLATES, "type-poster"),
    platform: oneOf(d.platform, PLATFORMS, "instagram"),
    format,
    // A stored canvas is honoured only if it is a real size; otherwise the
    // format's own dimensions win, so an old or corrupt document still renders.
    canvas: {
      width: Math.max(num(stored?.width, CANVAS[format].width), 1),
      height: Math.max(num(stored?.height, CANVAS[format].height), 1),
    },
    palette: palette(d.palette),
    background: background(d.background),
    elements,
    generatorVersion: str(d.generatorVersion, CREATIVE_VERSION),
    createdAt: str(d.createdAt, now),
    updatedAt: str(d.updatedAt, now),
    edited: d.edited === true,
  };
}

/* --------------------------------- edits ---------------------------------- */

/** Replaces one element and leaves every other one exactly as it was. */
export function replaceElement(
  creative: Creative,
  next: CreativeElement,
): Creative {
  return {
    ...creative,
    edited: true,
    elements: creative.elements.map((el) => (el.id === next.id ? next : el)),
  };
}

/** Rewrites the text of one element, keeping its style, box and order. */
export function editText(
  creative: Creative,
  id: string,
  text: string,
): Creative {
  const target = creative.elements.find((el) => el.id === id);
  if (!target || target.kind !== "text") return creative;
  return replaceElement(creative, { ...target, text });
}

/**
 * Puts an upload into the image slot, or clears it.
 *
 * Clearing is a first-class action: an owner who decides the photo was wrong
 * gets the empty slot back, not the previous photo they were trying to remove.
 */
export function setImage(
  creative: Creative,
  id: string,
  source: AssetRef | null,
): Creative {
  const target = creative.elements.find((el) => el.id === id);
  if (!target || (target.kind !== "image" && target.kind !== "logo")) {
    return creative;
  }
  return replaceElement(creative, { ...target, source });
}
