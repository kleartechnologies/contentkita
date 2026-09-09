import { PLATFORM_LABEL } from "../content/categories.ts";
import { COPY_STYLE_OPTIONS, EMPTY_PROFILE } from "../content/demo.ts";
import type {
  AssetRef,
  BrandTone,
  ContentLanguage,
  CopyStyle,
  Platform,
  RestaurantProfile,
  VisualStyle,
} from "../content/types.ts";

/**
 * Decoding the generation request body.
 *
 * The body arrives from a browser, so it is untrusted input even though it is
 * the caller's own restaurant. Two things happen here:
 *
 *  1. **Typing.** Every field is checked rather than cast, so a malformed body
 *     produces a clear rejection instead of an odd-looking prompt.
 *  2. **Clamping.** Free text is cut to a sane length. An owner cannot paste a
 *     novel into "nota menu" and turn one generation into a very expensive one,
 *     and an unbounded field is the obvious lever for someone trying to.
 *
 * Pure, with no SDK import, so the limits are unit-testable offline.
 */

export const LIMITS = {
  name: 80,
  cuisine: 60,
  location: 80,
  description: 400,
  targetCustomers: 200,
  dish: 60,
  dishes: 8,
  menuNotes: 1200,
  promotion: 200,
  promotionDates: 120,
  promotionConditions: 200,
  brandColours: 120,
  referenceDesigns: 300,
  exampleCaption: 600,
} as const;

export const MIN_DAYS = 1;
export const MAX_DAYS = 30;

/**
 * The most days one request may name.
 *
 * It is a cost guard — it stops a "regenerate one day" request from asking for
 * the whole month at single-day prices — but it is also the size a month is
 * written in, because a whole-month request cannot finish inside the response
 * limit of the platform in front of this route. The client imports this rather
 * than keeping its own copy: when the two numbers drifted, every batch was
 * silently trimmed and no month could ever be completed.
 */
export const MAX_TARGET_DAYS = 6;

function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const TONES: readonly BrandTone[] = [
  "friendly",
  "casual",
  "funny",
  "premium",
  "family",
  "kampung",
];
const LANGUAGES: readonly ContentLanguage[] = ["ms", "en", "rojak"];
const VISUAL_STYLES: readonly VisualStyle[] = [
  "hangat",
  "bersih",
  "gelap",
  "cerah",
  "kampung",
  "moden",
];
const COPY_STYLES: readonly CopyStyle[] = COPY_STYLE_OPTIONS.map((o) => o.value);
const PLATFORMS = Object.keys(PLATFORM_LABEL) as Platform[];

function stringList(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const clean = clamp(entry, itemMax);
    if (clean && !out.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      out.push(clean);
    }
    if (out.length >= max) break;
  }
  return out;
}

export class RequestError extends Error {}

