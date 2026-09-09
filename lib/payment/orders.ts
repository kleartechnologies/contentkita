import { randomBytes } from "node:crypto";

import type { PaymentErrorCode } from "./errors.ts";
import type { BillplzCallback } from "./callback.ts";
import { CURRENCY, PACK_PRICE_SEN, PRODUCT } from "./product.ts";

/**
 * An order: ContentKita's own record of a purchase, and the only one that counts.
 *
 * Billplz knows about a bill. We know about an order. The two are joined by a
 * bill id, and everything that decides what a customer is entitled to — price,
 * owner, product, whether it has already been honoured — lives on this side of
 * that join, written by the server, never by a browser.
 *
 * ## Two statuses, deliberately
 *
 * `paymentStatus` says whether money arrived. `generationStatus` says whether
 * the content was written. They are separate because they fail separately: a
 * generation that dies half way through must not make a paid customer unpaid,
 * and re-running it must not need a second payment. Collapsing them into one
 * field is how a customer ends up paying twice for a crash that was ours.
 */

export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled";

export interface Order {
  readonly orderId: string;
  readonly ownerId: string;
  /** Always `PACK_PRICE_SEN`. Stored anyway, so the price at purchase is a fact. */
  readonly amountSen: number;
  readonly currency: string;
  readonly product: string;
  readonly paymentStatus: PaymentStatus;
  readonly billplzBillId: string | null;
  readonly billplzCollectionId: string | null;
  /** The one pack this order buys. Fixed at creation, never reassigned. */
  readonly packId: string;
  readonly transactionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly paidAt: string | null;
}

/* --- identifiers ---------------------------------------------------------- */

/**
 * A fresh order id.
 *
 * Random rather than sequential: order ids appear in Billplz's reference field
 * and in URLs, and a guessable one invites people to look up somebody else's.
 * Twelve bytes is far more than enough to never collide and short enough to
 * paste into a support conversation.
 */
export function newOrderId(): string {
  return `ord_${randomBytes(12).toString("hex")}`;
}

/**
 * The pack id an order will create — derived, not generated.
 *
 * This is the quiet half of idempotency. Because the id is a pure function of
 * the order, a callback delivered twice computes the same pack id twice, and
 * the second write is refused by an "must not already exist" precondition
 * rather than creating a second pack. A random id would have made two.
 */
export function packIdForOrder(orderId: string): string {
  return `pak_${orderId.replace(/^ord_/, "")}`;
}

/** What we ask Billplz to echo back to us. */
export function orderReference(orderId: string): string {
  return orderId;
}

/* --- the decision --------------------------------------------------------- */

/**
 * What a verified callback should cause.
 *
 * Pure, so the rules that decide whether money becomes a pack can be tested
 * exhaustively without a network, a database or a payment provider. The route
 * does the I/O; this decides.
 */
export type FulfilmentDecision =
  /** First valid pending → paid transition. Create exactly one pack. */
  | { kind: "fulfil"; paidAt: string; transactionId: string | null }
  /** Already honoured. Change nothing, report success. */
  | { kind: "already"; packId: string }
  /** A real callback about a bill that was not paid. Record it; create nothing. */
  | { kind: "unpaid"; status: PaymentStatus }
  /** Something is wrong enough that we refuse to act on it. */
  | { kind: "reject"; code: PaymentErrorCode };

/**
 * Decides what a callback means for an order.
 *
 * The order of the checks is the security argument, so it is worth stating.
 * Identity first — is this callback even about this order — then whether the
 * money is real, then whether it is the right amount, and only then whether we
 * have already acted. An amount check placed after the "already paid" check
 * would let a second callback with a tampered amount pass unnoticed; an
 * identity check placed anywhere but first is not an identity check at all.
 */
export function decideFulfilment(
  order: Order,
  callback: BillplzCallback,
  expectedCollectionId: string,
): FulfilmentDecision {
  // The bill this callback is about must be the bill we recorded against this
  // order. Resolution happens by bill id, so a mismatch here means the mapping
  // and the order disagree — never act on that.
  if (!order.billplzBillId || order.billplzBillId !== callback.billId) {
    return { kind: "reject", code: "PAYMENT_NOT_FOUND" };
  }

  // A signature only proves the sender holds our X Signature key. The
  // collection check proves the bill was raised in our collection rather than
  // some other one, which is what stops a bill we never created from paying
  // for a pack.
  if (!expectedCollectionId || callback.collectionId !== expectedCollectionId) {
    return { kind: "reject", code: "PAYMENT_NOT_FOUND" };
  }

  if (!order.ownerId) return { kind: "reject", code: "PAYMENT_NOT_FOUND" };

  if (order.paymentStatus === "paid") {
    return { kind: "already", packId: order.packId };
  }

  if (!callback.paid) {
    // Billplz told us the truth and the truth is "no money". Not an error, and
    // not a reason to touch the pack.
    return { kind: "unpaid", status: callback.state === "deleted" ? "cancelled" : "pending" };
  }

  // Exactly 3990 sen. Not "at least", because an overpayment is as much a sign
  // of something wrong as an underpayment, and not a tolerance, because there
  // is nothing to be tolerant of in an integer.
  const paid = callback.paidAmountSen ?? callback.amountSen;
  if (paid !== PACK_PRICE_SEN || order.amountSen !== PACK_PRICE_SEN) {
    return { kind: "reject", code: "PAYMENT_AMOUNT_MISMATCH" };
  }

  return {
    kind: "fulfil",
    paidAt: callback.paidAt ?? new Date().toISOString(),
    transactionId: callback.transactionId,
  };
}

/* --- construction --------------------------------------------------------- */

/**
 * A new, unpaid order.
 *
 * Every money-bearing field is set here from constants. There is no parameter
 * for the amount, the currency or the product, because there is no request
 * body anywhere that should be able to influence them.
 */
export function newOrder(ownerId: string, now: string): Order {
  const orderId = newOrderId();
  return {
    orderId,
    ownerId,
    amountSen: PACK_PRICE_SEN,
    currency: CURRENCY,
    product: PRODUCT,
    paymentStatus: "pending",
    billplzBillId: null,
    billplzCollectionId: null,
    packId: packIdForOrder(orderId),
    transactionId: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
  };
}
