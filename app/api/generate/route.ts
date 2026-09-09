import { AiError, aiConfigured } from "@/lib/ai/openai";
import { generateItems, GenerationFailure } from "@/lib/ai/generate";
import { costOf, usd } from "@/lib/ai/pricing";
import { decodeGenerationRequest, RequestError } from "@/lib/ai/request";
import { cacheHitRate, ZERO_USAGE, type Usage } from "@/lib/ai/usage";
import { AuthError, bearerToken, verifyIdToken, withinBudget } from "@/lib/ai/verify";
import { readPack } from "@/lib/server/store";

/**
 * The only place ContentKita talks to an AI provider.
 *
 * The provider secret lives in `OPENAI_API_KEY` and is read exclusively inside
 * this request path — never in a `NEXT_PUBLIC_` variable, never in a client
 * component, never in a response body. The browser sends a Firebase ID token
 * and a restaurant profile, and receives finished, validated content.
 *
 * Order of business, and none of it is optional:
 *   1. Verify the caller. Generation costs money; an anonymous caller is not
 *      entitled to spend it.
 *   2. Decode and clamp the body — untrusted input, even from a real owner.
 *   3. Check the entitlement: a paid pack, owned by this caller, read from
 *      Firestore. Since M5 content is something you buy, and "signed in" is no
 *      longer the same thing as "entitled to spend our OpenAI budget".
 *   4. Check their budget, so a stuck retry loop cannot run up a bill.
 *   5. Generate, validate, repair once.
 *   6. Return a message an owner can read, or a code the UI can act on. The
 *      provider's own error text stays in the server log.
 *
 * The entitlement check reads the pack document with the server's own
 * credentials rather than believing the body. A browser can put any packId in a
 * request; what it cannot do is make `paymentStatus` say `paid` on a document
 * only the payment callback may write.
 */

export const runtime = "nodejs";
/** Generation is per-request and per-owner; a cached response would be wrong. */
export const dynamic = "force-dynamic";

/** Codes the browser may see, each with wording safe to put in front of an owner. */
const MESSAGES: Record<string, string> = {
  unauthenticated: "Sesi anda dah tamat. Sila log masuk semula.",
  forbidden: "Anda tiada akses kepada tindakan ini.",
  rate_limited:
    "Anda dah jana banyak content dalam masa singkat. Cuba lagi sekejap lagi.",
  bad_request: "Maklumat restoran tak lengkap. Semak semula dan cuba lagi.",
  no_pack:
    "Anda perlukan pack yang telah dibayar untuk jana content. Beli pack 30 hari dahulu.",
  misconfigured:
    "Penjana content belum disediakan sepenuhnya. Sila hubungi kami — ini masalah di pihak kami, bukan anda.",
  unavailable:
    "Penjana content tak dapat dihubungi sekarang. Cuba lagi sekejap lagi.",
  timeout: "Terlalu lama menunggu. Cuba jana semula sekejap lagi.",
  incomplete:
    "Kami tak berpuas hati dengan content yang terhasil, jadi kami tak simpan apa-apa. Cuba jana semula.",
  unknown: "Ada masalah teknikal. Cuba lagi sekejap lagi.",
};

function fail(code: string, status: number) {
  return Response.json(
    { error: { code, message: MESSAGES[code] ?? MESSAGES.unknown } },
    { status },
  );
}

/** Server-side only. Nothing logged here is ever sent to the browser. */
function log(stage: string, error: unknown) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[generate] ${stage} — ${detail}`);
}

/**
 * One line per generation, so what a pack costs is a fact rather than an
 * estimate.
 *
 * Deliberately narrow. It records the shape of the spend — which model, how
 * many tokens, how many of them were cached, how long it took, whether a repair
 * was needed — and nothing about who asked or what they asked for. No key, no
 * token, no owner identifier, no prompt text, no generated copy. The cost
 * figure is derived from the rate table rather than reported by the provider,
 * so it is a local estimate and says so.
 *
 * None of this reaches the browser: the response body carries `items` only.
 * Token accounting is an operational concern and shows an owner nothing they
 * can act on.
 */
function meter(fields: {
  outcome: "ok" | "failed";
  days: number;
  models: string[];
  usage: Usage;
  calls: number;
  repairs: number;
  durationMs: number;
  code?: string;
}) {
  const { usage, models } = fields;
  // A repair uses a second model, so a single rate cannot price the call. The
  // first model wrote the bulk of the tokens and is the honest one to price by.
  const cost = costOf(models[0] ?? "", usage);
  console.info(
    "[generate] " +
      [
        fields.outcome,
        fields.code ? `code=${fields.code}` : null,
        `days=${fields.days}`,
        `model=${models.join("+") || "none"}`,
        `in=${usage.input}`,
        `cached=${usage.cachedInput}`,
        `cache_hit=${(cacheHitRate(usage) * 100).toFixed(0)}%`,
        `out=${usage.output}`,
        `total=${usage.input + usage.output}`,
        `calls=${fields.calls}`,
        `repairs=${fields.repairs}`,
        `ms=${fields.durationMs}`,
        cost > 0 ? `est_cost=${usd(cost)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
  );
}

