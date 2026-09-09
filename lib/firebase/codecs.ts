import { CATEGORY_META, PLATFORM_LABEL } from "../content/categories.ts";
import type {
  AssetRef,
  BrandTone,
  ContentCategory,
  ContentItem,
  ContentLanguage,
  ContentPlan,
  CopyStyle,
  GeneratorKind,
  Platform,
  RestaurantProfile,
  VisualStyle,
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

const LANGUAGES: readonly ContentLanguage[] = ["ms", "en", "rojak"];

function language(value: unknown): ContentLanguage {
  return LANGUAGES.includes(value as ContentLanguage)
    ? (value as ContentLanguage)
    : "ms";
}

const VISUAL_STYLES: readonly VisualStyle[] = [
  "hangat",
  "bersih",
  "gelap",
  "cerah",
  "kampung",
  "moden",
];

function visualStyle(value: unknown): VisualStyle {
  return VISUAL_STYLES.includes(value as VisualStyle)
    ? (value as VisualStyle)
    : "hangat";
}

const COPY_STYLES: readonly CopyStyle[] = [
  "bercerita",
  "terus_terang",
  "santai",
  "menjual",
  "informatif",
  "emosi",
];

/** Unknown values are dropped, not defaulted — a style nobody picked is noise. */
function copyStyles(value: unknown): CopyStyle[] {
  const out = strArray(value).filter((v): v is CopyStyle =>
    COPY_STYLES.includes(v as CopyStyle),
  );
  return out.length ? out : ["santai"];
}

function platforms(value: unknown): Platform[] {
  const out = strArray(value).filter((v): v is Platform => v in PLATFORM_LABEL);
  return out.length ? out : ["instagram"];
}

/**
 * An uploaded file, or `null`.
 *
 * A reference with no Storage path is unusable — it cannot be authorised,
 * replaced or deleted — so it decodes to "no file" rather than to a broken
 * link the owner would have no way to clear.
 */
function asset(value: unknown): AssetRef | null {
  if (typeof value !== "object" || value === null) return null;
  const d = value as Record<string, unknown>;
  const path = str(d.path).trim();
  if (!path) return null;
  return {
    path,
    url: str(d.url),
    name: str(d.name),
    contentType: str(d.contentType),
    size: num(d.size, 0),
    uploadedAt: str(d.uploadedAt),
  };
}

function encodeAsset(ref: AssetRef | null): AssetRef | null {
  // Firestore rejects `undefined`, so every field is written explicitly.
  return ref
    ? {
        path: ref.path,
        url: ref.url,
        name: ref.name,
        contentType: ref.contentType,
        size: ref.size,
        uploadedAt: ref.uploadedAt,
      }
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
  promotionDates: string;
  promotionConditions: string;
  targetCustomers: string;
  menuNotes: string;
  menuFile: AssetRef | null;
  logo: AssetRef | null;
  visualStyle: VisualStyle;
  brandColours: string;
  referenceDesigns: string;
  brandTone: BrandTone;
  contentLanguage: ContentLanguage;
  platforms: Platform[];
  copyStyles: CopyStyle[];
  exampleCaption: string;
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
    // Dates and conditions only mean something attached to an offer. Storing
    // them without one would leave the generator holding "Setiap Jumaat" with
    // nothing that happens on a Friday.
    promotionDates: profile.promotion?.trim() ? profile.promotionDates : "",
    promotionConditions: profile.promotion?.trim() ? profile.promotionConditions : "",
    targetCustomers: profile.targetCustomers,
    menuNotes: profile.menuNotes,
    menuFile: encodeAsset(profile.menuFile),
    logo: encodeAsset(profile.logo),
    visualStyle: profile.visualStyle,
    brandColours: profile.brandColours,
    referenceDesigns: profile.referenceDesigns,
    brandTone: profile.tone,
    contentLanguage: profile.language,
    platforms: profile.platforms,
    copyStyles: profile.copyStyles,
    exampleCaption: profile.exampleCaption,
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
    menuNotes: str(d.menuNotes),
    menuFile: asset(d.menuFile),
    promotion: strOrNull(d.currentPromotions),
    promotionDates: str(d.promotionDates),
    promotionConditions: str(d.promotionConditions),
    logo: asset(d.logo),
    visualStyle: visualStyle(d.visualStyle),
    brandColours: str(d.brandColours),
    referenceDesigns: str(d.referenceDesigns),
    targetCustomers: str(d.targetCustomers),
    tone: tone(d.brandTone),
    language: language(d.contentLanguage),
    platforms: platforms(d.platforms),
    copyStyles: copyStyles(d.copyStyles),
    exampleCaption: str(d.exampleCaption),
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
  objective: string;
  hook: string;
  caption: string;
  cta: string;
  visualIdea: string;
  videoIdea: string | null;
  designDirection: string;
  hashtags: string[];
  variantIndex: number;
  variantCount: number;
  edited: boolean;
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
  /** The owner's own name for this pack. Empty until they set one. */
  packName: string;
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
    objective: item.objective,
    hook: item.hook,
    caption: item.caption,
    cta: item.cta,
    visualIdea: item.visualIdea,
    // Firestore rejects `undefined`; the domain model already uses null here.
    videoIdea: item.videoIdea ?? null,
    designDirection: item.designDirection,
    hashtags: item.hashtags,
    variantIndex: item.variantIndex,
    variantCount: item.variantCount,
    edited: item.edited,
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
    packName: plan.packName ?? "",
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
    objective: str(d.objective),
    hook: str(d.hook),
    caption: str(d.caption),
    cta: str(d.cta),
    visualIdea: str(d.visualIdea),
    videoIdea: strOrNull(d.videoIdea),
    designDirection: str(d.designDirection),
    hashtags: strArray(d.hashtags),
    variantIndex: num(d.variantIndex, 0),
    // 0 means "unbounded" — an AI day always has another version available, so
    // it must survive the round trip rather than being clamped up to 1.
    variantCount: Math.max(num(d.variantCount, 1), 0),
    edited: d.edited === true,
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
    packName: str(d.packName),
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
