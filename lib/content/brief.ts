import {
  describeBeat,
  planCalendarForLocation,
  type CalendarBeat,
} from "../calendar/index.ts";
import { CATEGORY_META } from "./categories.ts";
import { COPY_STYLE_OPTIONS, frameworksFor, labelFor, VISUAL_STYLE_OPTIONS } from "./demo.ts";
import { buildSchedule, factsOf, wantsVideo, type ScheduledDay } from "./schedule.ts";
import { ctaShapeFor, emojiBudgetFor, hookShapeFor } from "./voice.ts";
import type {
  ContentLanguage,
  CopyFramework,
  RestaurantProfile,
} from "./types.ts";

/**
 * The restaurant brief.
 *
 * A deliberate, hand-shaped summary of what the owner told us — never a raw
 * Firestore document tipped into a prompt. Two things make it the centre of the
 * anti-hallucination design:
 *
 *  1. `known` contains only facts the owner supplied. Anything absent is absent
 *     because they did not tell us, and is therefore not ours to state.
 *  2. `forbidden` names those gaps out loud. Telling a model "you do not know
 *     the opening hours" is far more effective than hoping it will not guess,
 *     and the same list is what `validate.ts` later checks the output against.
 *
 * Pure, with no SDK imports, so the whole brief is unit-testable offline and
 * can be built identically on the client and the server.
 */

export interface BriefFact {
  label: string;
  value: string;
}

export interface RestaurantBrief {
  restaurantName: string;
  language: ContentLanguage;
  days: number;
  /** Facts we may state, already trimmed and non-empty. */
  known: BriefFact[];
  /** Exact strings the owner supplied that the copy is allowed to quote. */
  quotable: {
    dishes: string[];
    promotion: string | null;
    promotionDates: string;
    promotionConditions: string;
    /** Every money amount that appears anywhere in the owner's own words. */
    prices: string[];
  };
  /** Subjects we have no information about and must not invent. */
  forbidden: string[];
  frameworks: CopyFramework[];
  styleLabels: string[];
  toneLabel: string;
  visualStyleLabel: string;
  brandColours: string;
  referenceDesigns: string;
  exampleCaption: string;
  schedule: ScheduledDay[];
  /**
   * The Malaysian dates that fall inside this pack, with the guidance that goes
   * with them. Separate from `schedule` because the day only needs to know
   * *that* it is Hari Malaysia; the prompt needs to know what to do about it.
   */
  calendar: CalendarBeat[];
}

/**
 * Matches an amount of money written any of the ways Malaysians write it.
 *
 * The leading `(?<![a-z0-9])` is load-bearing. Without it the `rm` alternative
 * matches inside a word, and a hashtag is exactly where that happens: an owner's
 * real `RM12.90` becomes the tag `setlunchrm1290` once the punctuation is
 * stripped, which then reads back as the invented price `rm1290` and fails an
 * honest day. That is not hypothetical — it cost a benchmarked month six days
 * before it was found. A price a customer can actually read stands on its own.
 */
const PRICE =
  /(?<![a-z0-9])(?:rm|myr)\s*\d+(?:[.,]\d{1,2})?|(?<![a-z0-9])\d+(?:[.,]\d{1,2})?\s*(?:ringgit|sen)\b/gi;

/** Every price the owner actually wrote, normalised for comparison. */
export function extractPrices(text: string): string[] {
  const found = text.match(PRICE) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const norm = normalisePrice(raw);
    if (!out.includes(norm)) out.push(norm);
  }
  return out;
}

/** `RM 12.90`, `rm12,90` and `12.90 ringgit` all collapse to `rm12.90`. */
export function normalisePrice(raw: string): string {
  const digits = raw.replace(/[^\d.,]/g, "").replace(",", ".");
  return `rm${digits}`;
}

/** Everything the owner typed, as one blob, for fact-checking output against. */
export function ownerSuppliedText(restaurant: RestaurantProfile): string {
  return [
    restaurant.name,
    restaurant.cuisine,
    restaurant.location,
    restaurant.description,
    restaurant.targetCustomers,
    restaurant.bestSellers.join(" "),
    restaurant.menuNotes,
    restaurant.promotion ?? "",
    restaurant.promotionDates,
    restaurant.promotionConditions,
    restaurant.brandColours,
    restaurant.referenceDesigns,
    restaurant.exampleCaption,
  ].join("\n");
}