export interface GenerationRequestBody {
  mode: "plan" | "days";
  restaurant: RestaurantProfile;
  days: number;
  startDate: string;
  /** Only for `days` mode: which days to write. */
  targetDays: number[];
  /** Hooks already in the plan, so a regenerated day comes back different. */
  avoid: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Stands in for an uploaded file on the server side.
 *
 * The generator only ever asks whether an asset exists, so the real path and
 * URL are not sent to it at all. Substituting this placeholder makes that
 * guarantee structural rather than a convention someone could forget.
 */
const PRESENT: AssetRef = {
  path: "",
  url: "",
  name: "",
  contentType: "",
  size: 0,
  uploadedAt: "",
};

/**
 * The uploaded assets are deliberately dropped rather than decoded.
 *
 * The generator is told *that* a logo or menu exists (via the brief) but never
 * receives a URL or reads a file, so an upload can never become a source of
 * invented dish names or prices. Ownership of those files is a Storage-rules
 * concern, not a prompt one.
 */
export function decodeGenerationRequest(
  body: unknown,
  ownerId: string,
): GenerationRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new RequestError("Body must be an object");
  }
  const b = body as Record<string, unknown>;
  const r = b.restaurant;
  if (typeof r !== "object" || r === null) {
    throw new RequestError("Missing restaurant");
  }
  const raw = r as Record<string, unknown>;

  const name = clamp(raw.name, LIMITS.name);
  const cuisine = clamp(raw.cuisine, LIMITS.cuisine);
  if (!name || !cuisine) {
    throw new RequestError("Restaurant needs at least a name and a cuisine");
  }

  const promotion = clamp(raw.promotion, LIMITS.promotion);
  const platforms = stringList(raw.platforms, 4, 20).filter((p): p is Platform =>
    PLATFORMS.includes(p as Platform),
  );
  const copyStyles = stringList(raw.copyStyles, 6, 20).filter((s): s is CopyStyle =>
    COPY_STYLES.includes(s as CopyStyle),
  );

  const blank = EMPTY_PROFILE(ownerId);
  const restaurant: RestaurantProfile = {
    ...blank,
    // The owner is whoever the verified token says it is, never whoever the
    // body claims. Nothing downstream can be steered by a forged id.
    id: ownerId,
    name,
    cuisine,
    location: clamp(raw.location, LIMITS.location),
    description: clamp(raw.description, LIMITS.description),
    targetCustomers: clamp(raw.targetCustomers, LIMITS.targetCustomers),
    bestSellers: stringList(raw.bestSellers, LIMITS.dishes, LIMITS.dish),
    menuNotes: clamp(raw.menuNotes, LIMITS.menuNotes),
    // Presence only. The file is never opened, so a menu upload cannot smuggle
    // facts into the prompt — the brief says a menu exists and says explicitly
    // that its contents are unknown.
    menuFile: raw.menuFile ? PRESENT : null,
    promotion: promotion || null,
    promotionDates: promotion ? clamp(raw.promotionDates, LIMITS.promotionDates) : "",
    promotionConditions: promotion
      ? clamp(raw.promotionConditions, LIMITS.promotionConditions)
      : "",
    logo: raw.logo ? PRESENT : null,
    visualStyle: oneOf(raw.visualStyle, VISUAL_STYLES, "hangat"),
    brandColours: clamp(raw.brandColours, LIMITS.brandColours),
    referenceDesigns: clamp(raw.referenceDesigns, LIMITS.referenceDesigns),
    tone: oneOf(raw.tone, TONES, "friendly"),
    language: oneOf(raw.language, LANGUAGES, "ms"),
    platforms: platforms.length ? platforms : ["instagram"],
    copyStyles: copyStyles.length ? copyStyles : ["santai"],
    exampleCaption: clamp(raw.exampleCaption, LIMITS.exampleCaption),
  };

  const mode = b.mode === "days" ? "days" : "plan";
  const days = Number(b.days);
  const planDays =
    Number.isInteger(days) && days >= MIN_DAYS && days <= MAX_DAYS ? days : MAX_DAYS;

  const startDate =
    typeof b.startDate === "string" && ISO_DATE.test(b.startDate)
      ? b.startDate
      : new Date().toISOString().slice(0, 10);

  const targetDays = Array.isArray(b.targetDays)
    ? [...new Set(b.targetDays.filter((d): d is number => Number.isInteger(d)))]
        .filter((d) => d >= 1 && d <= planDays)
        .sort((a, z) => a - z)
    : [];

  if (mode === "days" && targetDays.length === 0) {
    throw new RequestError("No valid days requested");
  }

  // Refused, not trimmed. Silently answering a smaller question than the one
  // asked is how a caller ends up with a month that is missing every sixth day
  // and no error to explain it.
  if (targetDays.length > MAX_TARGET_DAYS) {
    throw new RequestError(
      `Too many days in one request: ${targetDays.length} > ${MAX_TARGET_DAYS}`,
    );
  }

  return {
    mode,
    restaurant,
    days: planDays,
    startDate,
    targetDays,
    avoid: stringList(b.avoid, 40, 200),
  };
}

