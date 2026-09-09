import { AiError, aiConfigured } from "@/lib/ai/openai";
import { generateItems } from "@/lib/ai/generate";
import { decodeGenerationRequest, RequestError } from "@/lib/ai/request";
import { AuthError, bearerToken, verifyIdToken, withinBudget } from "@/lib/ai/verify";

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
 *   2. Check their budget, so a stuck retry loop cannot run up a bill.
 *   3. Decode and clamp the body — untrusted input, even from a real owner.
 *   4. Generate, validate, repair once.
 *   5. Return a message an owner can read, or a code the UI can act on. The
 *      provider's own error text stays in the server log.
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

  // What this request will actually cost: the named days, or the whole month.
  const cost = decoded.mode === "days" ? decoded.targetDays.length : decoded.days;
  if (!withinBudget(uid, cost)) return fail("rate_limited", 429);

  try {
    const outcome = await generateItems(decoded, request.signal);
    if (outcome.violations.length > 0) {
      // Everything returned passed validation; this only records that a repair
      // pass was needed, which is worth knowing when tuning the prompt.
      console.warn(
        `[generate] repaired ${outcome.violations.length} violation(s) in ${outcome.calls} call(s)`,
      );
    }
    return Response.json({ items: outcome.items });
  } catch (error) {
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
