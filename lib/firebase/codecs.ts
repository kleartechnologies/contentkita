import { CATEGORY_META, PLATFORM_LABEL } from "../content/categories.ts";
import type {
  BrandTone,
  ContentCategory,
  ContentItem,
  ContentPlan,
  GeneratorKind,
  Platform,
  RestaurantProfile,
} from "../content/types.ts";

/**
 * The wire format: how domain objects are shaped inside Firestore.
 *
 * The stored field names are the ones agreed for the database
 * (`restaurantName`, `bestSellingDishes`, `brandTone`, …) and deliberately
 * differ from the domain model's names. Keeping the translation in one pair of
 * pure functions means the UI never learns the database's vocabulary, and the
 * mapping is unit-testable without touching the network.
 *
 * Decoding is defensive on purpose. Documents come off the network and may have
 * been written by an older build, so every field is checked rather than cast.
 * A document that cannot be trusted decodes to `null`, and the caller treats
 * that as "not set up yet" rather than rendering nonsense.
 */

/* ------------------------------- primitives ------------------------------- */

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const TONES: readonly BrandTone[] = [
  "friendly",
  "casual",
  "funny",
  "premium",
  "family",
  "kampung",
];

function tone(value: unknown): BrandTone {
  return TONES.includes(value as BrandTone) ? (value as BrandTone) : "friendly";
}

function category(value: unknown): ContentCategory | null {
  return typeof value === "string" && value in CATEGORY_META
    ? (value as ContentCategory)
    : null;
}

function platform(value: unknown): Platform | null {
  return typeof value === "string" && value in PLATFORM_LABEL
    ? (value as Platform)
    : null;
}

function generatorKind(value: unknown): GeneratorKind {
  return value === "ai" ? "ai" : "mock";
}

/* --------------------------------- users ---------------------------------- */

