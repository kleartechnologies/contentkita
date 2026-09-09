import assert from "node:assert/strict";
import test from "node:test";

import { buildBrief, ownerSuppliedText } from "./brief.ts";
import { DEMO_RESTAURANT } from "./demo.ts";
import type { RestaurantProfile } from "./types.ts";
import {
  checkClaims,
  coerceItem,
  detectLanguage,
  validateResponse,
  type ValidationResult,
} from "./validate.ts";

/**
 * The anti-hallucination gate.
 *
 * These tests are the executable form of the product promise: a restaurant
 * owner is handed copy about their real business, so a price, a discount or a
 * customer quote that nobody supplied must never reach them. Each case below
 * is a specific fabrication a language model reaches for unprompted.
 */

/** A restaurant that supplied almost nothing — the strictest possible brief. */
const BARE: RestaurantProfile = {
  ...DEMO_RESTAURANT,
  id: "bare",
  location: "",
  description: "",
  targetCustomers: "",
  menuNotes: "",
  promotion: null,
  promotionDates: "",
  promotionConditions: "",
};

const DAYS = 30;
const brief = (r: RestaurantProfile) => buildBrief(r, DAYS);
const supplied = (r: RestaurantProfile) => ownerSuppliedText(r);

const dateForDay = (day: number) =>
  `2026-03-${String(day).padStart(2, "0")}`;

/** A structurally perfect day, so tests only vary the thing under test. */
function goodDay(day: number, overrides: Record<string, unknown> = {}) {
  return {
    day,
    objective: "Buat orang teringat kedai kami waktu tengah hari.",
    hook: "Bau kicap panas tu memang tak boleh tipu.",
    caption:
      "Kami masak harian di dapur kecil ni.\n\nSetiap pinggan disiapkan bila anda pesan, jadi memang panas.",
    cta: "Save post ni untuk rujukan nanti.",
    visualIdea: "Ambil dari atas, cahaya siang dari tingkap kiri.",
    videoIdea: "",
    designDirection: "Warna hangat, teks minimum di bawah gambar.",
    hashtags: ["warungkakina", "kajang", "makananmalaysia"],
    ...overrides,
  };
}

/** Every day of the schedule, filled with safe copy. */
function goodMonth(r: RestaurantProfile, overrides: Record<number, Record<string, unknown>> = {}) {
  const b = brief(r);
  return {
    items: b.schedule.map((s) => {
      const extra: Record<string, unknown> = { ...(overrides[s.day] ?? {}) };
      // Video days must carry a video idea or the shape check fails for a
      // reason unrelated to what the test is asserting.
      return goodDay(s.day, { videoIdea: "Shot 1: dapur. Shot 2: pinggan.", ...extra });
    }),
  };
}

function run(r: RestaurantProfile, raw: unknown, expectedDays?: number[]): ValidationResult {
  return validateResponse(raw, {
    brief: brief(r),
    supplied: supplied(r),
    planId: "plan-1",
    dateForDay,
    expectedDays,
  });
}

/* --- shape ---------------------------------------------------------------- */

test("a well formed month of 30 days passes", () => {
  const result = run(BARE, goodMonth(BARE));

  assert.equal(result.ok, true, JSON.stringify(result.violations.slice(0, 3)));
  assert.equal(result.items.length, DAYS);
  assert.deepEqual(result.missingDays, []);
  assert.deepEqual(result.badDays, []);
});

test("items come back sorted by day whatever order the model used", () => {
  const month = goodMonth(BARE);
  const shuffled = { items: [...month.items].reverse() };

  const result = run(BARE, shuffled);

  assert.deepEqual(
    result.items.map((i) => i.day),
    Array.from({ length: DAYS }, (_, i) => i + 1),
  );
});

test("a bare array is accepted as well as an items object", () => {
  const result = run(BARE, goodMonth(BARE).items);

  assert.equal(result.ok, true);
  assert.equal(result.items.length, DAYS);
});

test("a response that is not a list is rejected as malformed", () => {
  const result = run(BARE, { text: "Here is your content plan!" });

  assert.equal(result.ok, false);
  assert.equal(result.violations[0].code, "malformed");
  assert.equal(result.items.length, 0);
  assert.equal(result.missingDays.length, DAYS);
});

