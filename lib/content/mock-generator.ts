import { CATEGORY_META, PLAN_RHYTHM } from "./categories.ts";
import {
  factsOf,
  resolveCategory,
  resolvePlatform,
  type Facts,
} from "./schedule.ts";
import { TEMPLATES, type ContentTemplate, type TemplateContext } from "./templates.ts";
import type {
  ContentGenerationRequest,
  ContentGenerator,
  ContentItem,
  ContentPlan,
  ContentCategory,
  Platform,
  RestaurantProfile,
  VisualStyle,
} from "./types.ts";

export const DEFAULT_PLAN_DAYS = 30;

/** FNV-1a. Small, stable, and good enough to spread template choices. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Adds days to an ISO date without touching local timezones. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function isEligible(
  template: ContentTemplate,
  f: Facts,
): boolean {
  if (!template.requires) return true;
  return template.requires.every((req) => {
    switch (req) {
      case "dishes":
        return f.hasDishes;
      case "promotion":
        return f.hasPromotion;
      case "location":
        return f.hasLocation;
      case "description":
        return f.hasDescription;
      default:
        return false;
    }
  });
}

/**
 * How many times this category has already been scheduled on or before `day`.
 *
 * Repeated categories are the main source of repetitive feeds, so each
 * occurrence is offset onto a different template. Derived from the fixed
 * rhythm rather than from generation state, so a single regenerated day agrees
 * with the plan it belongs to.
 */
function occurrenceIndex(
  day: number,
  category: ContentCategory,
  f: Facts,
): number {
  let seen = 0;
  for (let d = 1; d < day; d++) {
    const scheduled = PLAN_RHYTHM[(d - 1) % PLAN_RHYTHM.length];
    if (resolveCategory(scheduled, f, d) === category) seen++;
  }
  return seen;
}

function buildContext(
  restaurant: RestaurantProfile,
  f: Facts,
  rotation: number,
): TemplateContext {
  const { dishes } = f;
  const dish = dishes.length ? dishes[rotation % dishes.length] : "";
  const dish2 = dishes.length
    ? dishes[(rotation + 1) % dishes.length] === dish && dishes.length > 1
      ? dishes[(rotation + 2) % dishes.length]
      : dishes[(rotation + 1) % dishes.length]
    : "";

  return {
    name: restaurant.name.trim(),
    cuisine: restaurant.cuisine.trim() || "masakan tempatan",
    location: restaurant.location.trim(),
    description: restaurant.description.trim(),
    dishes,
    dish,
    dish2: dish2 || dish,
    promotion: restaurant.promotion?.trim() ?? "",
    audience: restaurant.targetCustomers.trim() || "semua orang",
    tone: restaurant.tone,
  };
}


/**
 * How the graphic should look, from the visual style the owner picked.
 *
 * Deliberately about light, surface and colour rather than about the food —
 * what to shoot is the visual idea's job, and repeating it here would just give
 * whoever makes the graphic two things to reconcile.
 */
const VISUAL_DIRECTION: Record<VisualStyle, string> = {
  hangat: "Cahaya keemasan dari tepi, latar kayu, bayang lembut. Teks putih tebal di bahagian bawah.",
  bersih: "Latar kosong satu warna, cahaya rata, banyak ruang kosong. Teks kecil di sudut atas.",
  cerah: "Warna terang dan kontras tinggi, cahaya siang penuh. Teks besar dengan latar blok warna.",
  gelap: "Latar gelap, satu sumber cahaya dari belakang, bayang tajam. Teks putih nipis di tengah.",
  kampung: "Alas kayu atau rotan, kain batik sebagai latar, cahaya semula jadi dari tingkap.",
  moden: "Garis lurus, latar kelabu atau putih, susunan simetri. Teks huruf besar dengan jarak lebar.",
};

/** Turns owner text into a usable hashtag, or nothing if there is nothing there. */
function tag(value: string): string | null {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "");
  return cleaned.length >= 3 ? cleaned : null;
}

