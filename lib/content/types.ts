import type { Signature } from "../creative/photo.ts";

/**
 * ContentKita domain contracts.
 *
 * These types are deliberately flat and free of any UI or provider concepts so
 * they map cleanly onto the Firestore documents behind them:
 *
 *   RestaurantProfile -> restaurants/{uid}
 *   ContentPlan       -> contentPlans/{uid}
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
  | "experience"
  | "perayaan";

export type Platform = "instagram" | "tiktok" | "facebook" | "whatsapp";

export type BrandTone =
  | "friendly"
  | "casual"
  | "funny"
  | "premium"
  | "family"
  | "kampung";

/** What the owner sees on the page. Frameworks stay behind these labels. */
export type CopyStyle =
  | "bercerita"
  | "terus_terang"
  | "santai"
  | "menjual"
  | "informatif"
  | "emosi";

/**
 * The copywriting frameworks the generator may follow. The owner never picks
 * one of these directly — they pick a `CopyStyle` and the brief translates.
 */
export type CopyFramework = "aida" | "pas" | "story" | "fab" | "direct";

/** How the finished posts should read. */
export type ContentLanguage = "ms" | "en" | "rojak";

/** The look the owner wants their photos and graphics to have. */
export type VisualStyle =
  | "hangat"
  | "bersih"
  | "gelap"
  | "cerah"
  | "kampung"
  | "moden";

/**
 * A file the owner uploaded, as recorded in Firestore.
 *
 * `path` is the Storage object path and is the authoritative reference — it is
 * what the Storage rules authorise against and what a delete needs. `url` is a
 * download URL kept alongside it so the UI can render the logo without a
 * round-trip through the SDK on every page load.
 */
export interface AssetRef {
  path: string;
  url: string;
  /** The owner's own filename, shown back to them so they recognise it. */
  name: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  /**
   * The few numbers composition is allowed to know about this picture.
   *
   * Read once, in the browser, at the moment the file is decoded for upload —
   * see `lib/creative/photo.ts`. Optional because every photograph uploaded
   * before M6.5 has none, and every consumer has a defined answer for that:
   * the framing M6 used. An existing month never re-crops itself.
   *
   * Deliberately not a description of the *contents*. What a picture is of is
   * known from the filename the owner typed and from nowhere else.
   */
  signature?: Signature;
}

/**
 * Everything the owner tells us.
 *
 * Only `name` and `cuisine` are required. Every other field may be empty, and
 * an empty field means "the owner did not tell us this" — never "make
 * something up". The generator's anti-hallucination rules read directly off
 * the emptiness of these fields, so a blank string must never be padded with a
 * plausible default anywhere in the codebase.
 */
export interface RestaurantProfile {
  id: string;

  /* --- basic ------------------------------------------------------------ */
  name: string;
  cuisine: string;
  location: string;
  description: string;
  targetCustomers: string;
  /** Free-text dish names exactly as the owner wrote them. */
  bestSellers: string[];

  /* --- menu ------------------------------------------------------------- */
  /**
   * "Menu / produk utama yang kami patut tahu" — trusted, owner-authored text.
   * This is the launch answer to menu intelligence: the owner types what
   * matters instead of us guessing at a PDF.
   */
  menuNotes: string;
  menuFile: AssetRef | null;

  /* --- photos ----------------------------------------------------------- */
  /**
   * The restaurant's own photographs, in the order the owner uploaded them.
   *
   * This is the single most valuable thing an owner gives us. Every photo used
   * on a poster comes from here or from an upload made inside the editor —
   * ContentKita never puts somebody else's food in front of a customer as if
   * it were this kitchen's. An empty pool is a supported state, not a failure:
   * the creative engine has typographic compositions for exactly that case.
   */
  photos: AssetRef[];

  /* --- promotions ------------------------------------------------------- */
  /** `null` when the owner has no running promotion. Never invented. */
  promotion: string | null;
  /** Free text, e.g. "Setiap Jumaat" or "1-15 Mac". Empty when not supplied. */
  promotionDates: string;
  /** e.g. "Dine-in sahaja". Empty when not supplied. */
  promotionConditions: string;

  /* --- brand ------------------------------------------------------------ */
  logo: AssetRef | null;
  visualStyle: VisualStyle;
  /** Free text, e.g. "merah bata dan krim". Empty when not supplied. */
  brandColours: string;
  /** Notes about designs the owner likes. Empty when not supplied. */
  referenceDesigns: string;

  /* --- content style ---------------------------------------------------- */
  tone: BrandTone;
  language: ContentLanguage;
  /** Where the owner actually posts. Never empty — onboarding requires one. */
  platforms: Platform[];

