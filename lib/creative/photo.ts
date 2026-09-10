/**
 * What can honestly be known about a photograph, and nothing more.
 *
 * M6 composed thirty posters without ever looking at a single picture. Every
 * crop was a table lookup — centre, then a bit above centre, then closer — and
 * the result was exactly what that description predicts: a wide plate shot
 * cropped into the empty half of the table, a 1920x1080 photograph of fried
 * chicken magnified until it read as brown noise, and a flat illustration of a
 * glass of teh tarik stretched full-bleed across a poster where it looked like
 * clip art someone had pasted on.
 *
 * None of those are typography problems and none of them can be fixed by
 * moving text. They are the composer not knowing what it is holding.
 *
 * ## What this is not
 *
 * It is not computer vision, and it must not grow into it. There is no model
 * here, no library, no network call and no subject detection: a `Signature` is
 * what you get from decoding a picture to a 32x32 grid and doing arithmetic on
 * a thousand pixels. That is enough to answer the four questions composition
 * actually asks —
 *
 *   - Is this a photograph or a piece of flat artwork?
 *   - Where in the frame is the thing worth keeping?
 *   - Which part of the frame is calm enough to set type over?
 *   - How close can I go before the owner's phone photograph falls apart?
 *
 * — and it is deliberately incapable of answering anything else. It cannot
 * tell chicken from rendang, so nothing downstream is allowed to claim it can.
 * The only place in the product that knows what a picture *is* remains the
 * filename the owner typed; see `photoNamesDish` in `compose.ts`.
 *
 * ## Why the numbers are computed once and carried
 *
 * `composeCreative` is pure and synchronous, which is what makes a saved
 * poster comparable with a freshly composed one. Decoding an image is neither.
 * So the grid is sampled where a picture is already decoded — in the browser,
 * at upload — and the handful of numbers that come out ride along on the
 * `AssetRef`. Composition stays arithmetic.
 *
 * A picture uploaded before this existed has no signature, and every function
 * here has a defined answer for that: fall back to what M6 did. An owner's
 * existing month does not re-crop itself because we got cleverer.
 */

import type { AssetRef } from "../content/types.ts";
import { coverCrop } from "./render.ts";
import type { Box, Focal, ScrimDirection } from "./types.ts";

/* -------------------------------- the grid -------------------------------- */

/**
 * How coarse the sample is.
 *
 * Thirty-two squared is a thousand cells, which is enough to find a plate in a
 * frame and nowhere near enough to find a face. That asymmetry is the point:
 * the number is chosen to be useful for composition and useless for anything
 * that would need the owner's consent.
 */
export const GRID = 32;

/** The tone map is `TONE * TONE` cells. Coarse on purpose — see `Signature`. */
export const TONE = 4;

/** Where a picture's weight sits, and where it does not. `0` to `1`. */
export type Side = "top" | "bottom" | "left" | "right";

/**
 * A picture, as the few numbers composition is allowed to use.
 *
 * Every field is a fraction or a count, so a signature is a few dozen bytes of
 * JSON that survives Firestore, the codec and a round trip without special
 * handling.
 */
export interface Signature {
  /** Intrinsic pixels. Decides how far a crop may go before it softens. */
  width: number;
  height: number;
  /**
   * Photograph, or flat artwork.
   *
   * The distinction that M6 lacked and paid for. A drawing of a glass of tea
   * on a white field is a perfectly good asset — it is the owner's own, and it
   * is what they have — but it is not a photograph, and every treatment that
   * flatters a photograph (full bleed, a dark wash, type across the bottom
   * third) makes a drawing look like a mistake.
   */
  kind: "photo" | "graphic";
  /** Mean luma, `0` to `1`. A dark picture takes a lighter wash. */
  brightness: number;
  /** Mean saturation, `0` to `1`. */
  colourfulness: number;
  /** True for a black-and-white picture, which does not belong beside colour. */
  monochrome: boolean;
  /**
   * Where the detail is, as a fraction of the frame.
   *
   * The energy-weighted centre of the picture: roughly, where a person's eye
   * goes. Used as the focal point of a crop, so a plate low and left in the
   * frame stays in the poster instead of being cropped off by a centred box.
   */
  focus: { x: number; y: number };
  /**
   * The tightest box that holds the picture's detail.
   *
   * For a photograph this is usually most of the frame and is not very
   * interesting. For a drawing on a white field it is the drawing, which is
   * what lets a graphic be placed at a sensible size instead of floating in
   * its own whitespace.
   */
  subject: Box;
  /**
   * The calmest edge of the frame, or `null` when no edge is calm.
   *
   * Where type can go without fighting the picture. `null` is a real and
   * common answer — a plate that fills the frame has no quiet edge — and it is
   * the answer that keeps a composer from setting a headline over food.
   */
  quiet: Side | null;
  /** Mean luma of the quiet band, when there is one. */
  quietLuma: number;
  /**
   * Mean luma over a four-by-four map of the frame, row-major. Sixteen numbers.
   *
   * The whole picture's brightness is the wrong number to wash type by, and
   * day 19 of the acceptance pack is why: dark wood over most of the frame, a
   * mound of white rice exactly where the headline goes. Averaged, that
   * picture asks for the lightest wash available and then sets white type on
   * white rice. Type sits somewhere, and the crop decides where that somewhere
   * lands in the picture, so the wash has to be able to ask about a region.
   *
   * Sixteen cells is deliberately coarse: enough to tell a bright corner from
   * a dark one, nowhere near enough to be a picture of anything.
   */
  tone: readonly number[];
  /** Mean gradient energy, `0` to `1`. How much texture a close crop finds. */
  detail: number;
}

