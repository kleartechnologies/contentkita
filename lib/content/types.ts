/**
 * ContentKita domain contracts.
 *
 * These types are deliberately flat and free of any UI or provider concepts so
 * they map cleanly onto database tables later:
 *
 *   RestaurantProfile -> restaurants
 *   ContentPlan       -> content_plans
 *   ContentItem       -> content_items
 *
 * Nothing in here knows how content is produced. That is the generator's job.
 */

/** The kinds of post ContentKita plans for. */
export type ContentCategory =
  | "produk"
  | "best_seller"
  | "behind_the_scenes"
  | "customer"
  | "social_proof"
  | "engagement"
  | "local"
  | "educational"
  | "storytelling"
  | "promotion"
  | "urgency"
  | "reels"
  | "whatsapp_status"
  | "staff"
  | "experience";

export type Platform = "instagram" | "tiktok" | "facebook" | "whatsapp";

export type BrandTone =
  | "friendly"
  | "casual"
  | "funny"
  | "premium"
  | "family"
  | "kampung";

/** Everything the owner tells us. Only `name` and `cuisine` are required. */
export interface RestaurantProfile {
  id: string;
  name: string;
  cuisine: string;
  location: string;
  description: string;
  /** Free-text dish names exactly as the owner wrote them. */
  bestSellers: string[];
  /** `null` when the owner has no running promotion. Never invented. */
  promotion: string | null;
  targetCustomers: string;
  tone: BrandTone;
  createdAt: string;
  updatedAt: string;
}

/** One day of the plan. */
export interface ContentItem {
  id: string;
  planId: string;
  /** 1-based day within the plan. */
  day: number;
  /** ISO date (YYYY-MM-DD) this day falls on. */
  date: string;
  category: ContentCategory;
  platform: Platform;
  hook: string;
  caption: string;
  cta: string;
  visualIdea: string;
  /** Present for video-shaped categories, `null` otherwise. */
  videoIdea: string | null;
  /** Which alternative is being shown; advanced by "Regenerate". */
  variantIndex: number;
  /** How many alternatives exist for this day. */
  variantCount: number;
}

export interface ContentPlan {
  id: string;
  restaurantId: string;
  /** Which engine produced this plan — `mock` today, `ai` later. */
  generatorKind: GeneratorKind;
  generatorVersion: string;
  startDate: string;
  createdAt: string;
  items: ContentItem[];
}

export type GeneratorKind = "mock" | "ai";

/** The request shape every generator accepts. */
export interface ContentGenerationRequest {
  restaurant: RestaurantProfile;
  /** Defaults to 30. */
  days?: number;
  /** ISO date the plan starts on. Defaults to today. */
  startDate?: string;
  /**
   * Per-day variant selections, keyed by day number. Absent days use variant 0.
   * This is what makes "Regenerate" reproducible rather than random.
   */
  variants?: Record<number, number>;
}

/**
 * The seam between the product and whatever writes the words.
 *
 * The UI only ever depends on this interface, so swapping MockContentGenerator
 * for an AI-backed implementation is a change to `getContentGenerator()` and
 * nothing else. Both methods are async today even though the mock is
 * synchronous, so no call site has to change when a network hop appears.
 */
export interface ContentGenerator {
  readonly kind: GeneratorKind;
  readonly version: string;
  generatePlan(request: ContentGenerationRequest): Promise<ContentPlan>;
  regenerateDay(
    request: ContentGenerationRequest,
    day: number,
  ): Promise<ContentItem>;
}
