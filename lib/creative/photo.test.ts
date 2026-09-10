import assert from "node:assert/strict";
import test from "node:test";

import {
  canCarryType,
  chooseCrop,
  decodeSignature,
  encodeSignature,
  lumaOver,
  typedRegion,
  estimateImageFocalPoint,
  graphicCrop,
  GRID,
  maxZoom,
  signatureFromGrid,
  washFor,
  type Signature,
} from "./photo.ts";

/* --- grids ---------------------------------------------------------------- */

type Paint = (x: number, y: number) => [number, number, number];

/** A GRID×GRID RGB sample, built by a function of cell position. */
function grid(paint: Paint, size = GRID): number[] {
  const out: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out.push(...paint(x / (size - 1), y / (size - 1)));
  }
  return out;
}

/** Deterministic noise, so "a photograph" means "has texture everywhere". */
function speckle(x: number, y: number): number {
  return ((Math.sin(x * 97.13 + y * 41.7) + 1) / 2) * 255;
}

/** A plate of food: colour and texture edge to edge. */
const PHOTOGRAPH: readonly number[] = grid((x, y) => [
  speckle(x * 31, y * 29),
  speckle(x * 17 + 3, y * 23),
  speckle(x * 11 + 7, y * 13) * 0.4,
]);

/** A drawing: a small dark mark on a wide white field. */
const DRAWING: readonly number[] = grid((x, y) => {
  const inMark = x > 0.4 && x < 0.6 && y > 0.35 && y < 0.65;
  return inMark ? [20, 20, 20] : [252, 252, 252];
});

/** A dark kitchen shot with a calm band across the top. */
const QUIET_TOP: readonly number[] = grid((x, y) => {
  // Deeper than the third of the frame `quietSide` measures, so the boundary
  // itself falls outside the band it is testing.
  if (y < 0.42) return [24, 24, 26];
  const v = speckle(x * 37, y * 43);
  return [v, v * 0.7, v * 0.4];
});

/* --- classification ------------------------------------------------------- */

test("a textured, colourful frame is read as a photograph", () => {
  const sig = signatureFromGrid(PHOTOGRAPH, 1920, 1080);
  assert.equal(sig.kind, "photo");
  assert.equal(sig.width, 1920);
  assert.equal(sig.height, 1080);
});

test("a mark on a white field is read as a drawing, not a photograph", () => {
  const sig = signatureFromGrid(DRAWING, 1920, 2560);
  assert.equal(sig.kind, "graphic");
});

test("a drawing's subject box is the drawing, not the whole white field", () => {
  const { subject } = signatureFromGrid(DRAWING, 1920, 2560);
  assert.ok(subject.width < 0.6, `subject spans ${subject.width} of the frame`);
  assert.ok(subject.height < 0.7, `subject spans ${subject.height} of the frame`);
});

test("a calm band is found on the edge that has one, and nowhere else", () => {
  assert.equal(signatureFromGrid(QUIET_TOP, 1920, 1080).quiet, "top");
  assert.equal(signatureFromGrid(PHOTOGRAPH, 1920, 1080).quiet, null);
});

test("the focal point lands on the detail rather than in the middle by default", () => {
  // Texture in the lower right, flat grey everywhere else.
  const lopsided = grid((x, y) =>
    x > 0.6 && y > 0.6 ? [speckle(x * 53, y * 59), 120, 80] : [128, 128, 128],
  );
  const { focus } = signatureFromGrid(lopsided, 1600, 1600);
  assert.ok(focus.x > 0.55, `focus.x was ${focus.x}`);
  assert.ok(focus.y > 0.55, `focus.y was ${focus.y}`);
});

test("reading the same grid twice gives the same signature", () => {
  assert.deepEqual(
    signatureFromGrid(PHOTOGRAPH, 1920, 1080),
    signatureFromGrid(PHOTOGRAPH, 1920, 1080),
  );
});

/* --- what the composer asks of a signature -------------------------------- */

const PHOTO_SIG = signatureFromGrid(PHOTOGRAPH, 1920, 1080);
const DRAWING_SIG = signatureFromGrid(DRAWING, 1920, 2560);
const DARK_SIG = signatureFromGrid(QUIET_TOP, 1920, 1080);

test("a drawing never carries a headline across it", () => {
  assert.equal(canCarryType(DRAWING_SIG), false);
});