/**
 * Hashtags built only from facts the owner supplied.
 *
 * No invented community tags, no "#1", no claims — just the restaurant's own
 * name, cuisine and town. WhatsApp gets none, because nobody uses them there.
 */
function buildHashtags(restaurant: RestaurantProfile, platform: Platform): string[] {
  if (platform === "whatsapp") return [];
  const out: string[] = [];
  for (const source of [restaurant.name, restaurant.cuisine, restaurant.location]) {
    const t = tag(source ?? "");
    if (t && !out.includes(t)) out.push(t);
  }
  if (!out.includes("makananmalaysia")) out.push("makananmalaysia");
  return out;
}

/**
 * The deterministic content engine.
 *
 * Given the same profile and the same variant selections it always produces the
 * same plan, which keeps server and client render identical and makes
 * "Regenerate" a reproducible step rather than a dice roll.
 */
export class MockContentGenerator implements ContentGenerator {
  readonly kind = "mock" as const;
  readonly version = "mock-1.0.0";

  private buildItem(
    request: ContentGenerationRequest,
    planId: string,
    day: number,
  ): ContentItem {
    const { restaurant } = request;
    const f = factsOf(restaurant);
    const startDate = request.startDate ?? todayIso();

    const scheduled = PLAN_RHYTHM[(day - 1) % PLAN_RHYTHM.length];
    const category = resolveCategory(scheduled, f, day);

    const pool = TEMPLATES[category];
    const eligible = pool.filter((t) => isEligible(t, f));
    // Every category carries at least one requirement-free template, so this
    // is a safety net rather than an expected path.
    const usable = eligible.length ? eligible : pool.filter((t) => !t.requires);

    const variantIndex = request.variants?.[day] ?? 0;
    // Seeded per category, then stepped by occurrence, so the three Best Seller
    // days in a month land on three different templates rather than colliding.
    const seed = hash(`${restaurant.id}:${category}`);
    const occurrence = occurrenceIndex(day, category, f);
    const choice = usable[(seed + occurrence + variantIndex) % usable.length];

    const ctx = buildContext(restaurant, f, seed + occurrence + variantIndex);
    const out = choice.build(ctx);
    const platform = resolvePlatform(category, restaurant.platforms);

    return {
      id: `${planId}-d${day}`,
      planId,
      day,
      date: addDays(startDate, day - 1),
      category,
      platform,
      objective: CATEGORY_META[category].purpose,
      hook: out.hook,
      caption: out.caption,
      cta: out.cta,
      visualIdea: out.visualIdea,
      videoIdea: out.videoIdea ?? null,
      designDirection: restaurant.brandColours.trim()
        ? `${VISUAL_DIRECTION[restaurant.visualStyle]} Guna warna jenama: ${restaurant.brandColours.trim()}.`
        : VISUAL_DIRECTION[restaurant.visualStyle],
      hashtags: buildHashtags(restaurant, platform),
      variantIndex,
      variantCount: usable.length,
      edited: false,
    };
  }

  async generatePlan(request: ContentGenerationRequest): Promise<ContentPlan> {
    const days = request.days ?? DEFAULT_PLAN_DAYS;
    const startDate = request.startDate ?? todayIso();
    const planId = `plan-${request.restaurant.id}`;

    const items: ContentItem[] = [];
    for (let day = 1; day <= days; day++) {
      items.push(this.buildItem(request, planId, day));
    }

    return {
      id: planId,
      restaurantId: request.restaurant.id,
      generatorKind: this.kind,
      generatorVersion: this.version,
      startDate,
      createdAt: new Date().toISOString(),
      items,
    };
  }

  async regenerateDay(
    request: ContentGenerationRequest,
    day: number,
  ): Promise<ContentItem> {
    return this.buildItem(request, `plan-${request.restaurant.id}`, day);
  }
}
