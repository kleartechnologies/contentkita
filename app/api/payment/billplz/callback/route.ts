import { billplzConfig } from "@/lib/payment/billplz";
import { decodeCallback } from "@/lib/payment/callback";
import { PaymentError } from "@/lib/payment/errors";
import { decideFulfilment } from "@/lib/payment/orders";
import { verifySignature } from "@/lib/payment/signature";
import { fulfil, markOrder, orderIdForBill, readOrder } from "@/lib/server/store";

/**
 * Where payment becomes true.
 *
 * This route is the single source of payment authority in the product. Not the
 * redirect the customer lands on, not a query parameter, not anything the
 * browser says — those can all be typed by hand. Only a POST that carries a
 * valid `x_signature` computed with our X Signature Key is believed, and only
 * after it has been matched against an order we ourselves created.
 *
 * ## The order of operations, which is the whole security argument
 *
 *   1. Read the body. Believe none of it.
 *   2. Verify the signature over the parameters exactly as received. Anything
 *      that fails here is discarded without a database read.
 *   3. Resolve the order through **our own** bill-id mapping. The payload's
 *      `reference_1` is not consulted: it is attacker-controlled in the same
 *      breath as everything else.
 *   4. Check the collection, the owner and that the amount is exactly 3990 sen.
 *   5. Fulfil in one atomic commit whose preconditions make a second delivery a
 *      no-op rather than a second pack.
 *
 * ## Why almost everything returns 200
 *
 * Billplz retries a callback it considers failed. A 500 for "we already did
 * this" would produce a retry storm over an outcome that is already correct, so
 * anything we have understood and handled — including a duplicate and including
 * an unpaid bill — is a 200. A bad signature is a 401, because that is not a
 * delivery problem and there is nothing to retry.
 */

export const runtime = "nodejs";
/** Payment state changes per request; nothing here may be cached. */
export const dynamic = "force-dynamic";

/**
 * The operational record of a payment.
 *
 * Ids, status, outcome and duration. Never the signature, never the key, never
 * the payer's email or name, never the raw body — a callback payload carries
 * customer details that have no business sitting in a log.
 */
function log(fields: {
  result: string;
  billId?: string;
  orderId?: string;
  packId?: string;
  status?: string;
  ms: number;
}) {
  console.info(
    "[payment] callback " +
      [
        fields.result,
        fields.billId ? `bill=${fields.billId}` : null,
        fields.orderId ? `order=${fields.orderId}` : null,
        fields.packId ? `pack=${fields.packId}` : null,
        fields.status ? `status=${fields.status}` : null,
        `ms=${fields.ms}`,
      ]
        .filter(Boolean)
        .join(" "),
  );
}

export async function POST(request: Request) {
  const started = Date.now();
  const ms = () => Date.now() - started;

  let config;
  try {
    config = billplzConfig();
  } catch (error) {
    console.error(
      `[payment] callback config error — ${error instanceof PaymentError ? String(error.cause) : "unknown"}`,
    );
    // Retrying will help once the deployment is fixed, so ask for a retry.
    log({ result: "config_error", ms: ms() });
    return new Response("configuration error", { status: 503 });
  }

  const body = await request.text().catch(() => "");
  const callback = decodeCallback(body);

  // Step one, before any database access at all: is this really Billplz?
  if (!verifySignature(callback.params, callback.signature, config.signatureKey)) {
    log({ result: "signature_invalid", billId: callback.billId, ms: ms() });
    return new Response("invalid signature", { status: 401 });
  }

  if (!callback.billId) {
    log({ result: "no_bill_id", ms: ms() });
    return new Response("ok", { status: 200 });
  }

  // Step three: which of our orders is this? Answered by our own mapping, so a
  // signed callback about a bill we never raised resolves to nothing.
  let orderId: string | null;
  try {
    orderId = await orderIdForBill(callback.billId);
  } catch (error) {
    console.error(`[payment] callback lookup failed — ${String(error)}`);
    log({ result: "lookup_failed", billId: callback.billId, ms: ms() });
    return new Response("temporary failure", { status: 503 });
  }

  if (!orderId) {
    log({ result: "unknown_bill", billId: callback.billId, ms: ms() });
    // Nothing to retry: we will never know this bill.
    return new Response("ok", { status: 200 });
  }

  let stored;
  try {
    stored = await readOrder(orderId);
  } catch (error) {
    console.error(`[payment] callback order read failed — ${String(error)}`);
    log({ result: "read_failed", billId: callback.billId, orderId, ms: ms() });
    return new Response("temporary failure", { status: 503 });
  }

  if (!stored) {
    log({ result: "order_missing", billId: callback.billId, orderId, ms: ms() });
    return new Response("ok", { status: 200 });
  }

  const decision = decideFulfilment(stored.order, callback, config.collectionId);

  if (decision.kind === "reject") {
    // Signed, but wrong: wrong collection, wrong bill for this order, or not
    // the price. Loud in the log, and nothing is written.
    console.error(
      `[payment] callback rejected code=${decision.code} order=${orderId} bill=${callback.billId}`,
    );
    log({ result: "rejected", billId: callback.billId, orderId, status: decision.code, ms: ms() });
    return new Response("ok", { status: 200 });
  }

  if (decision.kind === "already") {
    // A duplicate delivery. No second pack, no second order, and `paidAt` is
    // left exactly as the first one set it.
    log({
      result: "already_processed",
      billId: callback.billId,
      orderId,
      packId: decision.packId,
      ms: ms(),
    });
    return new Response("ok", { status: 200 });
  }

  const now = new Date().toISOString();

  if (decision.kind === "unpaid") {
    try {
      await markOrder(stored, decision.status, now);
    } catch (error) {
      console.error(`[payment] callback mark failed — ${String(error)}`);
    }
    log({
      result: "unpaid",
      billId: callback.billId,
      orderId,
      status: decision.status,
      ms: ms(),
    });
    return new Response("ok", { status: 200 });
  }

  try {
    const outcome = await fulfil(
      stored,
      { paidAt: decision.paidAt, transactionId: decision.transactionId },
      now,
    );
    log({
      result: outcome.kind === "created" ? "fulfilled" : "already_processed",
      billId: callback.billId,
      orderId,
      packId: outcome.packId,
      ms: ms(),
    });
    return new Response("ok", { status: 200 });
  } catch (error) {
    // Money has moved and we could not record it. A 503 asks Billplz to try
    // again, which is exactly what should happen — and the retry is safe,
    // because fulfilment is idempotent.
    console.error(`[payment] fulfilment failed order=${orderId} — ${String(error)}`);
    log({ result: "fulfil_failed", billId: callback.billId, orderId, ms: ms() });
    return new Response("temporary failure", { status: 503 });
  }
}
