import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseBrandTreatment,
  chooseCardPlacement,
  chooseComposition,
  chooseCropShift,
  chooseCropZoom,
  chooseCtaTreatment,
  chooseGround,
  chooseHeadlineTreatment,
  choosePhotoTreatment,
  ctaBudget,
  ctaLimit,
  fitCropToBox,
  fitToMeasure,
  isGraphic,
  keepClearFor,
  leadingFor,
  LETTERED_BRAND,
  orderImages,
  redirectForGraphic,
  trackingFor,
  type Arrangement,
  type CompositionBrief,
} from "./direction.ts";
import type { Signature } from "./photo.ts";
import type { Focal, TemplateId } from "./types.ts";

const DAYS = Array.from({ length: 30 }, (_, i) => i + 1);

function sig(patch: Partial<Signature> = {}): Signature {
  return {
    width: 1920,
    height: 1080,
    kind: "photo",
    brightness: 0.5,
    colourfulness: 0.4,
    monochrome: false,
    focus: { x: 0.5, y: 0.5 },
    subject: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    quiet: null,
    quietLuma: 0.5,
    tone: new Array(16).fill(0.5),
    detail: 0.15,
    ...patch,
  };
}

/** A drawing on a white field, as `photo.ts` reports one. */
const DRAWING = sig({
  kind: "graphic",
  width: 1920,
  height: 2560,
  brightness: 0.94,
  detail: 0.05,
  subject: { x: 0.3, y: 0.25, width: 0.4, height: 0.5 },
  quiet: "top",
});

/** A photograph with nowhere for a headline to go. */
const BUSY = sig({ brightness: 0.72, quiet: null });

/** A dark kitchen shot that will hold type across it. */
const CALM = sig({ brightness: 0.3, quiet: "top" });

/* --- ground --------------------------------------------------------------- */

test("the page colour rotates without repeating on neighbouring days", () => {
  for (const day of DAYS.slice(0, 29)) {
    assert.notEqual(chooseGround(day), chooseGround(day + 1), `days ${day} and ${day + 1}`);
  }
});

test("a month uses all three grounds and is not half one colour", () => {
  const counts = new Map<string, number>();
  for (const day of DAYS) counts.set(chooseGround(day), (counts.get(chooseGround(day)) ?? 0) + 1);
  assert.equal(counts.size, 3);
  for (const [ground, n] of counts) assert.ok(n <= 15, `${ground} took ${n} of 30 days`);
});

test("a malformed day still gets a real answer", () => {
  assert.equal(chooseGround(0), chooseGround(1));
  assert.equal(chooseGround(-4), chooseGround(1));
  assert.equal(chooseGround(Number.NaN), chooseGround(1));
});

/* --- photo treatment ------------------------------------------------------ */

test("a drawing is always contained, whatever the layout hoped for", () => {
  for (const wanted of ["hero", "band", "detail", "framed", "panel"] as const) {
    assert.equal(choosePhotoTreatment(DRAWING, wanted), "panel");
  }
});

test("a photograph that cannot carry type is banded rather than made the page", () => {
  assert.equal(choosePhotoTreatment(BUSY, "hero"), "band");
  assert.equal(choosePhotoTreatment(CALM, "hero"), "hero");
});

test("a close crop is refused on a file with nothing to find", () => {
  assert.equal(choosePhotoTreatment(sig({ width: 720, height: 960 }), "detail"), "band");
  assert.equal(choosePhotoTreatment(sig({ width: 3000, height: 3000 }), "detail"), "detail");
});

test("treatment only ever downgrades; it never invents drama", () => {
  assert.equal(choosePhotoTreatment(CALM, "band"), "band");
  assert.equal(choosePhotoTreatment(CALM, "framed"), "framed");
});

test("an unknown picture behaves exactly as it did in M6", () => {
  assert.equal(choosePhotoTreatment(null, "hero"), "hero");
  assert.equal(isGraphic(null), false);
});

/* --- composition ---------------------------------------------------------- */

function brief(patch: Partial<CompositionBrief> = {}): CompositionBrief {
  return {
    day: 1,
    family: "photo-band",
    format: "square",
    headline: "Kami dah buka.",
    signature: CALM,
    photos: 1,
    fallback: false,
    ...patch,
  };
}

