import assert from "node:assert/strict";
import test from "node:test";

import { accentFrom, buildPalette, contrast, parseHex, readableOn } from "./palette.ts";
import { fitText, wrap, clampWords, blockTop, lineX } from "./text.ts";

/* --- brand colour --------------------------------------------------------- */

test("a hex the owner typed is used exactly as they typed it", () => {
  assert.equal(accentFrom("#0F7A5A")?.toUpperCase(), "#0F7A5A");
  assert.equal(accentFrom("warna kami #0f7a5a")?.toUpperCase(), "#0F7A5A");
});

test("a colour named in Malay is understood", () => {
  assert.ok(accentFrom("merah dan putih"));
  assert.ok(accentFrom("hijau tua"));
  assert.equal(accentFrom("entahlah"), null);
});

test("with no colour given, the visual style decides", () => {
  const hangat = buildPalette({ brandColours: "", visualStyle: "hangat" });
  const gelap = buildPalette({ brandColours: "", visualStyle: "gelap" });

  assert.notEqual(hangat.accent, gelap.accent);
  assert.notEqual(hangat.base, gelap.base);
});

/**
 * The one property that decides whether a poster can be read at all: the
 * text on the accent must contrast with it. WCAG AA for large text is 3:1;
 * headlines here are very large, but 4.5 is what the palette targets.
 */
test("text on the brand colour is always readable against it", () => {
  for (const colour of ["#FFFF00", "#000000", "#7A7A7A", "#0F7A5A", "#B3261E"]) {
    const palette = buildPalette({ brandColours: colour, visualStyle: "moden" });
    const accent = parseHex(palette.accent);
    const ink = parseHex(palette.accentInk);
    assert.ok(accent && ink);
    assert.ok(
      contrast(accent, ink) >= 4.5,
      `${palette.accent} on ${palette.accentInk} is only ${contrast(accent, ink).toFixed(2)}:1`,
    );
  }
});

test("white text goes on dark, black text goes on light", () => {
  assert.equal(readableOn({ r: 0, g: 0, b: 0 }).toUpperCase(), "#FFFFFF");
  assert.notEqual(readableOn({ r: 255, g: 255, b: 255 }).toUpperCase(), "#FFFFFF");
});

test("a colour that is not a colour does not become one", () => {
  assert.equal(parseHex("hijau"), null);
  assert.equal(parseHex("#12345"), null);
  assert.ok(parseHex("#abc"));
});

/* --- text layout ---------------------------------------------------------- */

const measure = (text: string, px: number) => text.length * px * 0.5;

test("a line wraps at word boundaries, never mid-word", () => {
  const lines = wrap("Nasi Ayam Penyet paling sedap di Kajang", 200, 20, measure);

  for (const line of lines) assert.ok(!line.startsWith(" ") && !line.endsWith(" "));
  assert.equal(lines.join(" "), "Nasi Ayam Penyet paling sedap di Kajang");
});

test("a word wider than the box is left whole rather than hyphenated", () => {
  const lines = wrap("Nasibungkuskampung", 40, 20, measure);

  assert.deepEqual(lines, ["Nasibungkuskampung"]);
});

test("a line break the owner typed is kept", () => {
  assert.deepEqual(wrap("Buka\nsetiap hari", 1000, 20, measure), ["Buka", "setiap hari"]);
});

test("a long headline shrinks to fit instead of overflowing", () => {
  const long = "Nasi ayam penyet paling sedap di seluruh Kajang dan sekitarnya";
  const fitted = fitText({
    text: long,
    width: 400,
    height: 120,
    fontPx: 60,
    lineHeight: 1.1,
    autoFit: true,
    measure,
  });

  assert.ok(fitted.fontPx < 60);
  assert.ok(fitted.height <= 120);
});

test("shrinking has a floor, so text is never reduced to nothing", () => {
  const fitted = fitText({
    text: "Satu ayat yang jauh lebih panjang daripada kotak yang disediakan untuknya",
    width: 60,
    height: 20,
    fontPx: 40,
    lineHeight: 1.2,
    autoFit: true,
    measure,
  });

  assert.ok(fitted.fontPx >= 40 * 0.45);
});

test("a block is placed by its alignment, not by guesswork", () => {
  assert.equal(blockTop(100, 200, 50, "top"), 100);
  assert.equal(blockTop(100, 200, 50, "middle"), 175);
  assert.equal(blockTop(100, 200, 50, "bottom"), 250);
  assert.equal(lineX(10, 100, "left"), 10);
  assert.equal(lineX(10, 100, "center"), 60);
  assert.equal(lineX(10, 100, "right"), 110);
});

test("clamping trims on a word boundary and adds nothing", () => {
  const clamped = clampWords("Datang sekarang sebelum kehabisan stok hari ini", 20);

  assert.ok(clamped.length <= 20);
  assert.ok("Datang sekarang sebelum kehabisan stok hari ini".startsWith(clamped));
  assert.equal(clampWords("Pendek", 20), "Pendek");
});