test("a short month reports exactly which days never arrived", () => {
  const month = goodMonth(BARE);
  const short = { items: month.items.filter((i) => i.day <= 27) };

  const result = run(BARE, short);

  assert.equal(result.ok, false);
  assert.deepEqual(result.missingDays, [28, 29, 30]);
  assert.equal(result.items.length, 27);
});

test("a repeated day is flagged rather than silently overwriting", () => {
  const month = goodMonth(BARE);
  const dupe = { items: [...month.items, goodDay(5, { hook: "Hook lain." })] };

  const result = run(BARE, dupe);

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === "duplicate" && v.day === 5));
  assert.ok(result.badDays.includes(5));
  // The first copy is still dropped: a day that arrived twice is not trusted.
  assert.ok(!result.items.some((i) => i.day === 5));
});

test("an empty required field fails just that day", () => {
  const result = run(BARE, goodMonth(BARE, { 9: { caption: "   " } }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.badDays, [9]);
  assert.ok(result.violations.some((v) => v.code === "empty:caption"));
  assert.equal(result.items.length, DAYS - 1);
});

test("only the requested days are checked when repairing", () => {
  const result = run(BARE, { items: [goodDay(4, { videoIdea: "Shot demi shot." })] }, [4]);

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].day, 4);
});

/* --- coercion ------------------------------------------------------------- */

test("the schedule wins over a category the model tried to change", () => {
  const { item } = coerceItem(
    goodDay(3, { category: "promotion", platform: "tiktok" }),
    { day: 3, category: "storytelling", platform: "instagram" },
    { planId: "p", date: "2026-03-03", wantsVideo: false },
  );

  assert.ok(item);
  assert.equal(item.category, "storytelling");
});

test("the scheduled platform wins over one the model tried to change", () => {
  const { item } = coerceItem(
    goodDay(3, { platform: "tiktok" }),
    { day: 3, category: "storytelling", platform: "facebook" },
    { planId: "p", date: "2026-03-03", wantsVideo: false },
  );

  assert.ok(item);
  assert.equal(item.platform, "facebook");
});

test("a video day without a video idea is rejected", () => {
  const { item, violations } = coerceItem(
    goodDay(3, { videoIdea: "" }),
    { day: 3, category: "reels", platform: "instagram" },
    { planId: "p", date: "2026-03-03", wantsVideo: true },
  );

  assert.equal(item, null);
  assert.ok(violations.some((v) => v.code === "empty:videoIdea"));
});

test("hashtags are cleaned of hashes, blanks and non-strings", () => {
  const { item } = coerceItem(
    goodDay(3, { hashtags: ["#kajang", "  ", 12, "nasilemak"] }),
    { day: 3, category: "storytelling", platform: "instagram" },
    { planId: "p", date: "2026-03-03", wantsVideo: false },
  );

  assert.ok(item);
  assert.deepEqual(item.hashtags, ["kajang", "nasilemak"]);
});

test("an AI day is always regenerable — variantCount is unbounded", () => {
  const { item } = coerceItem(
    goodDay(3),
    { day: 3, category: "storytelling", platform: "instagram" },
    { planId: "plan-9", date: "2026-03-03", wantsVideo: false },
  );

  assert.ok(item);
  assert.equal(item.variantCount, 0);
  assert.equal(item.edited, false);
  assert.equal(item.id, "plan-9-d3");
});

test("a day that is not an object is malformed, not a crash", () => {
  const { item, violations } = coerceItem(
    "Hari 3: nasi lemak sedap",
    { day: 3, category: "storytelling", platform: "instagram" },
    { planId: "p", date: "2026-03-03", wantsVideo: false },
  );

  assert.equal(item, null);
  assert.equal(violations[0].code, "malformed");
});

/* --- invented facts ------------------------------------------------------- */

/** Runs one day of copy through the claim checker against a given profile. */
function claims(r: RestaurantProfile, fields: Record<string, unknown>): string[] {
  const { item } = coerceItem(
    goodDay(1, fields),
    { day: 1, category: "storytelling", platform: "instagram" },
    { planId: "p", date: "2026-03-01", wantsVideo: false },
  );
  assert.ok(item, "day should be structurally valid");
  return checkClaims(item, brief(r), supplied(r)).map((v) => v.code);
}

test("a price nobody supplied is rejected", () => {
  assert.ok(claims(BARE, { caption: "Nasi ayam kami RM8.90 sahaja." }).includes("price"));
});

