import "server-only";

import { PaymentError } from "./errors.ts";
import { PACK_PRICE_SEN } from "./product.ts";

/**
 * The Billplz API, reachable from the server and nowhere else.
 *
 * `server-only` at the top is load-bearing. The secret key here is the whole
 * merchant account: with it you can raise bills, read anybody's, and see the
 * collection. If this module were ever imported from a client component the
 * build fails, which is a better outcome than discovering the key in a
 * JavaScript bundle.
 *
 * Nothing in this file takes an amount, a currency or a customer id from a
 * caller that got them from a browser. The price is a constant, and the email
 * comes from a verified Firebase token.
 */

export interface BillplzConfig {
  readonly baseUrl: string;
  readonly collectionId: string;
  readonly secretKey: string;
  readonly signatureKey: string;
}

/**
 * Configuration from the environment.
 *
 * Throws `PAYMENT_CONFIG_ERROR` rather than falling back to a default. There is
 * no safe default for a payment provider: a missing collection id would send
 * bills somewhere unknown, and a missing signature key would make every
 * callback unverifiable. Failing at the first request is loud and harmless;
 * limping on is neither.
 */
export function billplzConfig(): BillplzConfig {
  const baseUrl = process.env.BILLPLZ_BASE_URL?.trim().replace(/\/+$/, "");
  const collectionId = process.env.BILLPLZ_COLLECTION_ID?.trim();
  const secretKey = process.env.BILLPLZ_SECRET_KEY?.trim();
  const signatureKey = process.env.BILLPLZ_X_SIGNATURE_KEY?.trim();

  // Names, never values — this message reaches a log.
  const missing = [
    !baseUrl && "BILLPLZ_BASE_URL",
    !collectionId && "BILLPLZ_COLLECTION_ID",
    !secretKey && "BILLPLZ_SECRET_KEY",
    !signatureKey && "BILLPLZ_X_SIGNATURE_KEY",
  ].filter(Boolean);

  if (missing.length) {
    throw new PaymentError("PAYMENT_CONFIG_ERROR", 500, `missing: ${missing.join(", ")}`);
  }

  return {
    baseUrl: baseUrl!,
    collectionId: collectionId!,
    secretKey: secretKey!,
    signatureKey: signatureKey!,
  };
}

/**
 * Billplz authenticates with HTTP Basic: the secret key as the username and an
 * empty password. Built here so no caller ever handles the header.
 */
function authorization(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

export interface CreatedBill {
  readonly billId: string;
  readonly collectionId: string;
  /** The hosted checkout page. The only thing the browser is given. */
  readonly url: string;
}

/**
 * Raises one bill for one pack.
 *
 * The amount is not a parameter. It is `PACK_PRICE_SEN`, read from the product
 * definition, because a price that can be passed in is a price that can
 * eventually be passed in from somewhere untrusted.
 */
export async function createBill(
  input: {
    config: BillplzConfig;
    email: string;
    name: string;
    orderId: string;
    callbackUrl: string;
    redirectUrl: string;
    description: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedBill> {
  const body = new URLSearchParams({
    collection_id: input.config.collectionId,
    email: input.email,
    name: input.name,
    amount: String(PACK_PRICE_SEN),
    callback_url: input.callbackUrl,
    redirect_url: input.redirectUrl,
    description: input.description,
    // Our order id, echoed back on the callback and visible on the receipt.
    // Convenient, and never the basis for deciding which order was paid — that
    // comes from our own bill-id mapping.
    reference_1_label: "Order",
    reference_1: input.orderId,
  });

  let response: Response;
  try {
    response = await fetchImpl(`${input.config.baseUrl}/api/v3/bills`, {
      method: "POST",
      headers: {
        authorization: authorization(input.config.secretKey),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (cause) {
    throw new PaymentError("PAYMENT_CREATE_FAILED", 502, cause);
  }

  if (!response.ok) {
    // The status only. Billplz's error bodies echo the request back, which
    // includes the customer's email, and they are not written for customers.
    throw new PaymentError(
      "PAYMENT_CREATE_FAILED",
      502,
      `billplz returned ${response.status}`,
    );
  }

  const bill = (await response.json().catch(() => null)) as {
    id?: string;
    collection_id?: string;
    url?: string;
  } | null;

  if (!bill?.id || !bill.url) {
    throw new PaymentError("PAYMENT_CREATE_FAILED", 502, "bill response incomplete");
  }

  return {
    billId: bill.id,
    collectionId: bill.collection_id ?? input.config.collectionId,
    url: bill.url,
  };
}
