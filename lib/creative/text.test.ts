import assert from "node:assert/strict";
import test from "node:test";

import { balanced, blockTop, ctaLine, fitText, lineX, wrap, type Measure } from "./text.ts";

/**
 * A stub in place of a font: every character is half the font size wide.
 *
 * Which is the point of injecting the measurer — the wrapping rules can be
 * checked exactly, in Node, without a canvas and without depending on which
 * font happened to load.
 */
const measure: Measure = (text, fontPx) => text.length * fontPx * 0.5;

/** The width of `n` characters at `fontPx`, for writing readable expectations. */
function chars(n: number, fontPx = 10): number {
  return measure("x".repeat(n), fontPx);
}

/* --- wrapping ------------------------------------------------------------- */

test("words break at spaces and never in the middle", () => {
  assert.deepEqual(wrap("Nasi Lemak Ayam Berempah", chars(12), 10, measure), [
    "Nasi Lemak",
    "Ayam",
    "Berempah",
  ]);
});

test("a word wider than the box is left whole for the caller to shrink", () => {
  const lines = wrap("Sedap malam-malam.", chars(6), 10, measure);
  assert.deepEqual(lines, ["Sedap", "malam-malam."]);
});

test("a newline the owner typed is kept", () => {
  assert.deepEqual(wrap("Buka\nsetiap hari", chars(40), 10, measure), ["Buka", "setiap hari"]);
});

/* --- balancing ------------------------------------------------------------ */

test("balancing evens the rag without costing a line", () => {
  const text = "Mee Goreng atau Teh Ais? Ini soalan paling susah di sini.";
  const width = chars(44);
  const greedy = wrap(text, width, 10, measure);
  const even = balanced(text, width, 10, measure);

  assert.equal(even.length, greedy.length, "the same number of lines");

  const spread = (lines: readonly string[]) =>
    Math.max(...lines.map((l) => l.length)) - Math.min(...lines.map((l) => l.length));
  assert.ok(
    spread(even) < spread(greedy),
    `balanced spread ${spread(even)} should beat greedy ${spread(greedy)}`,
  );
});

test("balancing never orphans the last word of a two-line headline", () => {
  const text = "Kedai kecil hidup sebab orang sekitar";
  const even = balanced(text, chars(30), 10, measure);
  assert.equal(even.length, 2);
  assert.ok(even[1].split(" ").length > 1, `last line was "${even[1]}"`);
});

test("a headline that fits on one line is left exactly as it is", () => {
  assert.deepEqual(balanced("Kami dah buka.", chars(40), 10, measure), ["Kami dah buka."]);
});

test("balancing keeps every word, in order", () => {
  const text = "Order bungkus paling banyak datang lepas pukul enam petang.";
  assert.equal(balanced(text, chars(26), 10, measure).join(" "), text);
});

test("a word wider than the squeezed measure falls back to the honest wrap", () => {
  const text = "Nasi kerabu-kelantan-asli memang sedap";
  const even = balanced(text, chars(28), 10, measure);
  assert.equal(even.join(" "), text);
});

/* --- fitting -------------------------------------------------------------- */

test("type that fits the box is not shrunk", () => {
  const fitted = fitText({
    text: "Kami dah buka.",
    width: chars(40),
    height: 200,
    fontPx: 10,
    lineHeight: 1.2,
    autoFit: true,
    measure,
  });
  assert.equal(fitted.fontPx, 10);
});

test("type too tall for its box is stepped down until it fits", () => {
  const fitted = fitText({
    text: "Satu benda ramai tak tahu pasal Masakan Melayu di Kajang ni.",
    width: chars(20),
    height: 30,
    fontPx: 10,
    lineHeight: 1.2,
    autoFit: true,
    measure,
  });
  assert.ok(fitted.fontPx < 10, "it shrank");
  assert.ok(fitted.height <= 30 || fitted.fontPx <= 10 * 0.45, "it fits, or it hit the floor");
});

test("one unbreakable word wider than the box shrinks the type instead of overflowing", () => {
  const fitted = fitText({
    text: "Sedap malam-malam-panjang-sekali.",
    width: chars(14),
    height: 400,
    fontPx: 10,
    lineHeight: 1.2,
    autoFit: true,
    measure,
  });
  assert.ok(fitted.width <= chars(14) + 0.001, `line ran to ${fitted.width}`);
});

test("text that cannot fit even at the floor is shown whole rather than clipped", () => {
  const fitted = fitText({
    text: "Nasi lemak ayam berempah sambal tumis ikan bilis telur mata kerbau timun",
    width: chars(10),
    height: 12,
    fontPx: 10,
    lineHeight: 1.2,
    autoFit: true,
    measure,
  });
  assert.equal(fitted.fontPx, 4.5, "it stopped at the floor");
  assert.equal(fitted.lines.join(" "), fitted.lines.join(" ").trim());
  assert.ok(fitted.lines.length > 1, "and the words are all still there");
});

test("balanced fitting and greedy fitting hold the same words", () => {
  const request = {
    text: "Menu hari ini bukan menu hari pertama, dan itu memang sengaja.",
    width: chars(30),
    height: 300,
    fontPx: 10,
    lineHeight: 1.2,
    autoFit: true,
    measure,
  };
  assert.equal(
    fitText({ ...request, balance: true }).lines.join(" "),
    fitText({ ...request, balance: false }).lines.join(" "),
  );
});

test("autoFit off leaves the size alone", () => {
  const fitted = fitText({
    text: "Panjang sangat ayat ini untuk kotak sekecil ini.",
    width: chars(8),
    height: 10,
    fontPx: 10,
    lineHeight: 1.2,
    autoFit: false,
    measure,
  });
  assert.equal(fitted.fontPx, 10);
});

/* --- placement ------------------------------------------------------------ */

test("a block is placed at the top, the middle or the foot of its box", () => {
  assert.equal(blockTop(100, 200, 40, "top"), 100);
  assert.equal(blockTop(100, 200, 40, "middle"), 180);
  assert.equal(blockTop(100, 200, 40, "bottom"), 260);
});

test("a line is drawn from the edge its alignment names", () => {
  assert.equal(lineX(100, 200, "left"), 100);
  assert.equal(lineX(100, 200, "center"), 200);
  assert.equal(lineX(100, 200, "right"), 300);
});

/* --- the call to action --------------------------------------------------- */

test("a call to action that fits is used whole", () => {
  assert.equal(ctaLine("  Reply  order   anda sekarang. ", 40), "Reply order anda sekarang.");
});

test("a long call to action gives up its later sentences, not its last words", () => {
  const line = ctaLine("Reply sekarang. Kami buka sampai pukul sebelas malam ini.", 20);
  assert.equal(line, "Reply sekarang.");
});

test("one long sentence that will not fit is left off the poster entirely", () => {
  assert.equal(ctaLine("Kalau korang sekitar sini reply atau WhatsApp kami hari ini", 20), "");
});