export interface UserDoc {
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export function encodeUser(input: {
  email: string;
  displayName?: string | null;
  createdAt?: string;
  now?: string;
}): UserDoc {
  const now = input.now ?? new Date().toISOString();
  return {
    email: input.email,
    displayName: input.displayName?.trim() || "",
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

/* ------------------------------- restaurants ------------------------------ */

export interface RestaurantDoc {
  ownerId: string;
  restaurantName: string;
  cuisine: string;
  location: string;
  description: string;
  bestSellingDishes: string[];
  /** `null` when the owner has no running promotion. Never invented. */
  currentPromotions: string | null;
  targetCustomers: string;
  brandTone: BrandTone;
  createdAt: string;
  updatedAt: string;
}

export function encodeRestaurant(
  profile: RestaurantProfile,
  ownerId: string,
  now = new Date().toISOString(),
): RestaurantDoc {
  return {
    ownerId,
    restaurantName: profile.name,
    cuisine: profile.cuisine,
    location: profile.location,
    description: profile.description,
    bestSellingDishes: profile.bestSellers,
    // An empty promotion field stays empty. A blank string is not a promotion,
    // and storing one would let the generator treat it as a real offer.
    currentPromotions: profile.promotion?.trim() ? profile.promotion.trim() : null,
    targetCustomers: profile.targetCustomers,
    brandTone: profile.tone,
    createdAt: profile.createdAt || now,
    updatedAt: now,
  };
}

/**
 * `uid` doubles as the restaurant id: one owner, one restaurant in the MVP, and
 * the document path is then the ownership boundary the rules enforce.
 */
export function decodeRestaurant(
  data: unknown,
  uid: string,
): RestaurantProfile | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  const name = str(d.restaurantName).trim();
  const cuisine = str(d.cuisine).trim();
  // A profile without these cannot drive the generator; treat it as absent so
  // the owner is sent back through onboarding rather than shown a broken plan.
  if (!name || !cuisine) return null;

  const now = new Date().toISOString();
  return {
    id: uid,
    name,
    cuisine,
    location: str(d.location),
    description: str(d.description),
    bestSellers: strArray(d.bestSellingDishes),
    promotion: strOrNull(d.currentPromotions),
    targetCustomers: str(d.targetCustomers),
    tone: tone(d.brandTone),
    createdAt: str(d.createdAt, now),
    updatedAt: str(d.updatedAt, now),
  };
}

/* ------------------------------ content plans ----------------------------- */

export interface ContentItemDoc {
  id: string;
  planId: string;
  day: number;
  date: string;
  category: ContentCategory;
  platform: Platform;
  hook: string;
  caption: string;
  cta: string;
  visualIdea: string;
  videoIdea: string | null;
  variantIndex: number;
  variantCount: number;
}

export interface ContentPlanDoc {
  ownerId: string;
  restaurantId: string;
  planId: string;
  generatorKind: GeneratorKind;
  generatorVersion: string;
  startDate: string;
  generatedAt: string;
  updatedAt: string;
  items: ContentItemDoc[];
}

export function encodeItem(item: ContentItem): ContentItemDoc {
  return {
    id: item.id,
    planId: item.planId,
    day: item.day,
    date: item.date,
    category: item.category,
    platform: item.platform,
    hook: item.hook,
    caption: item.caption,
    cta: item.cta,
    visualIdea: item.visualIdea,
    // Firestore rejects `undefined`; the domain model already uses null here.
    videoIdea: item.videoIdea ?? null,
    variantIndex: item.variantIndex,
    variantCount: item.variantCount,
  };
}

export function encodePlan(
  plan: ContentPlan,
  ownerId: string,
  now = new Date().toISOString(),
): ContentPlanDoc {
  return {
    ownerId,
    restaurantId: plan.restaurantId,
    planId: plan.id,
    generatorKind: plan.generatorKind,
    generatorVersion: plan.generatorVersion,
    startDate: plan.startDate,
    generatedAt: plan.createdAt || now,
    updatedAt: now,
    items: plan.items.map(encodeItem),
  };
}

function decodeItem(value: unknown, planId: string): ContentItem | null {
  if (typeof value !== "object" || value === null) return null;
  const d = value as Record<string, unknown>;

  const cat = category(d.category);
  const plat = platform(d.platform);
  const day = num(d.day, 0);
  if (!cat || !plat || day < 1) return null;

  return {
    id: str(d.id, `${planId}-d${day}`),
    planId: str(d.planId, planId),
    day,
    date: str(d.date),
    category: cat,
    platform: plat,
    hook: str(d.hook),
    caption: str(d.caption),
    cta: str(d.cta),
    visualIdea: str(d.visualIdea),
    videoIdea: strOrNull(d.videoIdea),
    variantIndex: num(d.variantIndex, 0),
    variantCount: Math.max(num(d.variantCount, 1), 1),
  };
}

export function decodePlan(data: unknown, uid: string): ContentPlan | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.items) || d.items.length === 0) return null;

  const planId = str(d.planId, `plan-${uid}`);
  const items: ContentItem[] = [];
  for (const raw of d.items) {
    const item = decodeItem(raw, planId);
    // One unreadable day makes the whole plan untrustworthy — better to report
    // no plan and let the owner regenerate than to render a gap.
    if (!item) return null;
    items.push(item);
  }
  items.sort((a, b) => a.day - b.day);

  const now = new Date().toISOString();
  return {
    id: planId,
    restaurantId: str(d.restaurantId, uid),
    generatorKind: generatorKind(d.generatorKind),
    generatorVersion: str(d.generatorVersion, "unknown"),
    startDate: str(d.startDate),
    createdAt: str(d.generatedAt, now),
    items,
  };
}

/**
 * Replaces exactly one day and leaves the other twenty-nine untouched.
 *
 * Regenerating a single day must never reshuffle the rest of the month: the
 * owner may already have posted those, and the plan is theirs.
 */
export function replaceItem(plan: ContentPlan, next: ContentItem): ContentPlan {
  return {
    ...plan,
    items: plan.items.map((item) => (item.day === next.day ? next : item)),
  };
}
