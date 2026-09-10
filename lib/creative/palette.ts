import type { VisualStyle } from "../content/types.ts";
import type { Palette } from "./types.ts";

/**
 * Turning what the owner typed about their colours into a palette that renders.
 *
 * `brandColours` is a free-text field. Owners write "merah dan kuning", or
 * "#C1272D", or "warna kayu, coklat", or nothing at all. None of that can be
 * handed to a canvas, and guessing wrongly is worse than not guessing: a poster
 * in the wrong colours is one the owner will not post.
 *
 * So the order is strict, and each step is a fact rather than a preference:
 *
 *   1. A hex code the owner wrote is exactly what they meant. Use it.
 *   2. A colour *word* the owner wrote is what they meant, in a shade we pick.
 *   3. No colour information at all falls back to the `visualStyle` they chose
 *      from a fixed list — which is a real answer they gave, not an invention.
 *
 * Everything else in the palette is derived from that one accent, so the whole
 * creative moves together when it changes.
 */

/* --------------------------------- colour --------------------------------- */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#abc`, `#aabbcc`. Anything else is not a colour and returns null. */
export function parseHex(value: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const hex = m[1];
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Relative luminance, per WCAG 2.1.
 *
 * Used for one decision only: whether text on the accent should be white or
 * near-black. Doing that by eye is how generated design ends up with white
 * type on a yellow button.
 */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 26, g: 22, b: 20 };

/** Whichever of white or near-black is more readable on `on`. */
export function readableOn(on: Rgb): string {
  return contrast(WHITE, on) >= contrast(NEAR_BLACK, on)
    ? toHex(WHITE)
    : toHex(NEAR_BLACK);
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

/**
 * Darkens a colour until white text on it clears `ratio`.
 *
 * The accent an owner picks is often a mid-tone that fails contrast as a
 * headline colour. Rather than silently substituting a different colour, this
 * keeps their hue and takes it far enough to be readable.
 */
export function darkenUntilReadable(colour: Rgb, ratio = 4.5): Rgb {
  let out = colour;
  for (let i = 0; i < 12 && contrast(WHITE, out) < ratio; i++) {
    out = mix(out, NEAR_BLACK, 0.12);
  }
  return out;
}

/** The same move in the other direction, for a dark page. */
export function lightenUntilReadable(colour: Rgb, ratio = 4.5): Rgb {
  let out = colour;
  for (let i = 0; i < 12 && contrast(NEAR_BLACK, out) < ratio; i++) {
    out = mix(out, WHITE, 0.12);
  }
  return out;
}

/**
 * An accent that text can actually sit on.
 *
 * A mid-tone — a grey, a mid-blue, most of the colours people describe as
 * "our brand colour" — is the one case where neither white nor near-black
 * clears 4.5:1, because a mid-tone is equidistant from both. The accent is a
 * button fill, so failing here means a CTA nobody can read. The hue is kept
 * and taken away from the middle, in whichever direction the page is not.
 */
function contrastSafe(colour: Rgb, dark: boolean): Rgb {
  const best = Math.max(contrast(WHITE, colour), contrast(NEAR_BLACK, colour));
  if (best >= 4.5) return colour;
  return dark ? lightenUntilReadable(colour) : darkenUntilReadable(colour);
}

/* ------------------------------ colour words ------------------------------ */

/**
 * Malay and English colour words, and the shade each one becomes.
 *
 * The shades lean deep and saturated rather than bright: these are printed
 * behind white type most of the time, and a bright one fails contrast the
 * moment it is used that way.
 *
 * Longest first, so "merah jambu" is matched before "merah".
 */
const COLOUR_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmerah\s+jambu\b|\bpink\b/i, "#C2185B"],
  [/\bbiru\s+laut\b|\bnavy\b/i, "#1B3A5C"],
  [/\bhijau\s+tua\b/i, "#1F4A32"],
  [/\bmerah\b|\bred\b/i, "#B3261E"],
  [/\bkuning\b|\byellow\b/i, "#C98A00"],
  [/\bhijau\b|\bgreen\b/i, "#2E6B45"],
  [/\bbiru\b|\bblue\b/i, "#1F5C8B"],
  [/\bcoklat\b|\bcokelat\b|\bbrown\b/i, "#6B4423"],
  [/\boren\b|\borange\b|\bjingga\b/i, "#C25E14"],
  [/\bungu\b|\bpurple\b/i, "#5B3A7E"],
  [/\bhitam\b|\bblack\b/i, "#22201E"],
  [/\bputih\b|\bwhite\b/i, "#8A8580"],
  [/\bkelabu\b|\bgrey\b|\bgray\b/i, "#57534E"],
  [/\bemas\b|\bgold\b/i, "#A87B21"],
  [/\bkrim\b|\bcream\b|\bbeige\b/i, "#A08A6B"],
  [/\bturquoise\b|\bteal\b/i, "#1D6B6B"],
];

/**
 * The accent for each `visualStyle`, used when the owner said nothing about
 * colour. These are the six looks they chose from during onboarding, so this is
 * still their answer — just a coarser one.
 */
