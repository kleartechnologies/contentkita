import { AuthError, bearerToken, verifyIdToken } from "@/lib/ai/verify";
import { paymentErrorBody } from "@/lib/payment/errors";
import { migrateLegacy } from "@/lib/server/store";

/**
 * Grandfathering: the month an owner already had, moved into a pack.
 *
 * ## Why this is a server route and not three lines in the browser
 *
 * The obvious implementation is for the owner's own client to read
 * `contentPlans/{uid}` and write `contentPacks/{uid}/packs/legacy`. It is also
 * a hole: the security rules would then have to let a client create a pack
 * marked `paymentStatus: "paid"`, and any brand-new account could mint itself
 * a free thirty-day entitlement from the browser console.
 *
 * Running it here instead means the rules can forbid clients from creating
 * packs at all — the strongest possible statement, with no exception to reason
 * about — while the one legitimate case goes through a server that has checked
 * the caller's token and reads the legacy plan from the owner's own document
 * path.
 *
 * ## What it will not do
 *
 * Delete anything. `contentPlans/{uid}` and its creatives stay exactly where
 * they are; this copies. And it will not run twice: the destination id is
 * fixed and the write demands the document not already exist, so a second call
 * reports what the first one did rather than duplicating a month of content.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let uid: string;
  try {
    const token = bearerToken(request);
    if (!token) {
      return Response.json(paymentErrorBody("PAYMENT_UNAUTHENTICATED"), { status: 401 });
    }
    ({ uid } = await verifyIdToken(token));
  } catch (error) {
    if (error instanceof AuthError && error.code !== "unauthenticated") {
      return Response.json(paymentErrorBody("PAYMENT_CONFIG_ERROR"), { status: 503 });
    }
    return Response.json(paymentErrorBody("PAYMENT_UNAUTHENTICATED"), { status: 401 });
  }

  try {
    const result = await migrateLegacy(uid, new Date().toISOString());
    // The uid is deliberately absent from this line: it identifies a person,
    // and the outcome is what operations needs to know.
    console.info(
      `[packs] migrate ${result.kind}` +
        (result.kind === "migrated"
          ? ` pack=${result.packId} days=${result.days} creatives=${result.creatives}`
          : ` reason=${result.reason}`),
    );
    return Response.json(
      result.kind === "migrated"
        ? { migrated: true, packId: result.packId, days: result.days }
        : { migrated: false, reason: result.reason },
    );
  } catch (error) {
    console.error(`[packs] migrate failed — ${String(error)}`);
    return Response.json(paymentErrorBody("PAYMENT_UNAVAILABLE"), { status: 503 });
  }
}
