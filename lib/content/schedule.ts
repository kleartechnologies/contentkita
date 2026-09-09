import {
  CATEGORY_META,
  PLAN_RHYTHM,
  SELLING_CATEGORIES,
  SELLING_FALLBACK,
} from "./categories.ts";
import type {
  ContentCategory,
  Platform,
  RestaurantProfile,
} from "./types.ts";

/**
 * The 30-day content strategy, as data.
 *
 * Both engines plan against this. The deterministic engine fills each slot from
 * its template corpus; the AI engine is handed the same schedule and asked to
 * write into it. That is what keeps a generated month a *strategy* rather than
 * thirty unrelated captions, and it means switching engines does not change
 * the shape of the month an owner gets.
 *
 * Two rules are enforced here rather than left to the writer:
 *
 *  1. A selling day only survives if there is a real promotion to sell. With no
 *     offer recorded, the slot is spent on something truthful instead.
 *  2. A category whose home platform the owner does not use is re-homed onto a
 *     platform they do, so nobody is handed a WhatsApp plan they cannot post.
 */

/** Which facts the owner actually gave us. Drives every eligibility check. */
export interface Facts {
  dishes: string[];
  hasDishes: boolean;
  hasPromotion: boolean;
  hasLocation: boolean;
  hasDescription: boolean;
  hasMenuNotes: boolean;
  hasAudience: boolean;
  hasLogo: boolean;
  hasMenuFile: boolean;
}

export function factsOf(restaurant: RestaurantProfile): Facts {
  const dishes = restaurant.bestSellers.map((d) => d.trim()).filter(Boolean);
  return {
    dishes,
    hasDishes: dishes.length > 0,
    hasPromotion: Boolean(restaurant.promotion?.trim()),
    hasLocation: Boolean(restaurant.location?.trim()),
    hasDescription: Boolean(restaurant.description?.trim()),
    hasMenuNotes: Boolean(restaurant.menuNotes?.trim()),
    hasAudience: Boolean(restaurant.targetCustomers?.trim()),
    hasLogo: Boolean(restaurant.logo),
    hasMenuFile: Boolean(restaurant.menuFile),
  };
}

/**
 * A day scheduled as `promotion` or `urgency` becomes something else entirely
 * when there is no real offer to talk about. Inventing one would be a lie about
 * the business, so the day is spent on a truthful category instead.
 */
export function resolveCategory(
  scheduled: ContentCategory,
  facts: Facts,
  day: number,
): ContentCategory {
  if (SELLING_CATEGORIES.includes(scheduled) && !facts.hasPromotion) {
    const options = SELLING_FALLBACK[scheduled];
    if (options?.length) return options[day % options.length];
  }
  return scheduled;
}

/**
 * Where a category's post should go, given where the owner actually posts.
 *
 * The category's natural home wins when the owner uses it. Otherwise the post
 * moves to the closest platform they do use — video to video, chat to chat —
 * falling back to whatever they picked first.
 */
const PLATFORM_AFFINITY: Record<Platform, readonly Platform[]> = {
  instagram: ["instagram", "facebook", "tiktok", "whatsapp"],
  tiktok: ["tiktok", "instagram", "facebook", "whatsapp"],
  facebook: ["facebook", "instagram", "whatsapp", "tiktok"],
  whatsapp: ["whatsapp", "facebook", "instagram", "tiktok"],
};

export function resolvePlatform(
  category: ContentCategory,
  preferred: Platform[],
): Platform {
  const available = preferred.length ? preferred : (["instagram"] as Platform[]);
  const home = CATEGORY_META[category].platform;
  for (const candidate of PLATFORM_AFFINITY[home]) {
    if (available.includes(candidate)) return candidate;
  }
  return available[0];
}

export interface ScheduledDay {
  day: number;
  category: ContentCategory;
  platform: Platform;
}

/**
 * The whole month's shape, before a single word is written.
 *
 * Pure and deterministic: the same profile always yields the same schedule, so
 * regenerating one day agrees with the plan it belongs to and never drifts.
 */
export function buildSchedule(
  restaurant: RestaurantProfile,
  days: number,
): ScheduledDay[] {
  const facts = factsOf(restaurant);
  const out: ScheduledDay[] = [];
  for (let day = 1; day <= days; day++) {
    const scheduled = PLAN_RHYTHM[(day - 1) % PLAN_RHYTHM.length];
    const category = resolveCategory(scheduled, facts, day);
    out.push({
      day,
      category,
      platform: resolvePlatform(category, restaurant.platforms),
    });
  }
  return out;
}

/** The categories that carry a video idea. */
export const VIDEO_CATEGORIES: readonly ContentCategory[] = [
  "reels",
  "behind_the_scenes",
  "staff",
] as const;

export function wantsVideo(category: ContentCategory, platform: Platform): boolean {
  return VIDEO_CATEGORIES.includes(category) || platform === "tiktok";
}