/**
 * Fabrications that are out of bounds for every restaurant, whatever the owner
 * told us.
 *
 * No profile field licenses any of these, so they are stated once in the part
 * of the prompt that never varies rather than rebuilt per restaurant. They are
 * listed explicitly because they are exactly the phrases a model reaches for
 * when it is asked to write marketing copy.
 */
export const ALWAYS_FORBIDDEN: readonly string[] = [
  "nama pekerja, tukang masak atau ahli keluarga yang tidak disebut oleh pemilik sendiri",
  "ayat dalam tanda petik seolah-olah dituturkan oleh pelanggan, pekerja atau pemilik",
  "testimoni, review, komen atau kata-kata pelanggan yang direka",
  "anugerah, pensijilan, pengiktirafan atau liputan media",
  "dakwaan 'terbaik', 'nombor satu', '#1', 'paling sedap di Malaysia' atau seumpamanya",
  "bilangan pelanggan, jumlah jualan, bintang rating atau statistik",
  "dakwaan stok terhad, 'last call', 'hari terakhir' atau tarikh luput tawaran",
  "kandungan pemakanan, kalori atau dakwaan kesihatan",
  "jaminan rasa, jaminan pulangan wang atau janji hasil",
] as const;

/**
 * Subjects a restaurant post commonly asserts, each paired with the profile
 * field that would license it.
 *
 * Everything whose field is empty lands in `forbidden`, which the prompt states
 * as a prohibition and the validator enforces on the way back. Only the gaps
 * *this* owner left are here — the universal prohibitions are `ALWAYS_FORBIDDEN`
 * above, so they do not have to be rebuilt for every profile.
 */
function forbiddenSubjects(restaurant: RestaurantProfile): string[] {
  const f = factsOf(restaurant);
  const supplied = ownerSuppliedText(restaurant).toLowerCase();
  const out: string[] = [];

  if (!f.hasPromotion) {
    out.push(
      "sebarang promosi, diskaun, potongan harga, set murah, tawaran atau apa-apa yang percuma",
    );
  }
  if (extractPrices(supplied).length === 0) {
    out.push("sebarang harga atau jumlah ringgit");
  }
  if (!f.hasLocation) out.push("lokasi, alamat, kawasan atau cawangan");
  if (!/halal/.test(supplied)) out.push("status halal atau sijil halal");
  if (!/(delivery|penghantar|grab|foodpanda|shopee)/.test(supplied)) {
    out.push("perkhidmatan delivery atau nama platform penghantaran");
  }
  // Mirrors the validator's own licence check. A loose /am\b/ would be licensed
  // by any dish called "Ayam", which is not an opening hour by any reading.
  if (!/(?:buka|tutup)\s*(?:pukul|jam|dari)|\d{1,2}\s*(?:am|pm)\b|\d{1,2}\s*(?:pagi|petang|malam)\b/.test(supplied)) {
    out.push("waktu operasi, jam buka atau hari tutup");
  }

  return out;
}

/**
 * `startDate` is optional because two callers do not have one: a unit test
 * asserting the rhythm, and the deterministic engine, which plans a shape
 * rather than a month. Without it the brief simply carries no calendar, and a
 * pack without a calendar is a normal pack — never a wrong one.
 */
