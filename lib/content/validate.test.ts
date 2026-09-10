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

/**
 * Openings that do not repeat.
 *
 * The validator rejects a batch whose hooks all start with the same word, so a
 * fixture that reused one hook thirty times would fail every test in this file
 * for a reason none of them is about.
 */
const OPENINGS = [
  "Bau kicap panas tu memang tak boleh tipu.",
  "Dapur kami start pukul enam pagi.",
  "Nak tahu kenapa kuah ni pekat?",
  "Setiap pinggan disiapkan bila anda pesan.",
  "Ada satu meja yang orang selalu rebut.",
  "Kicap, bawang, api besar. Itu je.",
  "Orang tanya kami guna resepi siapa.",
  "Petang ni dapur agak sibuk.",
  "Tiga bahan sahaja dalam sambal ni.",
  "Hujan turun, kedai jadi penuh.",
  "Kuali besar tu tak pernah sejuk.",
  "Sebelum kedai buka, sup dah mendidih.",
  "Pagi tadi ikan sampai dalam bekas ais.",
  "Meja tepi tingkap paling cepat penuh.",
  "Kalau anda tanya kami mana satu sedap, susah nak jawab.",
  "Api besar, tangan laju, siap.",
  "Bawang goreng kami digoreng sendiri.",
  "Rasa pedas ni datang dari cili kering.",
  "Sejak kedai buka, menu ni tak pernah tukar.",
  "Lepas azan Zohor, barisan mula panjang.",
  "Nasi panas, kuah banyak, itu je permintaan biasa.",
  "Tukang masak kami suka bahagian ni.",
  "Waktu tengah hari memang paling riuh.",
  "Santan diperah pagi, bukan semalam.",
  "Kadang orang datang cari satu benda sahaja.",
  "Ikan bakar kena kipas tangan, bukan mesin.",
  "Belakang dapur ada satu periuk lama.",
  "Roti dicanai depan mata anda.",
  "Cuaca sejuk macam ni sesuai untuk sup.",
  "Duduk sekejap, biar kami hidangkan.",
];

