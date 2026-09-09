import { MAX_TARGET_DAYS } from "../ai/request.ts";
import { addDays, todayIso } from "./mock-generator.ts";
import { buildSchedule } from "./schedule.ts";
import type {
  ContentGenerationRequest,
  ContentGenerator,
  ContentItem,
  ContentPlan,
  RestaurantProfile,
} from "./types.ts";

/**
 * The production content engine.
 *
 * It holds no provider key and speaks no provider protocol: it posts the
 * restaurant to `/api/generate` and gets finished, already-validated days back.
 * That is the whole reason the secret can stay on the server — the browser has
 * nothing to leak.
 *
 * `getToken` is injected rather than imported so this file has no dependency on
 * Firebase, which keeps it unit-testable against a fake transport.
 */

export interface AiGeneratorOptions {
  /** Resolves the caller's Firebase ID token, or throws if signed out. */
  getToken: () => Promise<string>;
  /** Swapped in tests. Defaults to the browser's own `fetch`. */
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

/**
 * How many days one request asks for.
 *
 * A month in a single call takes roughly a minute, and the platform in front of
 * the route cuts a response off at thirty seconds — so a whole-month request
 * could never return, however good the provider. Six days lands near eleven
 * seconds, which leaves room for the one repair attempt the route allows before
 * the ceiling is anywhere near.
 *
 * Taken from the route's own limit rather than chosen again here, so the two
 * cannot disagree about what a batch is.
 */
const PLAN_CHUNK_DAYS = MAX_TARGET_DAYS;

/** Hooks carried into the next batch. Enough to matter, short enough to stay cheap. */
const AVOID_WINDOW = 24;

interface ApiFailure {
  error?: { code?: string; message?: string };
}

/**
 * An error whose message is already safe to render.
 *
 * The route only ever returns wording it has decided an owner may read, so this
 * carries it through unchanged rather than re-deriving a message from a status
 * code the UI would have to interpret.
 */
export class GenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GenerationError";
    this.code = code;
  }
}

const FALLBACK = "Tak dapat jana content sekarang. Cuba lagi sekejap lagi.";

export class AiContentGenerator implements ContentGenerator {
  readonly kind = "ai" as const;
  readonly version = "ai-1.0.0";

  private readonly options: AiGeneratorOptions;

  constructor(options: AiGeneratorOptions) {
    this.options = options;
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<ContentItem[]> {
    const send = this.options.fetchImpl ?? fetch;
    const endpoint = this.options.endpoint ?? "/api/generate";

    let token: string;
    try {
      token = await this.options.getToken();
    } catch {
      throw new GenerationError(
        "unauthenticated",
        "Sesi anda dah tamat. Sila log masuk semula.",
      );
    }

    let response: Response;
    try {
      response = await send(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      throw new GenerationError(
        "network",
        "Sambungan internet nampak terputus. Cuba lagi.",
      );
    }

    if (!response.ok) {
      // `json()` can resolve to null as well as reject, so the payload is
      // treated as absent either way rather than dereferenced.
      const payload = (await response.json().catch(() => null)) as ApiFailure | null;
      throw new GenerationError(
        payload?.error?.code ?? "unknown",
        payload?.error?.message ?? FALLBACK,
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | { items?: unknown }
      | null;
    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new GenerationError("malformed", FALLBACK);
    }
    // The route validated every field before returning, so nothing is re-checked
    // here — re-deriving trust on the client would only invite the two checks to
    // drift apart.
    return payload.items as ContentItem[];
  }

  async generatePlan(request: ContentGenerationRequest): Promise<ContentPlan> {
    const days = request.days ?? 30;
    const startDate = request.startDate ?? todayIso();
    const { restaurant } = request;

    request.onStage?.("brief");
    // Naming the strategy step before the request goes out is honest: the
    // schedule really is decided here, locally, before a model sees anything.
    buildSchedule(restaurant, days, startDate);
    request.onStage?.("strategy");

    request.onStage?.("writing");
    const wire = wireProfile(restaurant);
    const items: ContentItem[] = [];
    const written: string[] = [];

    for (let first = 1; first <= days; first += PLAN_CHUNK_DAYS) {
      const targetDays: number[] = [];
      for (let day = first; day < first + PLAN_CHUNK_DAYS && day <= days; day++) {
        targetDays.push(day);
      }

      const batch = await this.post(
        {
          mode: "days",
          // The entitlement travels with every batch, because every batch is a
          // separate request and the server re-checks each one.
          packId: request.packId ?? "",
          restaurant: wire,
          days,
          startDate,
          targetDays,
          // Earlier batches do not exist as far as a fresh request is
          // concerned, so their hooks are handed forward. Without this the
          // month reads like five short plans that each opened the same way.
          avoid: written.slice(-AVOID_WINDOW),
        },
        request.signal,
      );

      items.push(...batch);
      for (const item of batch) written.push(item.hook);
      request.onProgress?.(items.length, days);
    }

    request.onStage?.("checking");

    const covered = new Set(items.map((item) => item.day));
    if (items.length !== days || covered.size !== days) {
      throw new GenerationError(
        "incomplete",
        "Content yang terhasil tak lengkap, jadi kami tak simpan apa-apa. Cuba jana semula.",
      );
    }

    // Batches come back in the order they were asked for, but the plan is
    // indexed by position below, so an out-of-order day would be given the
    // wrong date. Sorting costs nothing and removes the assumption.
    items.sort((a, b) => a.day - b.day);

    return {
      id: `plan-${restaurant.id}`,
      restaurantId: restaurant.id,
      generatorKind: this.kind,
      generatorVersion: this.version,
      startDate,
      createdAt: new Date().toISOString(),
      items: items.map((item, index) => ({
        ...item,
        date: addDays(startDate, index),
      })),
    };
  }

  async regenerateDay(
    request: ContentGenerationRequest,
    day: number,
  ): Promise<ContentItem> {
    const days = request.days ?? 30;
    const startDate = request.startDate ?? todayIso();

    const items = await this.post(
      {
        mode: "days",
        packId: request.packId ?? "",
        restaurant: wireProfile(request.restaurant),
        days,
        startDate,
        targetDays: [day],
        // Existing hooks go along so the rewrite is actually different rather
        // than a paraphrase of what the owner is looking at.
        avoid: request.avoidHooks ?? [],
      },
      request.signal,
    );

    const item = items.find((i) => i.day === day) ?? items[0];
    if (!item) {
      throw new GenerationError("incomplete", FALLBACK);
    }
    return { ...item, day, date: addDays(startDate, day - 1) };
  }
}

/**
 * What actually goes over the wire.
 *
 * Only presence is sent for the uploaded files. A download URL is not needed to
 * write a caption, and a signed asset URL is not something to hand to a
 * third-party API for no reason.
 */
function wireProfile(profile: RestaurantProfile) {
  return {
    name: profile.name,
    cuisine: profile.cuisine,
    location: profile.location,
    description: profile.description,
    targetCustomers: profile.targetCustomers,
    bestSellers: profile.bestSellers,
    menuNotes: profile.menuNotes,
    menuFile: profile.menuFile ? true : null,
    promotion: profile.promotion,
    promotionDates: profile.promotionDates,
    promotionConditions: profile.promotionConditions,
    logo: profile.logo ? true : null,
    visualStyle: profile.visualStyle,
    brandColours: profile.brandColours,
    referenceDesigns: profile.referenceDesigns,
    tone: profile.tone,
    language: profile.language,
    platforms: profile.platforms,
    copyStyles: profile.copyStyles,
    exampleCaption: profile.exampleCaption,
  };
}
