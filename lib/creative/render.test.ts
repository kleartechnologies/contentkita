import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import type { AssetRef } from "../content/types.ts";
import { composeCreative } from "./compose.ts";
import {
  assetsOf,
  coverCrop,
  containBox,
  drawCreative,
  type ImageBank,
  type LoadedImage,
  type Painter,
} from "./render.ts";
import { setImage } from "./codec.ts";
import { isImage, type Creative } from "./types.ts";

const generator = new MockContentGenerator();

const PHOTO: AssetRef = {
  path: "restaurants/uid-1/creatives/ayam.jpg",
  url: "https://firebasestorage.googleapis.com/v0/b/bucket/o/ayam?alt=media&token=t",
  name: "ayam.jpg",
  contentType: "image/jpeg",
  size: 2048,
  uploadedAt: "2026-03-01T00:00:00.000Z",
};

const LOGO: AssetRef = { ...PHOTO, path: "restaurants/uid-1/logo/mark.png" };

/* --- a canvas that records instead of drawing ----------------------------- */

interface Drawn {
  texts: { text: string; x: number; y: number }[];
  images: { x: number; y: number; w: number; h: number }[];
  fills: number;
  strokes: number;
  fonts: string[];
  /** Every `measureText`, as the font size it was asked at and the string. */
  measures: string[];
}

/**
 * Enough of a 2D context to be a `Painter`, and nothing more.
 *
 * `measureText` is a linear model of glyph width rather than a real font, which
 * is all the layout needs: wrapping and fitting are proportional, so a stub
 * with consistent widths exercises the same branches a browser would.
 */
function recorder(): { painter: Painter; drawn: Drawn } {
  const drawn: Drawn = {
    texts: [],
    images: [],
    fills: 0,
    strokes: 0,
    fonts: [],
    measures: [],
  };
  let currentPx = 16;

  const painter: Painter = {
    save() {},
    restore() {},
    fillRect() {},
    beginPath() {},
    rect() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    closePath() {},
    clip() {},
    fill() {
      drawn.fills += 1;
    },
    stroke() {
      drawn.strokes += 1;
    },
    setLineDash() {},
    fillText(text, x, y) {
      drawn.texts.push({ text, x, y });
    },
    measureText(text) {
      drawn.measures.push(`${currentPx}|${text}`);
      return { width: text.length * currentPx * 0.52 };
    },
    drawImage(_image, _sx, _sy, _sw, _sh, dx, dy, dw, dh) {
      drawn.images.push({ x: dx, y: dy, w: dw, h: dh });
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    get font() {
      return `${currentPx}px stub`;
    },
    set font(value: string) {
      drawn.fonts.push(value);
      const match = /(\d+(?:\.\d+)?)px/.exec(value);
      if (match) currentPx = Number(match[1]);
    },
    textAlign: "left",
    textBaseline: "top",
    globalAlpha: 1,
  };

  return { painter, drawn };
}

const bitmap = (width: number, height: number): LoadedImage => ({
  // Nothing is drawn, so the source only has to be a value the recorder holds.
  source: {} as unknown as CanvasImageSource,
  width,
  height,
});

async function sample(image: AssetRef | null = null): Promise<Creative> {
  const { id, items } = await generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-03-01",
  });
  return composeCreative(DEMO_RESTAURANT, id, items[0], { image });
}

/* --- measuring ------------------------------------------------------------ */

test("no line is measured twice at the same size", async () => {
  // Not a micro-optimisation. Fitting a headline walks the size down, and at
  // each size `balanced` re-wraps the words a dozen times looking for the
  // measure that evens the rag — so the same line prefixes are measured over
  // and over, and in a browser each measurement re-parses a CSS font string.
  // Uncached, exporting thirty posters spent minutes inside `measureText` and
  // the download button looked hung. A repeat here is that bug coming back.
  const creative = await sample(PHOTO);
  const { painter, drawn } = recorder();

  drawCreative(painter, creative, { images: { [PHOTO.path]: bitmap(1600, 1200) } });

  assert.ok(drawn.measures.length > 0, "nothing was measured at all");
  assert.equal(
    new Set(drawn.measures).size,
    drawn.measures.length,
    "the same string was measured twice at the same size",
  );
});

/* --- geometry ------------------------------------------------------------- */

test("a wide photo is cropped, never squashed, to fill a square", () => {
  const crop = coverCrop({ width: 2000, height: 1000 }, { w: 1080, h: 1080 });

  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.001, `${a} ≠ ${b}`);
  near(crop.sw, 1000);
  near(crop.sh, 1000);
  // Centred: the same amount is taken off each side.
  near(crop.sx, 500);
  near(crop.sy, 0);
});