test("a photograph with a calm edge carries type; a busy bright one does not", () => {
  assert.equal(canCarryType(DARK_SIG), true);
  assert.equal(canCarryType({ ...PHOTO_SIG, quiet: null, brightness: 0.8 }), false);
});

test("an unknown picture is treated exactly as M6 treated every picture", () => {
  assert.equal(canCarryType(null), true);
  assert.deepEqual(estimateImageFocalPoint(null), { x: 0.5, y: 0.5 });
  assert.equal(washFor(null, 0.5), 0.5);
});

test("a bright photograph is given a heavier wash than a dark one", () => {
  const bright = washFor({ ...PHOTO_SIG, brightness: 0.85 });
  const dark = washFor({ ...PHOTO_SIG, brightness: 0.15 });
  assert.ok(bright > dark, `${bright} should exceed ${dark}`);
  assert.ok(dark >= 0.28 && bright <= 0.72, "the wash stays inside its bounds");
});

test("the wash is decided by what the crop put under the type, not by the frame", () => {
  // Day 19 of the acceptance pack: dark wood over most of the frame, a mound
  // of white rice along the bottom, and a headline going on the rice. Averaged
  // it reads as a dark picture and asks for the lightest wash there is.
  const riceAtTheBottom = grid((_x, y) => (y > 0.62 ? [236, 232, 226] : [42, 36, 30]));
  const sig = signatureFromGrid(riceAtTheBottom, 1920, 1289);
  assert.ok(sig.brightness < 0.5, `the frame reads dark at ${sig.brightness}`);

  const slot = { width: 1080, height: 1080 };
  const onTheRice = typedRegion(sig, slot, { x: 0.5, y: 0.5, zoom: 1 }, "bottom");
  const onTheWood = typedRegion(sig, slot, { x: 0.5, y: 0.5, zoom: 1 }, "top");
  assert.ok(onTheRice && onTheWood);
  assert.ok(lumaOver(sig, onTheRice) > 0.7, `the rice reads ${lumaOver(sig, onTheRice)}`);
  assert.ok(lumaOver(sig, onTheWood) < 0.3, `the wood reads ${lumaOver(sig, onTheWood)}`);

  const heavy = washFor(sig, 0.5, onTheRice);
  const light = washFor(sig, 0.5, onTheWood);
  assert.ok(heavy > washFor(sig, 0.5), `${heavy} should exceed the frame's average`);
  assert.ok(heavy > light, `${heavy} should exceed the dark end's ${light}`);
});

test("a crop that leaves the bright half behind is washed for what it kept", () => {
  const riceAtTheBottom = grid((_x, y) => (y > 0.62 ? [236, 232, 226] : [42, 36, 30]));
  const sig = signatureFromGrid(riceAtTheBottom, 1920, 1289);
  const slot = { width: 1080, height: 1080 };
  // Pointed at the top of the frame and closed in: no rice in the slot at all.
  const wood = typedRegion(sig, slot, { x: 0.5, y: 0.16, zoom: 1.8 }, "bottom");
  assert.ok(lumaOver(sig, wood) < 0.3, `the crop kept only wood, at ${lumaOver(sig, wood)}`);
  assert.ok(washFor(sig, 0.5, wood) < washFor(sig, 0.5, typedRegion(sig, slot, { x: 0.5, y: 0.5, zoom: 1 }, "bottom")));
});

test("a signature stored before tone maps washes exactly as it did before", () => {
  const older = { ...encodeSignature(PHOTO_SIG), tone: undefined, brightness: 0.8 };
  const back = decodeSignature(older);
  assert.ok(back);
  const slot = { width: 1080, height: 1080 };
  const where = typedRegion(back, slot, { x: 0.5, y: 0.5, zoom: 1 }, "bottom");
  assert.equal(washFor(back, 0.5, where), washFor(back, 0.5));
});

test("a wash that covers the whole frame asks the whole frame", () => {
  const slot = { width: 1080, height: 1080 };
  assert.equal(typedRegion(PHOTO_SIG, slot, { x: 0.5, y: 0.5, zoom: 1 }, "full"), null);
  assert.equal(typedRegion(null, slot, { x: 0.5, y: 0.5, zoom: 1 }, "bottom"), null);
});