test("a photograph with nowhere for type never goes full bleed behind a headline", () => {
  assert.equal(chooseComposition(brief({ family: "photo-band", signature: BUSY })), "alternate");
  assert.equal(chooseComposition(brief({ family: "local", signature: BUSY })), "alternate");
  assert.equal(chooseComposition(brief({ family: "closeup", signature: BUSY })), "primary");
  assert.equal(chooseComposition(brief({ family: "festive", signature: BUSY })), "primary");
});

test("a long headline is kept out of a narrow magazine column", () => {
  const long = "Satu benda ramai tak tahu pasal masakan Melayu di kedai kecil macam ni.";
  assert.ok(long.length > 62);
  assert.equal(chooseComposition(brief({ family: "editorial", headline: long })), "primary");
  assert.equal(
    chooseComposition(brief({ family: "split", headline: long, format: "square" })),
    "alternate",
  );
});

test("the picture's own shape chooses the editorial layout", () => {
  const tall = sig({ width: 1080, height: 1920 });
  const wide = sig({ width: 1920, height: 1080 });
  assert.equal(chooseComposition(brief({ family: "editorial", signature: tall })), "alternate");
  assert.equal(chooseComposition(brief({ family: "editorial", signature: wide })), "primary");
});

test("a bright photograph is not put behind an even wash under a menu card", () => {
  assert.equal(
    chooseComposition(brief({ family: "menu-card", signature: sig({ brightness: 0.8 }) })),
    "alternate",
  );
});

test("a collage with fewer photographs than frames takes the asymmetric set", () => {
  assert.equal(chooseComposition(brief({ family: "collage", photos: 1, fallback: true })), "primary");
  assert.equal(
    chooseComposition(brief({ family: "collage", photos: 3, fallback: true })),
    "alternate",
  );
});

test("the day is only the tiebreak, and it does decide when nothing else does", () => {
  assert.equal(chooseComposition(brief({ family: "bold-type", fallback: false })), "primary");
  assert.equal(chooseComposition(brief({ family: "bold-type", fallback: true })), "alternate");
});

/* --- drawings ------------------------------------------------------------- */

test("a drawing is taken out of every family where the picture is the page", () => {
  const photoLed: TemplateId[] = [
    "photo-band",
    "closeup",
    "local",
    "festive",
    "split",
    "menu-card",
  ];
  for (const family of photoLed) {
    for (const day of DAYS) {
      assert.ok(
        !photoLed.includes(redirectForGraphic(family, DRAWING, day)),
        `${family} on day ${day} kept the drawing as the page`,
      );
    }
  }
});

test("a photograph is never redirected, and neither is a type-led day", () => {
  for (const day of DAYS) {
    assert.equal(redirectForGraphic("closeup", CALM, day), "closeup");
    assert.equal(redirectForGraphic("closeup", null, day), "closeup");
    assert.equal(redirectForGraphic("bold-type", DRAWING, day), "bold-type");
    assert.equal(redirectForGraphic("collage", DRAWING, day), "collage");
  }
});

test("every family a drawing is sent to still takes exactly one picture", () => {
  const hooks = [
    "Kami dah buka.",
    "Kenapa Nasi Ayam Penyet kami ambil masa lebih sikit.",
    "Untuk keluarga, pekerja pejabat, pelajar — ini mungkin membantu.",
  ];
  const homes = new Set(
    DAYS.flatMap((day) => hooks.map((hook) => redirectForGraphic("closeup", DRAWING, day, hook))),
  );
  for (const home of homes) {
    assert.ok(
      home === "minimal" || home === "type-poster" || home === "editorial",
      `a drawing was sent to ${home}, which does not take one picture`,
    );
  }
  assert.equal(homes.size, 3, "and it uses all three of them");
});

test("the hook decides where a drawing goes, not the day", () => {
  const short = "Kami dah buka.";
  const middling = "Kenapa Nasi Ayam Penyet kami ambil masa lebih sikit.";
  const long = "Untuk keluarga, pekerja pejabat, pelajar — ini mungkin membantu.";

  for (const day of DAYS) {
    assert.equal(redirectForGraphic("closeup", DRAWING, day, short), "type-poster");
    assert.equal(redirectForGraphic("closeup", DRAWING, day, middling), "minimal");
    assert.equal(redirectForGraphic("closeup", DRAWING, day, long), "editorial");
  }
});