test("a contained logo keeps its aspect ratio inside its box", () => {
  const box = containBox({ width: 400, height: 100 }, { x: 10, y: 20, w: 200, h: 200 });

  assert.equal(box.w, 200);
  assert.equal(box.h, 50);
  assert.equal(box.x, 10);
  assert.equal(box.y, 95);
});

/* --- drawing -------------------------------------------------------------- */

test("the hook and the CTA are drawn onto the poster", async () => {
  const creative = await sample();
  const { painter, drawn } = recorder();

  drawCreative(painter, creative);

  const printed = drawn.texts.map((t) => t.text).join(" ");
  const headline = creative.elements.find((el) => el.id === "headline");
  assert.ok(headline && headline.kind === "text");
  assert.ok(printed.includes(headline.text.split(" ")[0]));
});

test("nothing is drawn outside the canvas", async () => {
  const creative = await sample();
  const { painter, drawn } = recorder();

  drawCreative(painter, creative);

  for (const t of drawn.texts) {
    assert.ok(t.x >= 0 && t.x <= creative.canvas.width, `x ${t.x}`);
    assert.ok(t.y >= -1 && t.y <= creative.canvas.height, `y ${t.y}`);
  }
});

test("the preview and the export differ only by scale", async () => {
  const creative = await sample();
  const full = recorder();
  const half = recorder();

  drawCreative(full.painter, creative, { scale: 1 });
  drawCreative(half.painter, creative, { scale: 0.5 });

  assert.equal(half.drawn.texts.length, full.drawn.texts.length);
  for (let i = 0; i < full.drawn.texts.length; i += 1) {
    assert.equal(half.drawn.texts[i].text, full.drawn.texts[i].text);
    assert.ok(Math.abs(half.drawn.texts[i].x - full.drawn.texts[i].x / 2) < 1);
  }
});

/**
 * The placeholder is an instruction to the person editing. Printing it into
 * the file they are about to post would be a bug with an audience.
 */
test("the empty-slot hint never lands in an exported poster", async () => {
  // A photo layout whose picture has been taken out in the studio. Composing
  // without one would not do: a day with no photograph is given a typographic
  // layout that has no slot at all.
  const composed = await sample(PHOTO);
  const slot = composed.elements.find(isImage);
  assert.ok(slot);
  const creative: Creative = {
    ...composed,
    elements: composed.elements.map((el) =>
      el.id === slot.id ? { ...el, source: null } : el,
    ),
  };

  const editor = recorder();
  drawCreative(editor.painter, creative, { showPlaceholders: true });
  assert.ok(editor.drawn.texts.some((t) => t.text === slot.placeholder));

  const exported = recorder();
  drawCreative(exported.painter, creative, { showPlaceholders: false });
  assert.ok(!exported.drawn.texts.some((t) => t.text === slot.placeholder));
  assert.equal(exported.drawn.strokes, 0);
});

test("an uploaded photo is what gets drawn into the slot", async () => {
  const creative = await sample(PHOTO);
  const images: ImageBank = { [PHOTO.path]: bitmap(1600, 1200) };
  const { painter, drawn } = recorder();

  drawCreative(painter, creative, { images });

  assert.equal(drawn.images.length, 1);
  assert.equal(drawn.images[0].w, creative.canvas.width);
});

test("a logo that has not loaded leaves no empty box behind", async () => {
  const withLogo = composeCreative(
    { ...DEMO_RESTAURANT, logo: LOGO },
    "plan-1",
    (await generator.generatePlan({ restaurant: DEMO_RESTAURANT, startDate: "2026-03-01" }))
      .items[0],
  );

  const missing = recorder();
  drawCreative(missing.painter, withLogo, { images: {} });
  assert.equal(missing.drawn.images.length, 0);

  const loaded = recorder();
  drawCreative(loaded.painter, withLogo, { images: { [LOGO.path]: bitmap(512, 512) } });
  assert.equal(loaded.drawn.images.length, 1);
});

test("a poster declares every upload it needs before it can be drawn", async () => {
  const creative = await sample(PHOTO);
  const withLogo = setImage(creative, "logo", LOGO);

  assert.deepEqual(assetsOf(creative), [PHOTO.path]);
  assert.equal(assetsOf(withLogo).includes(PHOTO.path), true);
});

test("an empty line of text draws nothing at all", async () => {
  const creative = await sample();
  const blanked: Creative = {
    ...creative,
    elements: creative.elements.map((el) =>
      el.kind === "text" ? { ...el, text: "   " } : el,
    ),
  };
  const { painter, drawn } = recorder();

  drawCreative(painter, blanked, { showPlaceholders: false });

  assert.deepEqual(drawn.texts, []);
});
