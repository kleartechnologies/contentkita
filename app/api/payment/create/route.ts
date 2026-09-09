import { AuthError, bearerToken, verifyIdToken } from "@/lib/ai/verify";
import { billplzConfig, createBill } from "@/lib/payment/billplz";
import { PaymentError, paymentErrorBody } from "@/lib/payment/errors";
import { newOrder } from "@/lib/payment/orders";
import { CURRENCY, PACK_DAYS, PACK_PRICE_SEN, priceLabel } from "@/lib/payment/product";
import { siteUrl } from "@/lib/payment/site-url";
import { attachBill, putOrder } from "@/lib/server/store";

/**
 * Starting a purchase.
 *
 * The browser sends nothing but a Firebase ID token. It does not send a price,
 * a product, an owner or an order — every one of those is decided here, because
 * every one of them is a thing somebody would otherwise edit in a console and
 * buy a month of content for one sen.
 *
 * The order is written **before** the bill is raised. That ordering matters: if
 * Billplz answers and this function then dies, the callback still arrives later
 * and finds an order waiting for it. The reverse — bill first, order second —
 * would produce a payment with nothing on our side to attach it to.
 *
 * What comes back is a hosted checkout URL and the order's own id. No bill id,
 * no collection id, no configuration, and nothing that says anything has been
 * paid, because at this point nothing has.
 */

export const runtime = "nodejs";
/** A checkout URL is minted per purchase; a cached one would be somebody else's. */
export const dynamic = "force-dynamic";

/** Server-side only. Never a secret, never a full customer record. */
function log(fields: {
  event: string;
  orderId?: string;
  billId?: string;
  result: string;
  ms?: number;
  code?: string;
}) {
  console.info(
    "[payment] " +
      [
        fields.event,
        fields.result,
        fields.code ? `code=${fields.code}` : null,
        fields.orderId ? `order=${fields.orderId}` : null,
        fields.billId ? `bill=${fields.billId}` : null,
        fields.ms !== undefined ? `ms=${fields.ms}` : null,
      ]
        .filter(Boolean)
        .join(" "),
  );
}

/** The cause is for us; the body is for the customer. They never meet. */
function fail(error: PaymentError, orderId?: string) {
  console.error(
    `[payment] create failed code=${error.code}` +
      (orderId ? ` order=${orderId}` : "") +
      (error.cause ? ` — ${String(error.cause)}` : ""),
  );
  return Response.json(paymentErrorBody(error.code), { status: error.status });
}

export async function POST(request: Request) {
  const started = Date.now();

  let config;
  try {
    config = billplzConfig();
  } catch (error) {
    return fail(
      error instanceof PaymentError ? error : new PaymentError("PAYMENT_CONFIG_ERROR", 500, error),
    );
  }

  // Who is buying. Not who the request body says is buying.
  let caller;
  try {
    const token = bearerToken(request);
    if (!token) return fail(new PaymentError("PAYMENT_UNAUTHENTICATED", 401));
    caller = await verifyIdToken(token);
  } catch (error) {
    if (error instanceof AuthError && error.code !== "unauthenticated") {
      return fail(new PaymentError("PAYMENT_CONFIG_ERROR", 503, error));
    }
    return fail(new PaymentError("PAYMENT_UNAUTHENTICATED", 401, error));
  }

  if (!caller.email) {
    // Billplz needs somewhere to send the receipt, and the only address we are
    // willing to use is the verified one on the account.
    return fail(new PaymentError("PAYMENT_BAD_REQUEST", 400, "account has no email"));
  }

  const now = new Date().toISOString();
  const order = newOrder(caller.uid, now);

  try {
    await putOrder(order);
  } catch (error) {
    return fail(new PaymentError("PAYMENT_CREATE_FAILED", 503, error), order.orderId);
  }

  const origin = siteUrl(request);
  let bill;
  try {
    bill = await createBill({
      config,
      email: caller.email,
      name: caller.name || caller.email.split("@")[0],
      orderId: order.orderId,
      callbackUrl: `${origin}/api/payment/billplz/callback`,
      redirectUrl: `${origin}/payment/result?order=${encodeURIComponent(order.orderId)}`,
      description: `ContentKita — ${PACK_DAYS} Hari Content (${priceLabel()})`,
    });
  } catch (error) {
    return fail(
      error instanceof PaymentError ? error : new PaymentError("PAYMENT_CREATE_FAILED", 502, error),
      order.orderId,
    );
  }

  try {
    await attachBill(order, bill.billId, bill.collectionId, new Date().toISOString());
  } catch (error) {
    // The bill exists but we cannot map it back to the order, so a payment
    // against it could never be fulfilled. Refusing to hand over the checkout
    // URL is the only honest answer: nothing has been charged yet.
    return fail(new PaymentError("PAYMENT_CREATE_FAILED", 503, error), order.orderId);
  }

  log({
    event: "create",
    result: "ok",
    orderId: order.orderId,
    billId: bill.billId,
    ms: Date.now() - started,
  });

  return Response.json({
    checkoutUrl: bill.url,
    orderId: order.orderId,
    amount: PACK_PRICE_SEN,
    currency: CURRENCY,
    priceLabel: priceLabel(),
  });
}