test("two drawing days any distance apart differ if their hooks do", () => {
  // The regression this replaced: days 6 and 30 of the acceptance pack were
  // the same poster, and 24 is a multiple of every wheel that was tried. The
  // hooks on those two days are 34 and 64 characters, which is the point.
  const poster = (day: number, hook: string) => {
    const family = redirectForGraphic("closeup", DRAWING, day, hook);
    return `${family}/${chooseComposition(
      brief({ day, family, signature: DRAWING, fallback: day % 2 === 0 }),
    )}`;
  };
  assert.notEqual(
    poster(6, "Kedai kami paling tenang waktu ni."),
    poster(30, "Untuk Keluarga, pekerja pejabat, pelajar — ini mungkin membantu."),
  );
});

test("a caller with no hook to offer still gets a spread of answers", () => {
  const homes = new Set(DAYS.map((day) => redirectForGraphic("closeup", DRAWING, day)));
  assert.equal(homes.size, 3);
});

/* --- headlines ------------------------------------------------------------ */

test("a short hook is set larger than a long one", () => {
  const size = 0.09;
  const short = chooseHeadlineTreatment("Kami dah buka.", size);
  const medium = chooseHeadlineTreatment("Menu hari ini bukan menu hari pertama.", size);
  const long = chooseHeadlineTreatment(
    "Satu benda ramai tak tahu pasal masakan Melayu di kedai kecil macam ni, dan ia bukan rahsia.",
    size,
  );
  assert.ok(short.size > medium.size, `${short.size} should exceed ${medium.size}`);
  assert.ok(medium.size > long.size, `${medium.size} should exceed ${long.size}`);
});

test("leading follows the size instead of one number doing both jobs", () => {
  assert.ok(leadingFor(0.12) < leadingFor(0.03), "display type is set tighter than body type");
});

test("large type is tracked in harder than small type", () => {
  assert.ok(trackingFor(0.12) < trackingFor(0.02), "display type is pulled in further");
  assert.ok(trackingFor(0.02) > -0.01, "small type is very nearly left alone");
});

test("a headline in a narrow column is not set at poster size", () => {
  const full = chooseHeadlineTreatment("Kami dah buka.", 0.09, 1);
  const column = chooseHeadlineTreatment("Kami dah buka.", 0.09, 0.4);
  assert.ok(column.size < full.size, `${column.size} should be under ${full.size}`);
});

test("narrowing a measure shrinks type but never to nothing", () => {
  assert.equal(fitToMeasure(0.09, 1), 0.09);
  assert.equal(fitToMeasure(0.09, 1.4), 0.09);
  assert.ok(fitToMeasure(0.09, 0.2) >= 0.09 * 0.6);
  assert.ok(fitToMeasure(0.09, 0.2) < 0.09);
});

/* --- calls to action ------------------------------------------------------ */

test("a call to action too long for a button is not put in one", () => {
  const long = "Kalau korang sekitar sini, reply atau WhatsApp kami sebelum pukul lima petang.";
  assert.equal(chooseCtaTreatment({ day: 1, text: long, room: 0.4, prefer: "pill" }), "underline");
  assert.equal(
    chooseCtaTreatment({ day: 1, text: long, room: 0.4, prefer: "pill", onPhoto: true }),
    "plain",
  );
});

test("a short call to action keeps the button it asked for", () => {
  assert.equal(
    chooseCtaTreatment({ day: 1, text: "Reply sekarang.", room: 0.6, prefer: "pill" }),
    "pill",
  );
});

test("an underline is not drawn under two lines of type", () => {
  const long = "Kalau korang sekitar sini, reply atau WhatsApp kami sebelum pukul lima petang.";
  assert.equal(
    chooseCtaTreatment({ day: 1, text: long, room: 0.35, prefer: "underline" }),
    "plain",
  );
});

test("no call to action means no badge", () => {
  assert.equal(chooseCtaTreatment({ day: 1, text: "   ", room: 0.6 }), "none");
});

