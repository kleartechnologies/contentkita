/**
 * Wrapping and fitting text into a box.
 *
 * Kept free of any canvas dependency so it can be tested with a stub measurer,
 * and so the preview and the exported PNG cannot drift: both call this, and a
 * layout bug shows up in a unit test rather than in a downloaded poster.
 *
 * The measurer is injected because text width is a property of the font, and
 * only the renderer knows which font is loaded.
 */

/** Returns the width of `text` when drawn at `fontPx`. */
export type Measure = (text: string, fontPx: number) => number;

export interface FitRequest {
  text: string;
  /** Box width in device pixels. */
  width: number;
  /** Box height in device pixels. */
  height: number;
  /** The size to start from, in device pixels. */
  fontPx: number;
  /** Multiple of the font size. */
  lineHeight: number;
  /** Shrink until it fits. When false, the text wraps and may overflow. */
  autoFit: boolean;
  measure: Measure;
  /** Never shrink below this fraction of `fontPx`. Defaults to 0.45. */
  minScale?: number;
}

export interface Fitted {
  lines: string[];
  /** The size actually used, after any shrinking. */
  fontPx: number;
  lineHeightPx: number;
  /** Total height of the laid-out block, in device pixels. */
  height: number;
}

/**
 * Greedy wrap at word boundaries.
 *
 * A single word wider than the box is left on its own line rather than being
 * broken mid-word: a hyphenated Malay dish name reads as a mistake, and the
 * caller shrinks the type instead. Existing newlines are honoured, because an
 * owner who pressed return meant it.
 */
export function wrap(
  text: string,
  width: number,
  fontPx: number,
  measure: Measure,
): string[] {
  const out: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }

    let line = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (measure(candidate, fontPx) <= width) {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }

  return out;
}

/**
 * The largest size at or below `fontPx` at which the wrapped text fits the box.
 *
 * Steps down rather than binary-searching: the search space is about twenty
 * sizes, wrapping is cheap, and a linear walk always lands on the largest
 * fitting size rather than near it.
 *
 * When nothing fits even at the floor, the floor is used and the text is
 * allowed to be tall. Clipping an owner's own words is never the right answer;
 * they can see it is too long and shorten it.
 */
export function fitText(request: FitRequest): Fitted {
  const {
    text,
    width,
    height,
    fontPx,
    lineHeight,
    autoFit,
    measure,
    minScale = 0.45,
  } = request;

  const floor = Math.max(1, fontPx * minScale);
  const layout = (size: number): Fitted => {
    const lines = wrap(text, width, size, measure);
    const lineHeightPx = size * lineHeight;
    return { lines, fontPx: size, lineHeightPx, height: lines.length * lineHeightPx };
  };

  if (!autoFit) return layout(fontPx);

  let size = fontPx;
  let best = layout(size);
  while (best.height > height && size > floor) {
    size = Math.max(floor, size * 0.94);
    best = layout(size);
  }
  return best;
}

/**
 * Where the first baseline goes, given how the block is aligned in its box.
 *
 * Canvas draws text from a baseline, and `textBaseline = "top"` puts the *top*
 * of the em box at y. Callers set that and then position by block height, which
 * is what this returns.
 */
export function blockTop(
  boxY: number,
  boxHeight: number,
  blockHeight: number,
  valign: "top" | "middle" | "bottom",
): number {
  if (valign === "top") return boxY;
  if (valign === "bottom") return boxY + boxHeight - blockHeight;
  return boxY + (boxHeight - blockHeight) / 2;
}

/** The x a line is drawn from, for a canvas whose `textAlign` matches. */
export function lineX(
  boxX: number,
  boxWidth: number,
  align: "left" | "center" | "right",
): number {
  if (align === "left") return boxX;
  if (align === "right") return boxX + boxWidth;
  return boxX + boxWidth / 2;
}

/**
 * Trims a string to `max` characters on a word boundary.
 *
 * Used only where a field is structurally too long for a slot — never to
 * summarise. Nothing is added, and if a single word is longer than the limit it
 * is returned whole rather than cut into something that is not a word.
 */
export function clampWords(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return space > max * 0.5 ? cut.slice(0, space) : clean.split(" ")[0];
}
