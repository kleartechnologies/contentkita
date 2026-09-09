"use client";

import { getAuthClient } from "@/lib/auth";
import { paymentMessage, type PaymentErrorCode } from "./errors";

/**
 * The browser's half of buying a pack.
 *
 * Notice how little there is. The browser asks the server to start a purchase
 * and gets back a URL to send the customer to — it does not choose a price, it
 * does not name a product, it does not learn a bill id, and it never finds out
 * from this call whether anything was paid. Payment becomes true in the
 * callback route and nowhere else.
 */

export interface Checkout {
  readonly checkoutUrl: string;
  readonly orderId: string;
  readonly priceLabel: string;
}

/** Turns any failure into one Malay sentence. Nothing technical reaches here. */
async function messageFor(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  return (
    body?.message ??
    paymentMessage((body?.error as PaymentErrorCode) ?? "PAYMENT_UNAVAILABLE")
  );
}

/**
 * Starts a purchase and returns where to send the customer.
 *
 * Deliberately does not navigate. The caller decides when to leave the page, so
 * a component can show its own "membuka halaman bayaran…" state first rather
 * than having the ground disappear from under it.
 */
export async function startCheckout(): Promise<Checkout> {
  const token = await getAuthClient().idToken();

  const response = await fetch("/api/payment/create", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) throw new Error(await messageFor(response));

  const body = (await response.json()) as Partial<Checkout>;
  if (!body.checkoutUrl || !body.orderId) {
    throw new Error(paymentMessage("PAYMENT_CREATE_FAILED"));
  }
  return {
    checkoutUrl: body.checkoutUrl,
    orderId: body.orderId,
    priceLabel: body.priceLabel ?? "",
  };
}

/**
 * Asks the server to grandfather this owner's pre-payment content, if any.
 *
 * Safe to call on every load: the server does nothing when there is nothing to
 * migrate and nothing when it has already run. It returns whether a pack was
 * created so the caller knows whether to re-read the list.
 */
export async function migrateLegacyPack(): Promise<boolean> {
  const token = await getAuthClient().idToken();

  const response = await fetch("/api/packs/migrate", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return false;

  const body = (await response.json().catch(() => null)) as { migrated?: boolean } | null;
  return body?.migrated === true;
}