test("the month is not the same pill thirty times", () => {
  const kinds = new Set(
    DAYS.map((day) => chooseCtaTreatment({ day, text: "Reply sekarang.", room: 0.6 })),
  );
  assert.ok(kinds.size >= 3, `only ${kinds.size} kinds of call to action in a month`);
  assert.ok(kinds.has("none"), "and some days carry none at all");
});

test("the trim allowed is the treatment's own budget", () => {
  assert.equal(ctaLimit("pill", 0.6), ctaBudget(0.54));
  assert.equal(ctaLimit("underline", 0.6), ctaBudget(0.6));
  assert.equal(ctaLimit("plain", 0.6), ctaBudget(0.6, 2));
});

/* --- brand and crops ------------------------------------------------------ */

test("the signature is not set the same way every day", () => {
  const seen = new Set(DAYS.map((day) => JSON.stringify(chooseBrandTreatment(day))));
  assert.ok(seen.size >= 3, `only ${seen.size} brand treatments in a month`);
});

test("the centred families ask for small capitals by name", () => {
  assert.equal(LETTERED_BRAND.transform, "uppercase");
  assert.ok(LETTERED_BRAND.tracking > 0);
});

test("a collage's three frames are three different framings", () => {
  const zooms = [0, 1, 2].map((slot) => chooseCropZoom(7, slot));
  assert.equal(new Set(zooms).size, 3, `frames were ${zooms.join(", ")}`);
});

test("the same plate is framed differently on the days it comes back", () => {
  assert.notEqual(chooseCropZoom(3), chooseCropZoom(18));
});

test("a plate seven days later is pointed somewhere else, not just resized", () => {
  // Days 16 and 23 of the M6.5 acceptance pack were the same nasi lemak at the
  // same 1.6, aimed at the same pixel, in boxes of the same shape: one poster
  // printed twice with different words. Seven days apart is exactly the zoom
  // wheel's period, which is why zoom alone was never enough.
  assert.equal(chooseCropZoom(16), chooseCropZoom(23));
  assert.notDeepEqual(chooseCropShift(16), chooseCropShift(23));
});

test("no framing repeats inside a month", () => {
  const seen = new Map<string, number>();
  for (const day of DAYS) {
    const framing = `${chooseCropZoom(day)} ${JSON.stringify(chooseCropShift(day))}`;
    const first = seen.get(framing);
    if (first === undefined) {
      seen.set(framing, day);
      continue;
    }
    // Four offsets and seven zooms: the pair cannot come round in under 28
    // days, and the two days that manage it are in different families.
    assert.ok(day - first >= 28, `days ${first} and ${day} are framed identically`);
  }
});

test("one drawing is hung in a different place each time it comes back", () => {
  // The drawing days of the acceptance pack, and the pair that collided: 6 and
  // 16 are both odd, so both took the same arrangement, and the drawing has no
  // crop to vary. Placement is what makes the second page a different page.
  assert.notEqual(chooseCardPlacement(6), chooseCardPlacement(16));
  const spread = new Set(DAYS.map((day) => chooseCardPlacement(day)));
  assert.equal(spread.size, 3, `only ${spread.size} placements in a month`);
});

test("a collage's frames are panned apart as well as zoomed apart", () => {
  const shifts = [0, 1, 2].map((slot) => JSON.stringify(chooseCropShift(11, slot)));
  assert.equal(new Set(shifts).size, 3, `frames panned to ${shifts.join(", ")}`);
});

test("a layout says which side of the picture the type is taking", () => {
  assert.equal(keepClearFor("photo-band", "primary"), "bottom");
  assert.equal(keepClearFor("closeup", "alternate"), "top");
  assert.equal(keepClearFor("editorial", "primary"), null);
});

/* --- ordering ------------------------------------------------------------- */

const named = (name: string, kind: "photo" | "graphic") => ({ name, kind });
const signatureOf = (image: { kind: "photo" | "graphic" }) => sig({ kind: image.kind });