test("the owner's own price is allowed through", () => {
  // DEMO_RESTAURANT's promotion text contains RM12.90.
  assert.ok(
    !claims(DEMO_RESTAURANT, { caption: "Set Lunch RM12.90 kami masih ada." }).includes("price"),
  );
});

test("a price the owner never wrote is rejected even when they wrote another", () => {
  assert.ok(
    claims(DEMO_RESTAURANT, { caption: "Mee goreng RM6.50 pun sedap." }).includes("price"),
  );
});

test("an invented promotion is rejected when there is none", () => {
  assert.ok(claims(BARE, { cta: "Datang sekarang, diskaun 20% hari ini!" }).includes("promotion"));
});

test("a percentage discount is rejected when there is none", () => {
  assert.ok(claims(BARE, { caption: "Potongan 30 peratus untuk hari ini." }).includes("percentage"));
});

test("an invented testimonial is rejected", () => {
  assert.ok(
    claims(DEMO_RESTAURANT, {
      caption: "Kata pelanggan, ini nasi ayam paling best dia pernah rasa.",
    }).includes("testimonial"),
  );
});

test("an invented halal claim is rejected when the owner never said so", () => {
  assert.ok(claims(BARE, { caption: "Semua bahan kami halal dan bersih." }).includes("halal"));
});

test("an invented opening hour is rejected", () => {
  assert.ok(claims(BARE, { cta: "Kami buka pukul 8 pagi setiap hari." }).includes("hours"));
});

test("an invented delivery service is rejected", () => {
  assert.ok(claims(BARE, { cta: "Order je kat GrabFood." }).includes("delivery"));
});

test("a 'number one in Malaysia' claim is rejected", () => {
  assert.ok(
    claims(BARE, { hook: "Nasi ayam nombor satu di Malaysia ada di sini." }).includes(
      "superlative",
    ),
  );
});

test("an invented award is rejected", () => {
  assert.ok(claims(BARE, { caption: "Kami pemenang anugerah warung terbaik." }).includes("award"));
});

test("invented customer statistics are rejected", () => {
  assert.ok(claims(BARE, { caption: "Lebih 5000 pelanggan sudah cuba." }).includes("statistic"));
});

test("invented scarcity is rejected", () => {
  assert.ok(claims(BARE, { cta: "Stok terhad, hari terakhir!" }).includes("scarcity"));
});

test("an invented guarantee is rejected", () => {
  assert.ok(claims(BARE, { caption: "Dijamin sedap atau wang dikembalikan." }).includes("guarantee"));
});

test("invented nutrition claims are rejected", () => {
  assert.ok(claims(BARE, { caption: "Hanya 200 kalori dan rendah lemak." }).includes("nutrition"));
});

test("Indonesian phrasing is rejected as not Malaysian", () => {
  assert.ok(claims(BARE, { caption: "Enak banget, nggak boleh dilewatkan." }).includes("indonesian"));
});

test("honest copy about the shop passes every claim rule", () => {
  assert.deepEqual(claims(BARE, {}), []);
});

test("a hashtag cannot smuggle a claim past the checker", () => {
  assert.ok(claims(BARE, { hashtags: ["diskaun50"] }).length > 0);
});

test("an invented claim inside a whole month fails only that day", () => {
  const result = run(BARE, goodMonth(BARE, { 12: { cta: "Diskaun 50% hari ini sahaja!" } }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.badDays, [12]);
  assert.equal(result.items.length, DAYS - 1);
});

/* --- language ------------------------------------------------------------- */

test("Malay copy is detected as Malay", () => {
  assert.equal(
    detectLanguage("Kami masak dengan resipi yang memang orang tua kami guna dulu."),
    "ms",
  );
});

test("English copy is detected as English", () => {
  assert.equal(detectLanguage("We cook the food you and your family come back for."), "en");
});

test("natural Malaysian rojak is not forced into one language", () => {
  assert.equal(detectLanguage("Jom order lunch dengan kami, the food memang sedap."), "mixed");
});

test("an English month is rejected when the owner asked for Malay", () => {
  const result = run(
    BARE,
    goodMonth(BARE, {
      7: {
        hook: "The food you and your family come back for.",
        caption: "We cook the food that you and we love, with the same care every day.",
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === "language" && v.day === 7));
});

test("a Malay day is accepted when the owner asked for rojak", () => {
  const rojak: RestaurantProfile = { ...BARE, language: "rojak" };
  const result = run(rojak, goodMonth(rojak));

  assert.equal(result.ok, true);
});