  /* --- copywriting ------------------------------------------------------ */
  /** Never empty — onboarding requires one. */
  copyStyles: CopyStyle[];
  /** An example of the owner's own voice, used as a style reference only. */
  exampleCaption: string;

  createdAt: string;
  updatedAt: string;
}

/**
 * The occasion a day was written for, when the Malaysia calendar put one there.
 *
 * Structural on purpose so `lib/content` does not depend on `lib/calendar`.
 * `kind` is carried all the way through to the copy rules because a `holiday`
 * may be called a cuti umum and nothing else may.
 */
export interface ItemOccasion {
  /** Stable event id, e.g. `hari-malaysia`. */
  id: string;
  /** The occasion's name in Malay, as it should appear to an owner. */
  name: string;
  kind: "holiday" | "season" | "occasion";
  /** `on` is the day itself; `before` is the post that leads up to it. */
  role: "before" | "on";
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
  /** One line on what this post is for, in the owner's language. */
  objective: string;
  hook: string;
  caption: string;
  cta: string;
  visualIdea: string;
  /** Present for video-shaped categories, `null` otherwise. */
  videoIdea: string | null;
  /** Colour, layout and text-on-image direction for whoever makes the graphic. */
  designDirection: string;
  /** Without the leading `#`. May be empty for platforms that do not use them. */
  hashtags: string[];
  /** Which alternative is being shown; advanced by "Regenerate". */
  variantIndex: number;
  /** How many alternatives exist for this day. 0 means "unbounded" (AI). */
  variantCount: number;
  /** True once the owner has edited this day by hand. */
  edited: boolean;
  /** Set when this day belongs to a date on the Malaysia calendar. */
  occasion: ItemOccasion | null;
}

export interface ContentPlan {
  id: string;
  restaurantId: string;
  /**
   * What the owner calls this month of content, e.g. "30 Hari Content — Tenders
   * Maju". Empty means they have not renamed it and the product shows a default
   * built from their restaurant name; it is never filled in by the generator,
   * which has no business naming the owner's work.
   */
  packName?: string;
  /** Which engine produced this plan. */
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
  /**
   * Which pack this month is being written into.
   *
   * The entitlement, carried with the request. The server checks it against
   * the pack document before it spends a cent on a model, so a caller with no
   * paid pack gets a refusal rather than content. The deterministic and mock
   * engines ignore it — they cost nothing and grant nothing.
   */
  packId?: string;
  /** Defaults to 30. */
  days?: number;
  /** ISO date the plan starts on. Defaults to today. */
  startDate?: string;
  /**
   * Per-day variant selections, keyed by day number. Absent days use variant 0.
   * This is what makes the deterministic engine's "Regenerate" reproducible
   * rather than random; the AI engine uses it only as a nudge for variety.
   */
  variants?: Record<number, number>;
  /**
   * Hooks already on screen for the days being rewritten. The AI engine is told
   * to avoid them so "Regenerate" produces a genuinely different post rather
   * than a paraphrase of the one the owner is looking at. The deterministic
   * engine ignores it — its `variants` already guarantee a different template.
   */
  avoidHooks?: string[];
  /**
   * CTAs already in the pack, for the same reason and with more force: there
   * are only so many ways to say "save this post", so a rewrite lands on the
   * neighbouring day's invitation far more readily than on its hook.
   */
  avoidCtas?: string[];
  /** Reports which stage generation has reached, for the waiting screen. */
  onStage?: (stage: GenerationStage) => void;
  /**
   * Days finished so far, during `writing`.
   *
   * This is a real count of validated days in hand, not an estimate of how far
   * through a model is — the plan is written in batches, so the number is known
   * rather than guessed.
   */
  onProgress?: (done: number, total: number) => void;
  /** Lets a caller abandon a slow request. */
  signal?: AbortSignal;
}

/**
 * Named stages rather than a percentage.
 *
 * A percentage of a single model call would be a lie — we cannot know how far
 * through it is — so the waiting screen names the step instead. The one number
 * it does show comes from `onProgress`, and that one is real: the days are
 * written in batches, so finished days can be counted rather than estimated.
 */
export type GenerationStage =
  | "brief"
  | "strategy"
  | "writing"
  | "checking"
  | "saving";

/**
 * The seam between the product and whatever writes the words.
 *
 * The UI only ever depends on this interface, so swapping the deterministic
 * engine for an AI-backed one is a change to `getContentGenerator()` and
 * nothing else.
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
