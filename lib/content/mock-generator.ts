import {
  CATEGORY_META,
  PLAN_RHYTHM,
  SELLING_CATEGORIES,
  SELLING_FALLBACK,
} from "./categories.ts";
import { TEMPLATES, type ContentTemplate, type TemplateContext } from "./templates.ts";
import type {
  ContentGenerationRequest,
  ContentGenerator,
  ContentItem,
  ContentPlan,
  ContentCategory,
  RestaurantProfile,
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

/** Which facts the owner actually gave us. Drives every eligibility check. */
function facts(restaurant: RestaurantProfile) {
  const dishes = restaurant.bestSellers.map((d) => d.trim()).filter(Boolean);
  return {
    dishes,
    hasDishes: dishes.length > 0,
    hasPromotion: Boolean(restaurant.promotion?.trim()),
    hasLocation: Boolean(restaurant.location?.trim()),
    hasDescription: Boolean(restaurant.description?.trim()),
  };
}

function isEligible(
  template: ContentTemplate,
  f: ReturnType<typeof facts>,
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
 * A day scheduled as `promotion` or `urgency` becomes something else entirely
 * when there is no real offer to talk about. Inventing one would be a lie about
 * the business, so we spend the day on a truthful category instead.
 */
function resolveCategory(
  scheduled: ContentCategory,
  f: ReturnType<typeof facts>,
  day: number,
): ContentCategory {
  if (SELLING_CATEGORIES.includes(scheduled) && !f.hasPromotion) {
    const options = SELLING_FALLBACK[scheduled];
    if (options?.length) return options[day % options.length];
  }
  return scheduled;
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
  f: ReturnType<typeof facts>,
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
  f: ReturnType<typeof facts>,
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
    const f = facts(restaurant);
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
    const meta = CATEGORY_META[category];

    return {
      id: `${planId}-d${day}`,
      planId,
      day,
      date: addDays(startDate, day - 1),
      category,
      platform: meta.platform,
      hook: out.hook,
      caption: out.caption,
      cta: out.cta,
      visualIdea: out.visualIdea,
      videoIdea: out.videoIdea ?? null,
      variantIndex,
      variantCount: usable.length,
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
