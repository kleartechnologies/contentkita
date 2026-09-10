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
  /**
   * Even out the line lengths instead of filling each line to the edge.
   *
   * On for headlines and other short display text, off for body copy. See
   * `balanced`.
   */
  balance?: boolean;
}

export interface Fitted {
  lines: string[];
  /** The size actually used, after any shrinking. */
  fontPx: number;
  lineHeightPx: number;
  /** Total height of the laid-out block, in device pixels. */
  height: number;
  /** The longest line, in device pixels. */
  width: number;
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
 * The same wrap, with the lines evened out.
 *
 * Greedy wrapping fills every line to the edge and leaves whatever is left on
 * the last one, which is how a four-word headline ends up as three words and a
 * widow, and how "Mee Goreng atau Teh Ais? Ini soalan paling susah di sini."
 * sets with one line touching both margins and the next holding two words. It
 * is not a subtle flaw — it is the single thing that most makes automated type
 * look automated, because a designer setting the same words by hand would
 * never break them there.
 *
 * The fix is the oldest trick in typesetting and needs no new measurements:
 * a greedy wrap is already the *fewest* lines the text can take, so keep that
 * line count and squeeze the width until it is about to cost a line. Every
 * line then carries roughly its share and the rag is even. Binary search over
 * the width because line count falls monotonically as the width grows.
 *
 * Deliberately not applied to body copy: a paragraph wants a straight left
 * edge and a full measure, and evening out ten lines just makes the block
 * narrower for no gain.
 */
export function balanced(
  text: string,
  width: number,
  fontPx: number,
  measure: Measure,
): string[] {
  const greedy = wrap(text, width, fontPx, measure);
  if (greedy.length < 2) return greedy;

  let tooNarrow = 0;
  let wide = width;
  for (let i = 0; i < 14; i += 1) {
    const mid = (tooNarrow + wide) / 2;
    if (wrap(text, mid, fontPx, measure).length <= greedy.length) wide = mid;
    else tooNarrow = mid;
  }

  const even = wrap(text, wide, fontPx, measure);
  // A word wider than the squeezed measure can push the count up despite the
  // search; the greedy set is then still the honest one.
  return even.length === greedy.length ? even : greedy;
}

/**
 * The largest size at or below `fontPx` at which the wrapped text fits the box.
 *
 * Steps down rather than binary-searching: the search space is about twenty
 * sizes, wrapping is cheap, and a linear walk always lands on the largest
 * fitting size rather than near it.
 *
 * Fitting means both dimensions. Height is the obvious one and was for a long
 * time the only one, which left a specific poster broken: `wrap` refuses to
 * break a word in half, so one long word — "malam-malam.", a hyphenated dish
 * name — sits on a line of its own wider than the box and runs off the edge of
 * the page, while the three short lines around it fit the height perfectly and
 * nothing ever shrinks. `wrap`'s own contract says the caller shrinks the type
 * instead; this is the caller keeping it.
 *
 * When nothing fits even at the floor, the floor is used and the text is
 * allowed to overrun. Clipping an owner's own words is never the right answer;
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
    balance = false,
  } = request;

  const floor = Math.max(1, fontPx * minScale);
  const layout = (size: number): Fitted => {
    const lines = balance
      ? balanced(text, width, size, measure)
      : wrap(text, width, size, measure);
    const lineHeightPx = size * lineHeight;
    return {
      lines,
      fontPx: size,
      lineHeightPx,
      height: lines.length * lineHeightPx,
      width: lines.reduce((widest, line) => Math.max(widest, measure(line, size)), 0),
    };
  };

  if (!autoFit) return layout(fontPx);

  let size = fontPx;
  let best = layout(size);
  while ((best.height > height || best.width > width) && size > floor) {
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
 * The call to action as it may appear *on the poster*, or nothing.
 *
 * A CTA is a sentence, and half a sentence is not a shorter CTA — it is a
 * mistake printed on something the owner is about to publish. "Kalau korang
 * sekitar sini, reply atau" is not an invitation, it is a poster that ran out
 * of room, and no amount of good design survives it.
 *
 * So this never cuts mid-sentence. A CTA that fits is used whole; a CTA of
 * several sentences gives up its later ones; and one long sentence that will
 * not fit at all is left off the poster entirely. Nothing is lost by that —
 * the CTA is still the last line of the caption the owner copies, and every
 * family draws an absent CTA as absent rather than as an empty badge.
 */
export function ctaLine(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;

  // Sentence ends, kept with their punctuation so what is returned reads as a
  // finished sentence rather than as a phrase that lost its full stop.
  let kept = "";
  for (const match of clean.matchAll(/[^.!?]*[.!?]+(?:\s+|$)/g)) {
    const next = (kept ? `${kept} ` : "") + match[0].trim();
    if (next.length > max) break;
    kept = next;
  }
  return kept;
}