/* --------------------------------- sampling ------------------------------- */

/** Luma, Rec. 709, `0` to `1`. */
function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Saturation as HSV would define it, `0` to `1`. */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[at];
}

/**
 * The gradient map: how much each cell differs from the cells beside it.
 *
 * A central difference in both directions, clamped at the borders. Cheap, and
 * it is the only measure here that separates "a plate of food" from "a table
 * top" — both may be brown, but only one of them has edges.
 */
function energyOf(lumas: readonly number[], size: number): number[] {
  const at = (x: number, y: number) =>
    lumas[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  const out = new Array<number>(size * size).fill(0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(at(x + 1, y) - at(x - 1, y));
      const dy = Math.abs(at(x, y + 1) - at(x, y - 1));
      out[y * size + x] = Math.min(1, (dx + dy) / 2);
    }
  }
  return out;
}

/* ------------------------------- the reading ------------------------------ */

/**
 * The cells around the outside, two deep.
 *
 * A drawing sits on a plain field and a photograph does not, and the border is
 * where that difference is most reliable — the middle of a photograph of a
 * white plate is as flat as the middle of a drawing, but its edges are a table
 * and a room and a hand, while a drawing's edges are the same colour all the
 * way round.
 */
function borderCells(size: number): number[] {
  const out: number[] = [];
  const ring = 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < ring || y < ring || x >= size - ring || y >= size - ring) {
        out.push(y * size + x);
      }
    }
  }
  return out;
}

/**
 * How much of the frame is flat, and how few colours it holds.
 *
 * Both have to be true before anything is called a graphic. Requiring only a
 * plain border would classify a plate of fried chicken shot from above on a
 * white table as artwork, which would be exactly the wrong way round: the
 * failure this guards against is calling a photograph a drawing and then
 * placing it small on a tinted card, which wastes the single most valuable
 * thing the owner gave us.
 */
function graphicness(
  lumas: readonly number[],
  energy: readonly number[],
  rgb: readonly number[],
  size: number,
): { flatBorder: number; uniformity: number; variety: number } {
  const border = borderCells(size);
  const borderLuma = border.map((i) => lumas[i]);
  const centreLuma = quantile(borderLuma, 0.5);
  const flatBorder =
    mean(border.map((i) => (Math.abs(lumas[i] - centreLuma) < 0.06 && energy[i] < 0.05 ? 1 : 0)));

  const uniformity = mean(energy.map((e) => (e < 0.02 ? 1 : 0)));

  // Colours quantised to 4 bits a channel. A photograph of food runs to
  // hundreds of buckets; a two-colour drawing runs to a handful.
  const buckets = new Set<number>();
  for (let i = 0; i < size * size; i++) {
    const r = rgb[i * 3] >> 4;
    const g = rgb[i * 3 + 1] >> 4;
    const b = rgb[i * 3 + 2] >> 4;
    buckets.add((r << 8) | (g << 4) | b);
  }
  return { flatBorder, uniformity, variety: buckets.size / (size * size) };
}

/**
 * The calmest edge, or `null`.
 *
 * Each of the four bands is a third of the frame. A band qualifies only if it
 * is genuinely quiet in absolute terms *and* clearly quieter than the picture
 * as a whole — the second test is what stops a uniformly busy photograph from
 * nominating whichever third happens to be marginally less busy, which is not
 * negative space, it is just less food.
 */