export function buildBrief(
  restaurant: RestaurantProfile,
  days: number,
  startDate?: string,
): RestaurantBrief {
  const f = factsOf(restaurant);
  const known: BriefFact[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const clean = value?.trim();
    if (clean) known.push({ label, value: clean });
  };

  add("Nama restoran", restaurant.name);
  add("Jenis masakan", restaurant.cuisine);
  add("Lokasi", restaurant.location);
  add("Cerita kedai", restaurant.description);
  add("Pelanggan sasaran", restaurant.targetCustomers);
  add("Nota menu daripada pemilik", restaurant.menuNotes);
  // The dish names, the promotion and its dates and conditions are deliberately
  // absent here. They are facts, but `quotable` already carries them verbatim
  // alongside the rules that govern them — "do not invent another dish name",
  // "only mention this offer on a selling day". Listing them twice in one
  // prompt paid for the same strings twice and invited the two copies to
  // disagree about what the owner actually said.
  add("Warna jenama", restaurant.brandColours);
  add("Rujukan design yang disukai", restaurant.referenceDesigns);
  if (restaurant.logo) add("Logo", "Pemilik sudah muat naik logo mereka");
  if (restaurant.menuFile) {
    // The file itself is never read. Saying so keeps the writer from treating
    // the upload as a source of dish names or prices it has not seen.
    add(
      "Fail menu",
      "Pemilik sudah muat naik fail menu, tetapi kandungannya TIDAK dibaca. Jangan andaikan apa-apa daripadanya.",
    );
  }
  add("Contoh caption dalam suara pemilik", restaurant.exampleCaption);

  const supplied = ownerSuppliedText(restaurant);

  return {
    restaurantName: restaurant.name.trim(),
    language: restaurant.language,
    days,
    known,
    quotable: {
      dishes: f.dishes,
      promotion: restaurant.promotion?.trim() || null,
      promotionDates: restaurant.promotionDates.trim(),
      promotionConditions: restaurant.promotionConditions.trim(),
      prices: extractPrices(supplied),
    },
    forbidden: forbiddenSubjects(restaurant),
    frameworks: frameworksFor(restaurant.copyStyles),
    styleLabels: restaurant.copyStyles.map(
      (s) => COPY_STYLE_OPTIONS.find((o) => o.value === s)?.label ?? s,
    ),
    toneLabel: restaurant.tone,
    visualStyleLabel: labelFor(VISUAL_STYLE_OPTIONS, restaurant.visualStyle),
    brandColours: restaurant.brandColours.trim(),
    referenceDesigns: restaurant.referenceDesigns.trim(),
    exampleCaption: restaurant.exampleCaption.trim(),
    schedule: buildSchedule(restaurant, days, startDate),
    calendar: startDate
      ? planCalendarForLocation(restaurant.location, startDate, days).beats
      : [],
  };
}

/**
 * The schedule as prompt-ready lines.
 *
 * One block per day rather than one line, because a day now carries several
 * separate instructions: what it is for, what shape its opening should take,
 * how it closes, how many emoji it may carry, and — on the handful of days the
 * Malaysia calendar claimed — which real date it belongs to and how to treat
 * it. These per-day shapes are what stop a month of captions from all being
 * built the same way; asked as one general instruction they collapse into one
 * answer repeated thirty times.
 */
export function scheduleLines(brief: RestaurantBrief): string {
  const beats = new Map(brief.calendar.map((beat) => [beat.day, beat]));
  return brief.schedule
    .map((d) => {
      const meta = CATEGORY_META[d.category];
      const video = wantsVideo(d.category, d.platform) ? " [perlukan videoIdea]" : "";
      const beat = beats.get(d.day);
      const lines = [
        `Hari ${d.day} | ${d.category} | ${d.platform} | tujuan: ${meta.purpose}${video}`,
        `  bentuk hook: ${hookShapeFor(d.day).guide}`,
        `  bentuk CTA: ${ctaShapeFor(d.day)}`,
        `  emoji: ${emojiBudget(d.day)}`,
      ];
      if (beat) lines.push(`  TARIKH SEBENAR: ${describeBeat(beat)}`);
      return lines.join("\n");
    })
    .join("\n");
}

/** The day's emoji allowance, as an instruction rather than a number. */
function emojiBudget(day: number): string {
  const allowed = emojiBudgetFor(day);
  if (allowed === 0) return "tiada emoji langsung hari ini";
  if (allowed === 1) return "satu emoji dibenarkan hari ini, letak di tempat yang wajar";
  return `paling banyak ${allowed} emoji hari ini, dan hanya kalau ia betul-betul kena`;
}

export { buildSchedule, factsOf, wantsVideo };