/** A structurally perfect day, so tests only vary the thing under test. */
function goodDay(day: number, overrides: Record<string, unknown> = {}) {
  return {
    day,
    objective: "Buat orang teringat kedai kami waktu tengah hari.",
    hook: OPENINGS[(Math.max(day, 1) - 1) % OPENINGS.length],
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

function run(
  r: RestaurantProfile,
  raw: unknown,
  expectedDays?: number[],
  written?: readonly string[],
): ValidationResult {
  return validateResponse(raw, {
    brief: brief(r),
    supplied: supplied(r),
    planId: "plan-1",
    dateForDay,
    expectedDays,
    written,
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

test("the owner's own price glued into a hashtag is not a new price", () => {
  // A hashtag loses its punctuation, so RM12.90 becomes `setlunchrm1290`. Read
  // without a word boundary that is the invented price RM1,290, and a day that
  // said nothing wrong gets rejected — which is exactly how a benchmarked month
  // lost six days. Nobody reads a price out of the middle of a word.
  assert.ok(
    !claims(DEMO_RESTAURANT, { hashtags: ["setlunchrm1290", "kajangfood"] }).includes("price"),
  );
});

test("a price is still caught in a hashtag when it stands on its own", () => {
  assert.ok(claims(DEMO_RESTAURANT, { hashtags: ["rm5", "lunch"] }).includes("price"));
});

test("an invented colleague is rejected", () => {
  // Taken verbatim from a real production plan: the profile named only the
  // owner, and the model introduced a cook and told customers they knew her.
  assert.ok(
    claims(BARE, {
      caption: "Dekat dapur, Pak Din sibuk dengan kuali, Kak Yah pulak jaga nasi kukus.",
    }).includes("person"),
  );
});

test("a person the owner did name is allowed through", () => {
  const named: RestaurantProfile = {
    ...BARE,
    description: "Warung kecil tepi jalan. Pak Din masak sendiri setiap pagi.",
  };

  assert.ok(
    !claims(named, { caption: "Pak Din mula masak awal pagi." }).includes("person"),
  );
});

test("naming staff generically is not a violation", () => {
  assert.ok(
    !claims(BARE, {
      caption: "Staf dapur mula kerja awal pagi, sebelum warung buka pintu.",
    }).includes("person"),
  );
});

test("a customer quote is rejected however the attribution is phrased", () => {
  // Both taken from a real production plan. The old rule looked for
  // "pelanggan kata"; these said "orang cakap" and "katanya" and walked through.
  for (const caption of [
    "Dengar je orang cakap \"Rugi kalau tak try nasi kukus ni.\"",
    "Ada pelanggan pesan dua kali sebab katanya tak cukup.",
  ]) {
    assert.ok(claims(BARE, { caption }).includes("testimonial"), caption);
  }
});

test("words put in somebody's mouth are rejected even with no attribution", () => {
  assert.ok(claims(BARE, { caption: "Sampai ada yang cakap: \"Sedap sangat ni!\"" }).length > 0);
});

test("text meant to be placed on the image may be quoted", () => {
  // designDirection routinely quotes on-image copy; that is not a testimonial.
  assert.ok(
    !claims(BARE, { designDirection: "Letak teks kecil \"Masak Setiap Pagi\" di bawah." })
      .includes("quote"),
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

/**
 * The obvious Indonesian slang was already caught. The words that actually get
 * through are the ones that look like Malay because they nearly are: a
 * benchmarked month opened day 9 with "jadi bagian dari rezeki kami" and every
 * counter called it clean Malaysian BM. Malaysians write "bahagian".
 */
test("Indonesian words that look almost Malaysian are rejected too", () => {
  for (const word of ["bagian", "emang", "kayak", "nomor", "temen"]) {
    assert.ok(
      claims(BARE, { caption: `Terima kasih sebab jadi ${word} dari hari kami.` }).includes(
        "indonesian",
      ),
      `"${word}" should read as Indonesian`,
    );
  }
});

/** "bahagian" is the Malaysian spelling and must not trip the rule above. */
test("the Malaysian spelling of the same word is fine", () => {
  assert.deepEqual(claims(BARE, { caption: "Terima kasih sebab jadi sebahagian dari hari kami." }), []);
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

test("a precise time nobody gave us is not invented on the strength of another one", () => {
  // The owner said 6.30 in their own description, which licenses talk of
  // hours. It does not license 7.15 — a checkable claim about a real shop.
  const owner: RestaurantProfile = {
    ...BARE,
    description: "Kedai sarapan yang buka dari pukul 6.30 pagi.",
  };

  assert.equal(
    run(owner, goodMonth(owner, { 5: { hook: "Pukul 6.30 pagi, dapur dah hidup." } })).ok,
    true,
  );

  const invented = run(owner, goodMonth(owner, { 5: { hook: "Pukul 7.15 pagi, meja dah penuh." } }));
  assert.equal(invented.ok, false);
  assert.ok(invented.violations.some((v) => v.code === "time" && v.day === 5));
});

test("the owner's time is recognised however the caption writes it", () => {
  const owner: RestaurantProfile = {
    ...BARE,
    description: "Kedai sarapan yang buka dari pukul 6.30 pagi.",
  };

  assert.equal(run(owner, goodMonth(owner, { 5: { hook: "6:30 pagi dapur dah hidup." } })).ok, true);
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

/* --- voice ---------------------------------------------------------------- */

/**
 * The rules that decide whether a caption sounds like a restaurant or like a
 * machine. They are not fabrications, so they are not about truth — they are
 * about whether the owner would put their name on it.
 */

test("a caption spammed with emoji is sent back", () => {
  const result = run(
    BARE,
    goodMonth(BARE, {
      4: {
        caption:
          "Sedap 😋 panas 🔥 murah 💰 datang 🏃 sekarang 🎉\n\nMemang berbaloi 👍 sangat 😍",
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === "emoji" && v.day === 4));
});

test("three emoji are within what a real caption uses", () => {
  const result = run(
    BARE,
    goodMonth(BARE, {
      4: { caption: "Sambal ni pekat sikit hari ni 🌶️\n\nDatang awal kalau suka pedas 😄🔥" },
    }),
  );

  assert.equal(result.ok, true);
});

test("the old advertisement clichés are refused", () => {
  const result = run(
    BARE,
    goodMonth(BARE, {
      9: {
        caption:
          "Jangan lepaskan peluang ini.\n\nDatang dan rasa sendiri apa yang kami masak setiap pagi.",
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === "cliche" && v.day === 9));
});

test("a call to action too long to print on the poster is sent back", () => {
  // Not a matter of taste. The CTA is drawn inside a badge on the creative,
  // and a sentence that does not fit is left off it — so a CTA written this
  // long is one the owner paid for and never sees.
  const result = run(
    BARE,
    goodMonth(BARE, {
      12: {
        cta: "Kalau korang sekitar sini, reply atau WhatsApp kalau nak tanya apa yang ada pagi ni.",
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === "long_cta" && v.day === 12));
});

test("a short call to action passes untouched", () => {
  const result = run(BARE, goodMonth(BARE, { 12: { cta: "Simpan post ni dulu." } }));

  assert.equal(result.ok, true);
});

test("a hook the pack already used is sent back to be rewritten", () => {
  // Days 8 and 16 are written in different batches, so nothing inside either
  // one can see the repeat. The pack's own hooks are what catch it.
  const result = run(BARE, goodMonth(BARE, { 16: { hook: "Saya akui, kedai ni tak besar." } }), [16], [
    "Saya akui, kedai ni tak besar.",
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === "repeated_hook" && v.day === 16));
});

test("punctuation and capitals do not make a repeated hook a new one", () => {
  const result = run(BARE, goodMonth(BARE, { 16: { hook: "SAYA AKUI — kedai ni tak besar!" } }), [16], [
    "Saya akui, kedai ni tak besar.",
  ]);

  assert.ok(result.violations.some((v) => v.code === "repeated_hook" && v.day === 16));
});

test("a hook nobody has used passes", () => {
  const result = run(BARE, goodMonth(BARE, { 16: { hook: "Dapur dah hidup." } }), [16], [
    "Saya akui, kedai ni tak besar.",
  ]);

  assert.equal(result.ok, true, JSON.stringify(result.violations.slice(0, 3)));
});