function quietSide(
  energy: readonly number[],
  lumas: readonly number[],
  size: number,
): { quiet: Side | null; quietLuma: number } {
  const third = Math.round(size / 3);
  const bands: Array<{ side: Side; cells: number[] }> = [
    { side: "top", cells: [] },
    { side: "bottom", cells: [] },
    { side: "left", cells: [] },
    { side: "right", cells: [] },
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (y < third) bands[0].cells.push(i);
      if (y >= size - third) bands[1].cells.push(i);
      if (x < third) bands[2].cells.push(i);
      if (x >= size - third) bands[3].cells.push(i);
    }
  }

  const overall = mean([...energy]);
  let best: { side: Side; score: number; luma: number } | null = null;
  for (const band of bands) {
    const score = mean(band.cells.map((i) => energy[i]));
    if (!best || score < best.score) {
      best = { side: band.side, score, luma: mean(band.cells.map((i) => lumas[i])) };
    }
  }
  if (!best) return { quiet: null, quietLuma: 0.5 };
  const calm = best.score < 0.035 && best.score < overall * 0.62;
  return { quiet: calm ? best.side : null, quietLuma: best.luma };
}

/** The luma of the frame, averaged down to `TONE * TONE` cells, row-major. */
function toneMap(lumas: readonly number[], size: number): number[] {
  const map: number[] = [];
  const step = size / TONE;
  for (let row = 0; row < TONE; row++) {
    for (let col = 0; col < TONE; col++) {
      const cells: number[] = [];
      for (let y = Math.floor(row * step); y < Math.floor((row + 1) * step); y++) {
        for (let x = Math.floor(col * step); x < Math.floor((col + 1) * step); x++) {
          cells.push(lumas[y * size + x]);
        }
      }
      map.push(mean(cells));
    }
  }
  return map;
}

/**
 * Reads a signature out of an already-sampled grid.
 *
 * Pure, and separated from the decoding for exactly that reason: this is the
 * half with the judgement in it, so it is the half that has to be testable
 * against hand-built grids in Node rather than only against real photographs
 * in a browser.
 *
 * `rgb` is `GRID * GRID * 3` bytes, row-major, `0` to `255`.
 */
export function signatureFromGrid(
  rgb: readonly number[],
  width: number,
  height: number,
  size = GRID,
): Signature {
  const cells = size * size;
  const lumas: number[] = new Array(cells);
  const sats: number[] = new Array(cells);
  for (let i = 0; i < cells; i++) {
    const r = rgb[i * 3] ?? 0;
    const g = rgb[i * 3 + 1] ?? 0;
    const b = rgb[i * 3 + 2] ?? 0;
    lumas[i] = luma(r, g, b);
    sats[i] = saturation(r, g, b);
  }

  const energy = energyOf(lumas, size);
  const { flatBorder, uniformity, variety } = graphicness(lumas, energy, rgb, size);

  // All three, and all three generously. Anything that fails one of them is
  // treated as a photograph, because treating a photograph as one is never a
  // mistake and the reverse is.
  const kind: Signature["kind"] =
    flatBorder >= 0.8 && uniformity >= 0.45 && variety <= 0.35 ? "graphic" : "photo";

  // Weighted by the square of the energy so a plate outranks a table rather
  // than being averaged with it. Without the square, a picture with a busy
  // subject in one corner and a large calm field elsewhere focuses on the
  // middle of the calm field, which is the crop M6 was making.
  let wx = 0;
  let wy = 0;
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const w = energy[y * size + x] ** 2;
      wx += w * ((x + 0.5) / size);
      wy += w * ((y + 0.5) / size);
      total += w;
    }
  }
  const focus =
    total > 0 ? { x: wx / total, y: wy / total } : { x: 0.5, y: 0.5 };

  // The box around everything above a fraction of the strongest cell. For a
  // photograph this lands near the whole frame; for a drawing it lands on the
  // drawing, which is the case it exists for.
  const peak = Math.max(...energy, 0);
  const threshold = peak * 0.22;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (energy[y * size + x] < threshold) continue;
      x0 = Math.min(x0, x / size);
      y0 = Math.min(y0, y / size);
      x1 = Math.max(x1, (x + 1) / size);
      y1 = Math.max(y1, (y + 1) / size);
    }
  }
  const subject: Box =
    x1 > x0 && y1 > y0
      ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
      : { x: 0, y: 0, width: 1, height: 1 };

  const { quiet, quietLuma } = quietSide(energy, lumas, size);
  const colourfulness = mean(sats);

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    kind,
    brightness: mean(lumas),
    colourfulness,
    monochrome: colourfulness < 0.09 && quantile(sats, 0.9) < 0.18,
    focus,
    subject,
    quiet,
    quietLuma,
    tone: toneMap(lumas, size),
    detail: mean(energy),
  };
}

