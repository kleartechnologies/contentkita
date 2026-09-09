import { extractPrices, normalisePrice, type RestaurantBrief } from "./brief.ts";
import { CATEGORY_META } from "./categories.ts";
import { wantsVideo } from "./schedule.ts";
import type { ContentCategory, ContentItem, Platform } from "./types.ts";

/**
 * The gate every generated day must pass before an owner ever sees it.
 *
 * Model output is treated as untrusted input. Two separate jobs happen here:
 *
 *  1. **Shape.** Exactly the days asked for, numbered once each, every required
 *     field present and non-empty, category and platform inside the enum. A
 *     malformed month is rejected outright rather than rendered with gaps.
 *
 *  2. **Claims.** Copy is checked against the brief's `quotable` facts. A price
 *     the owner never wrote, a discount they are not running, a halal
 *     certification nobody mentioned, an invented testimonial — each is a
 *     factual statement about a real business that we have no basis for, and
 *     each fails the day.
 *
 * This is deliberately a keyword-and-pattern pass, not a model-graded one: it
 * is cheap, deterministic, offline-testable, and it catches the specific
 * fabrications that actually damage a restaurant. It is not, and does not claim
 * to be, a general-purpose truth checker.
 */

export interface Violation {
  day: number;
  /** Stable identifier, useful in tests and in the repair prompt. */
  code: string;
  /** Written for the model, in the imperative — this text is fed back on retry. */
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  items: ContentItem[];
  violations: Violation[];
  /** Days that failed and must be rewritten. Sorted, unique. */
  badDays: number[];
  /** Days the model never returned at all. */
  missingDays: number[];
}

const REQUIRED_TEXT = [
  "hook",
  "caption",
  "cta",
  "visualIdea",
  "designDirection",
] as const;

/** Percentages, written either way round. */
const PERCENT = /\b\d{1,3}\s*(?:%|peratus|percent)\b/gi;

interface ClaimRule {
  code: string;
  pattern: RegExp;
  detail: string;
  /** When true the rule is skipped — the owner licensed this subject. */
  licensed: (brief: RestaurantBrief, supplied: string) => boolean;
}

const never = () => false;