export async function POST(request: Request) {
  if (!aiConfigured()) {
    log("config", new Error("OPENAI_API_KEY missing"));
    return fail("misconfigured", 503);
  }

  let uid: string;
  try {
    const token = bearerToken(request);
    if (!token) return fail("unauthenticated", 401);
    ({ uid } = await verifyIdToken(token));
  } catch (error) {
    log("auth", error);
    if (error instanceof AuthError && error.code === "misconfigured") {
      return fail("misconfigured", 503);
    }
    if (error instanceof AuthError && error.code === "unavailable") {
      return fail("unavailable", 503);
    }
    return fail("unauthenticated", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request", 400);
  }

  let decoded;
  try {
    decoded = decodeGenerationRequest(body, uid);
  } catch (error) {
    if (error instanceof RequestError) return fail("bad_request", 400);
    log("decode", error);
    return fail("unknown", 500);
  }

  // The entitlement, before the budget and long before the provider. Failing
  // closed on purpose: no packId, an unknown pack, somebody else's pack or an
  // unpaid one all end here, and none of them costs a single token.
  try {
    if (!decoded.packId) return fail("no_pack", 402);
    const pack = await readPack(uid, decoded.packId);
    if (!pack || pack.paymentStatus !== "paid") return fail("no_pack", 402);
  } catch (error) {
    // A store that cannot be read is not permission to generate.
    log("entitlement", error);
    return fail("unavailable", 503);
  }

  // What this request will actually cost: the named days, or the whole month.
  const cost = decoded.mode === "days" ? decoded.targetDays.length : decoded.days;
  if (!withinBudget(uid, cost)) return fail("rate_limited", 429);

  const started = Date.now();
  try {
    const outcome = await generateItems(decoded, request.signal);
    meter({
      outcome: "ok",
      days: cost,
      models: outcome.models,
      usage: outcome.usage,
      calls: outcome.calls,
      repairs: outcome.repairs,
      durationMs: outcome.durationMs,
    });
    if (outcome.violations.length > 0) {
      // Everything returned passed validation. This records what the validator
      // caught on the way there, which is what tells us whether the prompt
      // needs work or repairs are simply rare.
      console.warn(
        `[generate] repaired ${outcome.violations.length} violation(s): ` +
          [...new Set(outcome.violations.map((v) => v.code))].join(", "),
      );
    }
    return Response.json({ items: outcome.items });
  } catch (error) {
    // A failure that got as far as calling the provider knows what it spent;
    // one that did not is genuinely zero.
    const spent = error instanceof GenerationFailure ? error : null;
    meter({
      outcome: "failed",
      code: error instanceof AiError ? error.code : "unknown",
      days: cost,
      models: spent?.models ?? [],
      usage: (error instanceof AiError && error.usage) || ZERO_USAGE,
      calls: spent?.calls ?? 0,
      repairs: spent?.repairs ?? 0,
      durationMs: spent?.durationMs ?? Date.now() - started,
    });
    if (spent && spent.violations.length > 0) {
      console.warn(
        `[generate] gave up after ${spent.violations.length} violation(s): ` +
          [...new Set(spent.violations.map((v) => v.code))].join(", "),
      );
    }
    log("generate", error);
    if (error instanceof AiError) {
      switch (error.code) {
        case "misconfigured":
          return fail("misconfigured", 503);
        case "cancelled":
          return fail("timeout", 499);
        case "incomplete":
          return fail("incomplete", 502);
        case "unavailable":
        case "truncated":
        case "empty":
        case "malformed":
          return fail("unavailable", 503);
        default:
          return fail("unknown", 502);
      }
    }
    return fail("unknown", 500);
  }
}