/* ------------------------------- using it --------------------------------- */

/** The signature carried by an upload, or `null` when it predates them. */
export function signatureOf(ref: AssetRef | null | undefined): Signature | null {
  return ref?.signature ?? null;
}

/**
 * How far a crop may go into this picture before the owner sees the pixels.
 *
 * Two limits, and the tighter one wins.
 *
 * The first is arithmetic: `coverCrop` at zoom `z` reads `1/z` of each
 * dimension, so a 720-pixel-wide photograph zoomed to `1.9` is supplying 379
 * pixels to a 1080-pixel poster. M6 did that — its `CROPS` table went to `1.9`
 * regardless of what it was cropping — and the result is a soft poster the
 * owner cannot fix, because the missing detail was never in the file. A little
 * enlargement is invisible on a phone; a lot is the difference between a
 * printed-looking poster and a blurry one.
 *
 * The second is that a flat picture has nothing to find up close. Going in on
 * a photograph with no texture does not produce a detail shot, it produces a
 * bigger patch of the same nothing.
 */
export function maxZoom(sig: Signature | null): number {
  if (!sig) return 1.35;
  const shortest = Math.min(sig.width, sig.height);
  // 1.35 is about the point at which enlargement stops being invisible at the
  // size a poster is actually looked at.
  const byPixels = (shortest / 1080) * 1.35;
  const byTexture = sig.detail < 0.035 ? 1.1 : sig.detail < 0.07 ? 1.4 : 2;
  return Math.min(2, Math.max(1, Math.min(byPixels, byTexture)));
}

/**
 * Whether this picture can carry a headline across it at all.
 *
 * A dark wash makes any photograph legible, but legible is not the same as
 * good: a wash heavy enough to rescue type over the middle of a bright plate
 * has also thrown away the plate, and the poster is then a grey rectangle with
 * a sentence on it. So type goes over a picture when the picture has somewhere
 * for it to go — a calm edge — or when it is dark enough that a light wash is
 * sufficient.
 */
export function canCarryType(sig: Signature | null): boolean {
  if (!sig) return true; // What M6 assumed. Kept, so old uploads are unchanged.
  if (sig.kind === "graphic") return false;
  return sig.quiet !== null || sig.brightness < 0.42;
}

/**
 * Mean luma over a region of the picture, `0` to `1`.
 *
 * `where` is in the picture's own coordinates, `0` to `1` on each axis, and is
 * read off the tone map by area overlap so a region smaller than one cell
 * still answers with that cell rather than with nothing.
 */
export function lumaOver(sig: Signature | null, where: Box | null): number {
  if (!sig) return 0.5;
  const map = sig.tone;
  if (!where || map.length !== TONE * TONE) return sig.brightness;
  const x0 = Math.max(0, where.x);
  const y0 = Math.max(0, where.y);
  const x1 = Math.min(1, where.x + where.width);
  const y1 = Math.min(1, where.y + where.height);
  if (!(x1 > x0 && y1 > y0)) return sig.brightness;
  let total = 0;
  let weight = 0;
  for (let row = 0; row < TONE; row++) {
    const overlapY = Math.min(y1, (row + 1) / TONE) - Math.max(y0, row / TONE);
    if (overlapY <= 0) continue;
    for (let col = 0; col < TONE; col++) {
      const overlapX = Math.min(x1, (col + 1) / TONE) - Math.max(x0, col / TONE);
      if (overlapX <= 0) continue;
      const w = overlapX * overlapY;
      total += map[row * TONE + col] * w;
      weight += w;
    }
  }
  return weight > 0 ? total / weight : sig.brightness;
}

/**
 * The part of the picture that ends up under the type, after the crop.
 *
 * A scrim darkens one edge of a *slot*, and the slot shows whatever the crop
 * put there — which is the step the first attempt at this missed. Measuring
 * the bottom third of the original file says nothing useful about a poster
 * that zoomed in on the middle of it. So: work out the source rectangle the
 * slot is showing, then take the band of *that* which the gradient reaches.
 *
 * Returns `null` when the answer would be a guess, and a guess is worse than
 * the average the caller already has.
 */