test("a small or flat picture is never enlarged past what it can take", () => {
  const small = maxZoom({ ...PHOTO_SIG, width: 720, height: 960 });
  assert.ok(small < 1.35, `a 720px file allowed ${small}`);
  const flat = maxZoom({ ...PHOTO_SIG, width: 4000, height: 4000, detail: 0.02 });
  assert.ok(flat <= 1.1, `a flat file allowed ${flat}`);
});

test("a crop asked for more zoom than the file has gets what the file has", () => {
  const crop = chooseCrop({ ...PHOTO_SIG, width: 720, height: 960 }, { zoom: 1.9 });
  assert.ok(crop.zoom <= maxZoom({ ...PHOTO_SIG, width: 720, height: 960 }));
});

test("a crop moves the subject out from under the type", () => {
  const centred: Signature = { ...PHOTO_SIG, focus: { x: 0.5, y: 0.5 } };
  assert.ok(chooseCrop(centred, { keepClear: "bottom" }).y < 0.5);
  assert.ok(chooseCrop(centred, { keepClear: "top" }).y > 0.5);
  assert.ok(chooseCrop(centred, { keepClear: "left" }).x > 0.5);
  assert.ok(chooseCrop(centred, { keepClear: "right" }).x < 0.5);
});

test("a crop never points off the edge of the picture", () => {
  const corner: Signature = { ...PHOTO_SIG, focus: { x: 0.98, y: 0.02 } };
  const crop = chooseCrop(corner, { keepClear: "left", zoom: 2 });
  assert.ok(crop.x >= 0.15 && crop.x <= 0.85, `x was ${crop.x}`);
  assert.ok(crop.y >= 0.15 && crop.y <= 0.85, `y was ${crop.y}`);
});

test("a pan moves the crop without walking off the subject", () => {
  const plate: Signature = {
    ...PHOTO_SIG,
    focus: { x: 0.5, y: 0.5 },
    subject: { x: 0.35, y: 0.3, width: 0.3, height: 0.3 },
  };
  const still = chooseCrop(plate, { zoom: 1.2 });
  const panned = chooseCrop(plate, { zoom: 1.2, shift: { x: 0.08, y: -0.05 } });
  assert.notDeepEqual(still, panned, "the pan did nothing");
  assert.equal(still.zoom, panned.zoom, "a pan is not a zoom");

  // However far the offset asks, the crop stays pointed at the subject the
  // signature found: a step to one side, never a different picture.
  const far = chooseCrop(plate, { zoom: 1.2, shift: { x: 0.9, y: -0.9 } });
  assert.ok(far.x <= 0.65 + 1e-9, `x walked to ${far.x}`);
  assert.ok(far.y >= 0.3 - 1e-9, `y walked to ${far.y}`);
});

test("a drawing is trimmed to its own edges; a photograph is left alone", () => {
  const trim = graphicCrop(DRAWING_SIG);
  assert.ok(trim.zoom > 1, "a drawing on a wide white field is zoomed in");
  assert.deepEqual(graphicCrop(PHOTO_SIG), { x: 0.5, y: 0.5, zoom: 1 });
  assert.deepEqual(graphicCrop(null), { x: 0.5, y: 0.5, zoom: 1 });
});

/* --- storage -------------------------------------------------------------- */

test("a signature survives a round trip through storage unchanged", () => {
  assert.deepEqual(decodeSignature(encodeSignature(PHOTO_SIG)), PHOTO_SIG);
  assert.deepEqual(decodeSignature(encodeSignature(DRAWING_SIG)), DRAWING_SIG);
});

test("a photograph uploaded before signatures existed decodes to nothing", () => {
  assert.equal(decodeSignature(undefined), null);
  assert.equal(decodeSignature(null), null);
  assert.equal(decodeSignature({}), null);
});

test("a corrupt signature is clamped rather than trusted", () => {
  const bad = decodeSignature({
    ...encodeSignature(PHOTO_SIG),
    brightness: 42,
    focus: { x: -3, y: 9 },
  });
  assert.ok(bad);
  assert.ok(bad.brightness >= 0 && bad.brightness <= 1);
  assert.ok(bad.focus.x >= 0 && bad.focus.x <= 1);
  assert.ok(bad.focus.y >= 0 && bad.focus.y <= 1);
});