test("a drawing never takes the dominant frame ahead of a photograph", () => {
  const ordered = orderImages(
    [named("teh.png", "graphic"), named("nasi.jpg", "photo"), named("mee.jpg", "photo")],
    signatureOf,
  );
  assert.deepEqual(
    ordered.map((i) => i.name),
    ["nasi.jpg", "mee.jpg", "teh.png"],
  );
});

test("ordering keeps every picture and changes nothing it does not have to", () => {
  const photos = [named("a.jpg", "photo"), named("b.jpg", "photo")];
  assert.deepEqual(orderImages(photos, signatureOf), photos);
  const drawings = [named("a.png", "graphic"), named("b.png", "graphic")];
  assert.deepEqual(orderImages(drawings, signatureOf), drawings);
  assert.deepEqual(orderImages([], signatureOf), []);
});

test("photographs keep their own order among themselves", () => {
  const ordered = orderImages(
    [named("1.jpg", "photo"), named("g.png", "graphic"), named("2.jpg", "photo")],
    signatureOf,
  );
  assert.deepEqual(
    ordered.map((i) => i.name),
    ["1.jpg", "2.jpg", "g.png"],
  );
});

/* --- the whole month ------------------------------------------------------ */

test("every art-direction decision is the same on the second run", () => {
  const once = DAYS.map((day) => ({
    ground: chooseGround(day),
    brand: chooseBrandTreatment(day),
    zoom: chooseCropZoom(day),
    cta: chooseCtaTreatment({ day, text: "Reply sekarang.", room: 0.6 }),
    arrangement: chooseComposition(brief({ day })) satisfies Arrangement,
  }));
  const twice = DAYS.map((day) => ({
    ground: chooseGround(day),
    brand: chooseBrandTreatment(day),
    zoom: chooseCropZoom(day),
    cta: chooseCtaTreatment({ day, text: "Reply sekarang.", room: 0.6 }),
    arrangement: chooseComposition(brief({ day })) satisfies Arrangement,
  }));
  assert.deepEqual(once, twice);
});

/* ------------------------- crop against its own box ----------------------- */

const CLOSE: Focal = { x: 0.5, y: 0.5, zoom: 1.6 };
/** The acceptance pool's roti canai photograph: 3:4, taller than it is wide. */
const TALL = sig({ width: 1920, height: 2560 });

test("a box of the picture's own shape takes the crop the day asked for", () => {
  // Square box, square-ish picture: nothing has been thrown away yet, so the
  // zoom stands.
  const square = sig({ width: 1080, height: 1080 });
  const kept = fitCropToBox(CLOSE, { x: 0, y: 0, width: 1, height: 1 }, square, "square");
  assert.equal(kept.zoom, CLOSE.zoom);
});

test("a box that has already halved the picture does not also zoom into it", () => {
  // Day 17: a 3:4 photograph in a band twice as wide as it is tall. The cover
  // fit is already showing two-fifths of the file; 1.6 on top of that left a
  // white shape with no hands and no face in it.
  const band = { x: 0, y: 0, width: 1, height: 0.45 };
  const eased = fitCropToBox(CLOSE, band, TALL, "portrait");
  assert.ok(eased.zoom < CLOSE.zoom, "the band kept the whole zoom");
  assert.ok(eased.zoom >= 1, `zoom fell below life size at ${eased.zoom}`);
  // And it is the shapes disagreeing that did it, not the family: the same
  // picture in a tall slot keeps far more of what it asked for.
  const column = fitCropToBox(CLOSE, { x: 0, y: 0, width: 0.5, height: 1 }, TALL, "portrait");
  assert.ok(column.zoom > eased.zoom, "a tall picture in a tall slot lost as much as in a band");
});

test("easing a crop never invents one", () => {
  const band = { x: 0, y: 0, width: 1, height: 0.45 };
  // Nothing to ease: no signature, life size already, or artwork rather than a
  // photograph — a drawing is trimmed by `graphicCrop`, not cropped into.
  assert.equal(fitCropToBox(CLOSE, band, null, "square"), CLOSE);
  const flat: Focal = { x: 0.5, y: 0.5, zoom: 1 };
  assert.equal(fitCropToBox(flat, band, TALL, "square").zoom, 1);
  assert.equal(fitCropToBox(CLOSE, band, sig({ kind: "graphic" }), "square"), CLOSE);
});