export function typedRegion(
  sig: Signature | null,
  slot: { width: number; height: number },
  focal: Focal,
  side: ScrimDirection,
): Box | null {
  if (!sig || side === "full" || slot.width <= 0 || slot.height <= 0) return null;
  const crop = coverCrop(sig, { w: slot.width, h: slot.height }, focal);
  const seen: Box = {
    x: crop.sx / sig.width,
    y: crop.sy / sig.height,
    width: crop.sw / sig.width,
    height: crop.sh / sig.height,
  };
  // The gradient is nothing at one edge and full at the other; the type sits
  // in the half that is actually dark. See `render.ts`.
  const half = seen.height * 0.5;
  return side === "top"
    ? { ...seen, height: half }
    : { ...seen, y: seen.y + seen.height - half, height: half };
}

/**
 * The wash a photograph needs under type, given how bright it is *there*.
 *
 * A dark kitchen photograph needs very little and keeps its mood; a bright
 * overexposed plate needs a lot. M6 used one number — `0.55` — for both, which
 * flattened the dark ones and barely saved the bright ones.
 *
 * `where` is the part of the picture the type will sit on, from `typedRegion`.
 * Without it the whole frame decides, which is right for a wash that covers
 * the whole frame and merely adequate for one that does not.
 */
export function washFor(sig: Signature | null, base = 0.5, where: Box | null = null): number {
  if (!sig) return base;
  const lift = (lumaOver(sig, where) - 0.35) * 0.55;
  return Math.min(0.72, Math.max(0.28, base + lift));
}

/**
 * Where the eye lands in this picture, as a fraction of the frame.
 *
 * The estimate, and it is only an estimate: the energy-weighted centre of a
 * thirty-two-square grid, which finds the plate in a plate shot and the face
 * in a portrait and has no idea what either of them is. The centre of the
 * frame is what an unknown picture gets, which is what a plain cover crop
 * would have done anyway — so the worst case here is exactly M6's behaviour
 * rather than a crop pointed somewhere invented.
 */
export function estimateImageFocalPoint(sig: Signature | null): { x: number; y: number } {
  if (!sig) return { x: 0.5, y: 0.5 };
  return { x: sig.focus.x, y: sig.focus.y };
}

/**
 * Where to point a crop, and how close to stand.
 *
 * `keepClear` is the side of the *slot* that type will occupy. The focal point
 * is nudged away from it so the subject moves into the half the type is not
 * on — which is the whole difference between a headline sitting in the empty
 * corner of a photograph and a headline sitting on the food.
 */
export function chooseCrop(
  sig: Signature | null,
  options: { zoom?: number; keepClear?: Side | null; shift?: { x: number; y: number } } = {},
): Focal {
  const wanted = options.zoom ?? 1;
  if (!sig) return { x: 0.5, y: 0.5, zoom: Math.min(wanted, 1.35) };

  const zoom = Math.min(wanted, maxZoom(sig));
  let { x, y } = sig.focus;

  // Step to one side. `chooseCropShift` decides how far, and the subject box
  // decides whether the step is allowed: a pan is only ever a pan *within the
  // picture's own subject*, so the second time a plate appears it is framed
  // from a different place and is still a photograph of the plate. Without
  // this a photograph that comes back on a day with the same zoom is the same
  // poster with different words.
  const shift = options.shift;
  if (shift && sig.subject.width > 0 && sig.subject.height > 0) {
    x = within(x + shift.x, sig.subject.x, sig.subject.width);
    y = within(y + shift.y, sig.subject.y, sig.subject.height);
  }

  // Pull the subject away from wherever the type is going. The shift is a
  // tenth of the frame: enough to move a plate out from under a headline, not
  // so much that the crop starts cutting the plate in half.
  const clear = options.keepClear;
  if (clear === "top") y = Math.min(0.78, y + 0.1);
  if (clear === "bottom") y = Math.max(0.22, y - 0.1);
  if (clear === "left") x = Math.min(0.78, x + 0.1);
  if (clear === "right") x = Math.max(0.22, x - 0.1);

  return {
    x: Math.min(0.85, Math.max(0.15, x)),
    y: Math.min(0.85, Math.max(0.15, y)),
    zoom,
  };
}

