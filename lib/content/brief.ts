import { CATEGORY_META } from "./categories.ts";
import { COPY_STYLE_OPTIONS, frameworksFor, labelFor, VISUAL_STYLE_OPTIONS } from "./demo.ts";
import { buildSchedule, factsOf, wantsVideo, type ScheduledDay } from "./schedule.ts";
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
}

/** Matches an amount of money written any of the ways Malaysians write it. */
const PRICE = /(?:rm|myr)\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*(?:ringgit|sen)\b/gi;

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
 * Subjects a restaurant post commonly asserts, each paired with the profile
 * field that would license it.
 *
 * Everything whose field is empty lands in `forbidden`, which the prompt states
 * as a prohibition and the validator enforces on the way back.
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

  // These are never licensed by any field in the profile, so they are always
  // out of bounds. Listed explicitly because they are exactly the phrases a
  // model reaches for when it is asked to write marketing copy.
  out.push(
    "nama pekerja, tukang masak atau ahli keluarga yang tidak disebut oleh pemilik sendiri",
    "ayat dalam tanda petik seolah-olah dituturkan oleh pelanggan, pekerja atau pemilik",
    "testimoni, review, komen atau kata-kata pelanggan yang direka",
    "anugerah, pensijilan, pengiktirafan atau liputan media",
    "dakwaan 'terbaik', 'nombor satu', '#1', 'paling sedap di Malaysia' atau seumpamanya",
    "bilangan pelanggan, jumlah jualan, bintang rating atau statistik",
    "dakwaan stok terhad, 'last call', 'hari terakhir' atau tarikh luput tawaran",
    "kandungan pemakanan, kalori atau dakwaan kesihatan",
    "jaminan rasa, jaminan pulangan wang atau janji hasil",
  );

  return out;
}

export function buildBrief(
  restaurant: RestaurantProfile,
  days: number,
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
  add("Menu paling laris", restaurant.bestSellers.join(", "));
  add("Nota menu daripada pemilik", restaurant.menuNotes);
  add("Promosi yang sedang berjalan", restaurant.promotion);
  add("Tarikh promosi", restaurant.promotionDates);
  add("Syarat promosi", restaurant.promotionConditions);
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
    schedule: buildSchedule(restaurant, days),
  };
}

/** The schedule as prompt-ready lines, one per day, with its purpose attached. */
export function scheduleLines(brief: RestaurantBrief): string {
  return brief.schedule
    .map((d) => {
      const meta = CATEGORY_META[d.category];
      const video = wantsVideo(d.category, d.platform) ? " [perlukan videoIdea]" : "";
      return `Hari ${d.day} | ${d.category} | ${d.platform} | tujuan: ${meta.purpose}${video}`;
    })
    .join("\n");
}

export { buildSchedule, factsOf, wantsVideo };