const CLAIM_RULES: ClaimRule[] = [
  {
    code: "promotion",
    pattern:
      /\b(?:promosi|promo|diskaun|diskon|discount|potongan harga|rebat|percuma|free\b|gratis|sale\b|offer\b|tawaran istimewa|beli\s*\d+\s*(?:percuma|free)|buy\s*\d+\s*get)/gi,
    detail:
      "Restoran ini TIADA promosi. Buang semua sebutan promosi, diskaun, tawaran atau apa-apa yang percuma. Tulis hari ini tanpa jualan.",
    licensed: (brief) => brief.quotable.promotion !== null,
  },
  {
    code: "percentage",
    pattern: PERCENT,
    detail:
      "Buang peratusan diskaun. Tiada potongan harga yang disahkan oleh pemilik.",
    licensed: (brief, supplied) => PERCENT.test(supplied) && brief.quotable.promotion !== null,
  },
  {
    code: "halal",
    pattern: /\bhalal\b/gi,
    detail:
      "Jangan sebut status halal. Pemilik tidak memberitahu kami dan ini dakwaan pensijilan.",
    licensed: (_brief, supplied) => /\bhalal\b/i.test(supplied),
  },
  {
    code: "delivery",
    pattern: /\b(?:grabfood|grab\b|foodpanda|shopeefood|delivery|penghantaran|dihantar ke rumah)/gi,
    detail:
      "Jangan sebut delivery atau mana-mana platform penghantaran. Kami tidak tahu restoran ini menyediakannya.",
    licensed: (_brief, supplied) =>
      /(delivery|penghantar|grab|foodpanda|shopee)/i.test(supplied),
  },
  {
    code: "hours",
    pattern: /\b(?:buka\s+(?:pukul|jam|dari)|tutup\s+(?:pukul|jam)|\d{1,2}\s*(?:am|pm)\b|\d{1,2}\s*pagi\b|\d{1,2}\s*malam\b)/gi,
    detail:
      "Jangan nyatakan waktu operasi. Pemilik tidak memberi waktu buka atau tutup.",
    licensed: (_brief, supplied) =>
      /(buka|tutup)\s*(pukul|jam|dari)|\d{1,2}\s*(am|pm)\b/i.test(supplied),
  },
  {
    code: "superlative",
    pattern:
      /\b(?:nombor\s*satu|no\.?\s*1\b|#1|number\s*one|terbaik\s+(?:di|dalam|se)|paling\s+sedap\s+(?:di|dalam|se)|best\s+in\s+\w+|terkenal\s+se|paling\s+terkenal|tiada\s+tandingan|juara)/gi,
    detail:
      "Buang dakwaan 'terbaik', 'nombor satu' atau seumpamanya. Kami tiada bukti untuk kedudukan begini.",
    licensed: never,
  },
  {
    code: "award",
    pattern:
      /\b(?:anugerah|award|pemenang|bersijil|certified|pensijilan|diiktiraf|liputan media|pernah masuk (?:tv|berita))/gi,
    detail:
      "Buang sebutan anugerah, pensijilan atau pengiktirafan. Tiada satu pun yang disahkan oleh pemilik.",
    licensed: never,
  },
  {
    code: "testimonial",
    pattern:
      /\b(?:kata\s+pelanggan|pelanggan\s+(?:kata|cakap|beritahu)|menurut\s+pelanggan|ramai\s+(?:yang\s+)?(?:kata|cakap|komen)|orang\s+(?:kata|cakap)|kata(?:nya|\s+mereka)|dengar\s+(?:je\s+)?orang|testimoni|review\s+pelanggan|customers?\s+(?:say|said)|ulasan\s+pelanggan)/gi,
    detail:
      "Jangan reka kata-kata pelanggan. Kalau mahu guna social proof, minta pemilik kongsi screenshot sebenar — jangan tulis ayat pelanggan.",
    licensed: never,
  },
  {
    code: "statistic",
    pattern:
      /\b(?:\d[\d,.]*\s*(?:\+\s*)?(?:pelanggan|orang\s+dah|customers?|pinggan\s+terjual|unit\s+terjual)|\d(?:[.,]\d)?\s*(?:bintang|stars?)\b|rating\s*\d)/gi,
    detail:
      "Buang semua nombor tentang pelanggan, jualan atau rating. Kami tidak mempunyai angka sebenar.",
    licensed: never,
  },
  {
    code: "scarcity",
    pattern:
      /\b(?:stok\s+terhad|limited\s+(?:stock|time)|sementara\s+stok|hari\s+terakhir|last\s+call|kuota\s+terhad|first\s+come|selagi\s+ada\s+stok|jangan\s+lepaskan\s+peluang)/gi,
    detail:
      "Buang unsur 'stok terhad' atau desakan masa palsu. Tiada tarikh tamat atau had stok yang disahkan.",
    licensed: never,
  },
  {
    code: "guarantee",
    pattern: /\b(?:dijamin|jaminan|guarantee[ds]?|pasti\s+puas\s+hati|wang\s+dikembalikan|money\s*back)/gi,
    detail: "Buang sebarang jaminan. Kami tidak boleh menjanjikan hasil bagi pihak restoran.",
    licensed: never,
  },
  {
    code: "nutrition",
    pattern: /\b(?:kalori|calories|rendah\s+lemak|sihat\s+untuk|khasiat|zat\s+pemakanan|bebas\s+gluten|sugar\s*free)/gi,
    detail:
      "Buang dakwaan pemakanan atau kesihatan. Tiada maklumat nutrisi yang diberikan.",
    licensed: never,
  },
  {
    code: "indonesian",
    pattern:
      /\b(?:banget|nggak|ngga|gak|udah|gimana|kalian|doang|bikin|yuk\b|aja\b|kuliner|mantul|lho\b|deh\b|sih\b|bagian|emang|kayak|nomor|kantor|pengen|ngobrol|temen|cewek|cowok)/gi,
    detail:
      "Bahasa ini berbunyi Indonesia, bukan Malaysia. Tulis semula dalam Bahasa Melayu Malaysia yang natural.",
    licensed: never,
  },
];

/* ------------------------------ shape checks ------------------------------ */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A single raw day from the model, turned into a `ContentItem` or rejected.
 *
 * The scheduled category and platform win over whatever the model echoed back:
 * the strategy is ours, and letting a model silently re-plan the month would
 * undo the spacing that keeps the feed from reading as one long advert.
 */
export function coerceItem(
  raw: unknown,
  slot: { day: number; category: ContentCategory; platform: Platform },
  meta: { planId: string; date: string; wantsVideo: boolean },
): { item: ContentItem | null; violations: Violation[] } {
  const violations: Violation[] = [];
  const bad = (code: string, detail: string) =>
    violations.push({ day: slot.day, code, detail });

  if (typeof raw !== "object" || raw === null) {
    bad("malformed", "Hari ini bukan objek JSON yang sah.");
    return { item: null, violations };
  }
  const d = raw as Record<string, unknown>;

  for (const field of REQUIRED_TEXT) {
    if (!text(d[field])) bad(`empty:${field}`, `Medan "${field}" kosong. Isi dengan ayat penuh.`);
  }
  if (violations.length) return { item: null, violations };

  // Whatever the model echoed back in `category`/`platform` is discarded. The
  // schedule already decided both, and it decided them from facts the model
  // does not have — a `promotion` day is only in the plan when a real offer
  // exists, and a platform is only used when the owner actually posts there.
  const { category, platform } = slot;

  const videoIdea = text(d.videoIdea) || null;
  if (meta.wantsVideo && !videoIdea) {
    bad("empty:videoIdea", "Hari ini perlukan videoIdea kerana ia post video.");
    return { item: null, violations };
  }

  const hashtags = Array.isArray(d.hashtags)
    ? d.hashtags
        .filter((h): h is string => typeof h === "string")
        .map((h) => h.replace(/^#/, "").trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

  return {
    item: {
      id: `${meta.planId}-d${slot.day}`,
      planId: meta.planId,
      day: slot.day,
      date: meta.date,
      category,
      platform,
      // Not asked of the model. The purpose of a `best_seller` day is the same
      // sentence every time, it is already written by hand in `CATEGORY_META`,
      // and it was already sent to the writer as the schedule line's `tujuan:`.
      // Having it typed back costs output tokens to receive a paraphrase of
      // something we hold — and measurably a worse one: across four benchmarked
      // months the model either echoed the line verbatim or reworded it into
      // something flatter ("supaya orang boleh bayangkan suasana makan di
      // sini").
      objective: CATEGORY_META[category].purpose,
      hook: text(d.hook),
      caption: text(d.caption),
      cta: text(d.cta),
      visualIdea: text(d.visualIdea),
      videoIdea,
      designDirection: text(d.designDirection),
      hashtags,
      variantIndex: 0,
      // The AI engine has no fixed pool of alternatives, so regeneration is
      // always available. Zero means "unbounded" to the UI.
      variantCount: 0,
      edited: false,
    },
    violations,
  };
}

/* ------------------------------ claim checks ------------------------------ */

/** Everything in a day that an owner's audience would read as a statement. */
function claimText(item: ContentItem): string {
  return [
    // `objective` is absent on purpose: the app writes it from `CATEGORY_META`,
    // so it is our own fixed copy rather than a claim the model made.
    item.hook,
    item.caption,
    item.cta,
    item.visualIdea,
    item.videoIdea ?? "",
    item.designDirection,
    item.hashtags.join(" "),
  ].join("\n");
}

/**
 * Prices are checked by value, not by phrasing: any amount that does not appear
 * in the owner's own words is invented, however plausibly it is written.
 */
function checkPrices(item: ContentItem, allowed: string[]): Violation[] {
  const used = extractPrices(claimText(item));
  const invented = used.filter((p) => !allowed.includes(normalisePrice(p)));
  if (invented.length === 0) return [];
  return [
    {
      day: item.day,
      code: "price",
      detail:
        allowed.length === 0
          ? "Buang semua harga. Pemilik tidak memberi sebarang harga, jadi tiada harga boleh disebut."
          : `Harga ${invented.join(", ")} tidak pernah diberikan oleh pemilik. Harga yang dibenarkan hanyalah: ${allowed.join(", ")}.`,
    },
  ];
}

/**
 * Malay honorifics that introduce a person by name: `Pak Din`, `Kak Yah`.
 *
 * Only the honorific form is matched. A bare capitalised word is far too often
 * a dish, a place or the start of a sentence, and flagging those would train an
 * owner to ignore the warnings that matter.
 */
const PERSON =
  /\b(?:Pak|Mak|Kak|Abang|Bang|Cik|Encik|Puan|Tuan|Wak|Along|Angah|Makcik|Pakcik|Ustaz|Ustazah|Datuk|Dato|Haji|Hajah|Chef|Uncle|Auntie)\s+([A-Z][a-z]+)/g;

/**
 * People are checked by name, the way prices are checked by value.
 *
 * A caption that introduces "Kak Yah" to customers who are told they already
 * know her face is a fabricated colleague, and it is the kind of invention an
 * owner is least likely to catch: it reads like something they told us. So a
 * named person is allowed only when that exact name appears in the owner's own
 * words.
 */
function checkPeople(item: ContentItem, supplied: string): Violation[] {
  const known = supplied.toLowerCase();
  const invented: string[] = [];

  PERSON.lastIndex = 0;
  for (const match of claimText(item).matchAll(PERSON)) {
    const name = match[0].replace(/\s+/g, " ").trim();
    if (known.includes(name.toLowerCase())) continue;
    if (!invented.includes(name)) invented.push(name);
  }
  if (invented.length === 0) return [];

  return [
    {
      day: item.day,
      code: "person",
      detail:
        `Nama ${invented.join(", ")} tidak pernah disebut oleh pemilik. Jangan reka nama ` +
        `pekerja, tukang masak atau ahli keluarga. Rujuk mereka secara umum — "staf dapur", ` +
        `"orang belakang tabir" — atau tulis hari ini tanpa menamakan sesiapa.`,
    },
  ];
}

/**
 * A quoted utterance inside the copy an owner would publish.
 *
 * Matched only in the hook, caption and CTA. `designDirection` and
 * `visualIdea` legitimately quote words to place on an image — `Teks kecil
 * "Sejak 2011"` — and flagging those would be wrong.
 *
 * Anything in quotation marks that the owner did not write is a line the model
 * put in somebody's mouth. Two of these reached a real generated plan
 * ("Rugi kalau tak try...", 'tak cukup') and neither tripped the testimonial
 * rule, because the sentence around them attributed the words to "orang" rather
 * than to "pelanggan". Checking the quotation itself does not depend on how the
 * attribution happens to be phrased.
 */
const QUOTED = /["“]([^"“”]{8,200})["”]|'([^']{8,200})'/g;

function checkQuotes(item: ContentItem, supplied: string): Violation[] {
  const body = [item.hook, item.caption, item.cta].join("\n");
  const known = supplied.toLowerCase();
  const invented: string[] = [];

  QUOTED.lastIndex = 0;
  for (const match of body.matchAll(QUOTED)) {
    const quote = (match[1] ?? match[2]).trim();
    if (known.includes(quote.toLowerCase())) continue;
    if (!invented.includes(quote)) invented.push(quote);
  }
  if (invented.length === 0) return [];

  return [
    {
      day: item.day,
      code: "quote",
      detail:
        `Ayat dalam tanda petik ("${invented[0]}") direka. Jangan tulis kata-kata ` +
        `pelanggan, pekerja atau sesiapa yang tidak diberikan oleh pemilik. Tulis ayat ` +
        `itu sebagai suara restoran sendiri, tanpa tanda petik.`,
    },
  ];
}

export function checkClaims(
  item: ContentItem,
  brief: RestaurantBrief,
  supplied: string,
): Violation[] {
  const body = claimText(item);
  const out: Violation[] = [
    ...checkPrices(item, brief.quotable.prices),
    ...checkPeople(item, supplied),
    ...checkQuotes(item, supplied),
  ];

  for (const rule of CLAIM_RULES) {
    if (rule.licensed(brief, supplied)) continue;
    // Regexes carry /g, so lastIndex must not leak between days.
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(body)) {
      out.push({ day: item.day, code: rule.code, detail: rule.detail });
    }
    rule.pattern.lastIndex = 0;
  }

  return out;
}

/* -------------------------------- language -------------------------------- */

const MALAY_MARKERS =
  /\b(?:yang|dengan|untuk|kami|anda|dah|tak|ni\b|tu\b|boleh|memang|kalau|sedap|makan|datang|orang)\b/gi;
const ENGLISH_MARKERS =
  /\b(?:the|and|with|your|our|you|we|this|that|come|eat|food|taste|order)\b/gi;

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0;
  return (text.match(re) ?? []).length;
}

/**
 * A deliberately coarse reading of which language a caption is in.
 *
 * Only used to catch a plan written wholesale in the wrong language — a mixed
 * sentence or a borrowed English word is normal Malaysian writing and must not
 * be flagged.
 */
export function detectLanguage(text: string): "ms" | "en" | "mixed" {
  const ms = countMatches(text, MALAY_MARKERS);
  const en = countMatches(text, ENGLISH_MARKERS);
  if (ms === 0 && en === 0) return "mixed";
  if (ms >= en * 2) return "ms";
  if (en >= ms * 2) return "en";
  return "mixed";
}

function checkLanguage(item: ContentItem, brief: RestaurantBrief): Violation[] {
  if (brief.language === "rojak") return [];
  const found = detectLanguage(`${item.hook} ${item.caption}`);
  if (found === "mixed") return [];
  if (brief.language === "ms" && found === "en") {
    return [
      {
        day: item.day,
        code: "language",
        detail: "Tulis semula dalam Bahasa Melayu. Hari ini ditulis dalam English.",
      },
    ];
  }
  if (brief.language === "en" && found === "ms") {
    return [
      {
        day: item.day,
        code: "language",
        detail: "Rewrite this day in English. It came back in Malay.",
      },
    ];
  }
  return [];
}

/* -------------------------------- the gate -------------------------------- */

export interface ValidateOptions {
  brief: RestaurantBrief;
  /** Everything the owner typed, for licensing checks. */
  supplied: string;
  planId: string;
  /** Maps a day number to its calendar date. */
  dateForDay: (day: number) => string;
  /** Only these days are expected; the rest of the plan is left alone. */
  expectedDays?: number[];
}

/**
 * Validates a whole model response.
 *
 * Returns every item that passed alongside every violation found, so a caller
 * can repair just the failing days rather than paying for the month again.
 */
export function validateResponse(
  raw: unknown,
  options: ValidateOptions,
): ValidationResult {
  const { brief, supplied, planId, dateForDay } = options;
  const expected = options.expectedDays ?? brief.schedule.map((s) => s.day);
  const violations: Violation[] = [];
  const items: ContentItem[] = [];

  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: unknown[] }).items)
      : null;

  if (!list) {
    return {
      ok: false,
      items: [],
      violations: [
        {
          day: 0,
          code: "malformed",
          detail: "Balasan bukan senarai hari. Pulangkan JSON dengan medan \"items\".",
        },
      ],
      badDays: [],
      missingDays: expected,
    };
  }

  const byDay = new Map<number, unknown>();
  const duplicates: number[] = [];
  for (const entry of list) {
    const day =
      typeof entry === "object" && entry !== null
        ? Number((entry as { day?: unknown }).day)
        : NaN;
    if (!Number.isInteger(day) || !expected.includes(day)) continue;
    if (byDay.has(day)) {
      if (!duplicates.includes(day)) duplicates.push(day);
      continue;
    }
    byDay.set(day, entry);
  }

  for (const day of duplicates) {
    violations.push({
      day,
      code: "duplicate",
      detail: `Hari ${day} dihantar lebih daripada sekali. Hantar setiap hari sekali sahaja.`,
    });
  }

  const missingDays: number[] = [];
  const badDays = new Set<number>(duplicates);

  for (const day of expected) {
    const slot = brief.schedule.find((s) => s.day === day);
    if (!slot) continue;

    // A duplicated day is already condemned; emitting the first copy as well
    // would put the same day in `items` and `badDays` at once.
    if (duplicates.includes(day)) continue;

    const entry = byDay.get(day);
    if (entry === undefined) {
      missingDays.push(day);
      continue;
    }

    const { item, violations: shape } = coerceItem(entry, slot, {
      planId,
      date: dateForDay(day),
      wantsVideo: wantsVideo(slot.category, slot.platform),
    });

    if (!item) {
      violations.push(...shape);
      badDays.add(day);
      continue;
    }

    const claims = [
      ...checkClaims(item, brief, supplied),
      ...checkLanguage(item, brief),
    ];
    if (claims.length) {
      violations.push(...claims);
      badDays.add(day);
      continue;
    }

    items.push(item);
  }

  items.sort((a, b) => a.day - b.day);

  return {
    ok: violations.length === 0 && missingDays.length === 0,
    items,
    violations,
    badDays: [...badDays].sort((a, b) => a - b),
    missingDays,
  };
}