/** Keeps a panned focal point inside the span it was panned within. */
function within(value: number, start: number, length: number): number {
  return Math.min(start + length, Math.max(start, value));
}

/**
 * The crop that fills a slot with the drawing rather than with its whitespace.
 *
 * Only for graphics. A drawing exported with a wide white margin — which is
 * most of them — placed by `contain` in a box arrives at perhaps half the size
 * the box could hold, surrounded by white that is not the poster's own colour.
 * Centring the crop on the subject and zooming until the margin is gone is not
 * a manipulation of the artwork; it is the same thing as trimming a photograph
 * to its edges before framing it.
 */
export function graphicCrop(sig: Signature | null): Focal {
  if (!sig || sig.kind !== "graphic") return { x: 0.5, y: 0.5, zoom: 1 };
  const { subject } = sig;
  // A tenth of the frame of air left round the drawing, then whatever zoom
  // makes the rest of the frame that box.
  const span = Math.max(subject.width, subject.height) + 0.12;
  return {
    x: subject.x + subject.width / 2,
    y: subject.y + subject.height / 2,
    zoom: Math.min(2, Math.max(1, 1 / Math.min(1, span))),
  };
}

/* --------------------------------- storage -------------------------------- */

function clamp(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * A signature read back off a stored document, or `null`.
 *
 * Written once for both codecs — the restaurant's photo pool and the creative's
 * own image slots store the same `AssetRef` — so a signature cannot decode one
 * way in the profile and another way on a poster.
 *
 * Every field is clamped rather than trusted. A corrupt number here would not
 * crash anything; it would quietly produce a crop pointed off the side of a
 * photograph, which is the sort of fault that reaches an owner's feed instead
 * of a log.
 */
function decodeTone(value: unknown, fallback: number): number[] {
  const cells = TONE * TONE;
  if (!Array.isArray(value) || value.length !== cells) return new Array(cells).fill(fallback);
  return value.map((cell) => clamp(cell, 0, 1, fallback));
}

export function decodeSignature(value: unknown): Signature | null {
  if (typeof value !== "object" || value === null) return null;
  const d = value as Record<string, unknown>;
  if (typeof d.width !== "number" || typeof d.height !== "number") return null;
  const box = (d.subject ?? {}) as Record<string, unknown>;
  const focus = (d.focus ?? {}) as Record<string, unknown>;
  const quiet = d.quiet;
  return {
    width: Math.round(clamp(d.width, 1, 40000, 1)),
    height: Math.round(clamp(d.height, 1, 40000, 1)),
    kind: d.kind === "graphic" ? "graphic" : "photo",
    brightness: clamp(d.brightness, 0, 1, 0.5),
    colourfulness: clamp(d.colourfulness, 0, 1, 0.3),
    monochrome: d.monochrome === true,
    focus: { x: clamp(focus.x, 0, 1, 0.5), y: clamp(focus.y, 0, 1, 0.5) },
    subject: {
      x: clamp(box.x, 0, 1, 0),
      y: clamp(box.y, 0, 1, 0),
      width: clamp(box.width, 0.02, 1, 1),
      height: clamp(box.height, 0.02, 1, 1),
    },
    quiet:
      quiet === "top" || quiet === "bottom" || quiet === "left" || quiet === "right"
        ? quiet
        : null,
    quietLuma: clamp(d.quietLuma, 0, 1, 0.5),
    // A signature written before tone maps existed decodes to a flat map of
    // the frame's own brightness, which is exactly what it was washed by then.
    tone: decodeTone(d.tone, clamp(d.brightness, 0, 1, 0.5)),
    detail: clamp(d.detail, 0, 1, 0.1),
  };
}

/**
 * A signature as fields a document store will accept.
 *
 * Firestore rejects `undefined`, so `quiet` is written as `null` rather than
 * left off, and the whole object is omitted by the caller when there is none.
 */
export function encodeSignature(sig: Signature): Signature {
  return {
    width: sig.width,
    height: sig.height,
    kind: sig.kind,
    brightness: sig.brightness,
    colourfulness: sig.colourfulness,
    monochrome: sig.monochrome,
    focus: { x: sig.focus.x, y: sig.focus.y },
    subject: {
      x: sig.subject.x,
      y: sig.subject.y,
      width: sig.subject.width,
      height: sig.subject.height,
    },
    quiet: sig.quiet,
    quietLuma: sig.quietLuma,
    tone: [...sig.tone],
    detail: sig.detail,
  };
}