const STYLE_ACCENT: Record<VisualStyle, string> = {
  hangat: "#B45309",
  bersih: "#1F5C8B",
  gelap: "#2A2523",
  cerah: "#C25E14",
  kampung: "#6B4423",
  moden: "#22201E",
};

/** The page colour each look sits on. Warm looks get warm paper. */
const STYLE_BASE: Record<VisualStyle, string> = {
  hangat: "#FDF6EC",
  bersih: "#FFFFFF",
  gelap: "#1A1614",
  cerah: "#FFFBF2",
  kampung: "#F7EFE2",
  moden: "#F5F4F2",
};

/**
 * The first colour the owner named, or null.
 *
 * Hex wins over words, because someone who typed a hex code has a brand
 * guideline and we should not second-guess it.
 */
export function accentFrom(brandColours: string): string | null {
  const hex = /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(brandColours);
  if (hex) {
    const parsed = parseHex(hex[0]);
    if (parsed) return toHex(parsed);
  }
  for (const [pattern, colour] of COLOUR_WORDS) {
    if (pattern.test(brandColours)) return colour;
  }
  return null;
}

/* -------------------------------- palettes -------------------------------- */

export interface PaletteInput {
  brandColours: string;
  visualStyle: VisualStyle;
}

/**
 * The six colours the templates draw with.
 *
 * `dark` decides which way round the page runs. It is taken from the visual
 * style rather than from the accent, because "gelap" is the owner saying they
 * want a dark look — and a dark accent on a light page is a different, valid
 * thing.
 */
/**
 * The two colours that are the same on every palette.
 *
 * See `Palette.photoScrim`. These are not brand colours and are deliberately
 * not derived from one: they exist to guarantee a contrast ratio over an image
 * nobody has seen.
 */
const ON_PHOTO = { photoScrim: "#100E0C", photoInk: "#FFFFFF" } as const;

export function buildPalette(input: PaletteInput): Palette {
  const dark = input.visualStyle === "gelap";
  const named = accentFrom(input.brandColours);
  const accentHex = named ?? STYLE_ACCENT[input.visualStyle];
  const accent = parseHex(accentHex) ?? { r: 180, g: 83, b: 9 };

  const base = STYLE_BASE[input.visualStyle];

  if (dark) {
    // On a dark page the accent has to go the other way: a deep brand colour
    // disappears into the background, so it is lightened rather than darkened.
    const lifted = contrast(accent, { r: 26, g: 22, b: 20 }) < 3
      ? mix(accent, WHITE, 0.45)
      : accent;
    const safe = contrastSafe(lifted, true);
    return {
      base,
      surface: "#2A2523",
      ink: "#F7F3EE",
      inkSoft: "#BFB6AC",
      accent: toHex(safe),
      accentInk: readableOn(safe),
      // On a dark page the "deep" ground is the accent taken *down* from the
      // lifted button colour — still readable under white type, but a distinctly
      // different field from the button itself.
      accentDeep: toHex(darkenUntilReadable(mix(accent, NEAR_BLACK, 0.25), 7)),
      // And the "pale" ground is not pale at all: it is the page lifted a little
      // towards the brand hue. A cream tint on a dark month would be a hole.
      tint: toHex(mix(parseHex(base) ?? NEAR_BLACK, safe, 0.16)),
      ...ON_PHOTO,
    };
  }

  const safe = contrastSafe(accent, false);
  return {
    base,
    surface: toHex(mix(parseHex(base) ?? WHITE, NEAR_BLACK, 0.06)),
    ink: "#1A1614",
    inkSoft: "#6B625B",
    accent: toHex(safe),
    accentInk: readableOn(safe),
    accentDeep: toHex(darkenUntilReadable(accent, 7)),
    // 12% of the accent into the page. Enough that the poster next to it on a
    // cream ground is visibly a different page, little enough that `ink` still
    // clears contrast on it without any of the templates having to check.
    tint: toHex(mix(parseHex(base) ?? WHITE, safe, 0.12)),
    ...ON_PHOTO,
  };
}

/**
 * A darker relative of the accent, safe to put white type on.
 *
 * Now just the `accentDeep` role, which is the same colour computed once at
 * palette time instead of at every call site. Kept as a function because
 * creatives saved before the role existed decode without it, and a poster that
 * has been sitting in an owner's account for a month should not lose its
 * background because the palette gained a field.
 */
export function accentField(palette: Palette): string {
  if (palette.accentDeep) return palette.accentDeep;
  const accent = parseHex(palette.accent);
  return accent ? toHex(darkenUntilReadable(accent)) : "#22201E";
}

/**
 * The pale brand ground, for a palette that may predate the role.
 *
 * Same reasoning as `accentField`: derive it rather than let an old creative
 * render with an empty colour string.
 */
export function accentTint(palette: Palette): string {
  if (palette.tint) return palette.tint;
  const accent = parseHex(palette.accent);
  const base = parseHex(palette.base) ?? WHITE;
  return accent ? toHex(mix(base, accent, 0.12)) : palette.base;
}
