import assert from "node:assert/strict";
import test from "node:test";

import { decodeCallback } from "./callback.ts";
import {
  decideFulfilment,
  newOrder,
  newOrderId,
  packIdForOrder,
  type Order,
} from "./orders.ts";
import { PACK_PRICE_SEN } from "./product.ts";

/**
 * The rules that turn money into an entitlement.
 *
 * Everything here is the pure half of the callback route, which is the point:
 * the decisions that must never be wrong are the ones that need no network to
 * test. The scenarios below are the ways this goes wrong in the wild — a
 * callback replayed, a bill from someone else's collection, a bill paid for
 * the wrong amount, a bill that was never paid at all.
 */

const COLLECTION = "inbmmepb";
const NOW = "2026-09-10T00:00:00.000Z";

const order = (over: Partial<Order> = {}): Order => ({
  ...newOrder("uid-owner-a", NOW),
  billplzBillId: "8X0Iytgi",
  billplzCollectionId: COLLECTION,
  ...over,
});

const callback = (fields: Record<string, string> = {}) =>
  decodeCallback(
    new URLSearchParams({
      id: "8X0Iytgi",
      collection_id: COLLECTION,
      paid: "true",
      state: "paid",
      amount: String(PACK_PRICE_SEN),
      paid_amount: String(PACK_PRICE_SEN),
      paid_at: "2026-09-10 04:22:11 +0800",
      transaction_id: "6TSHTBSA",
      ...fields,
    }).toString(),
  );

/* --- identifiers ---------------------------------------------------------- */

test("order ids are unguessable and unique", () => {
  const ids = new Set(Array.from({ length: 500 }, newOrderId));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^ord_[0-9a-f]{24}$/);
});

test("one order can only ever name one pack", () => {
  // The whole of duplicate protection rests on this being a function rather
  // than a fresh random value.
  const id = newOrderId();
  assert.equal(packIdForOrder(id), packIdForOrder(id));
  assert.match(packIdForOrder(id), /^pak_[0-9a-f]{24}$/);
});

test("two orders never name the same pack", () => {
  assert.notEqual(packIdForOrder(newOrderId()), packIdForOrder(newOrderId()));
});

/* --- construction --------------------------------------------------------- */

test("a new order is priced, owned and unpaid, with no bill yet", () => {
  const fresh = newOrder("uid-owner-a", NOW);
  assert.equal(fresh.amountSen, 3990);
  assert.equal(fresh.currency, "MYR");
  assert.equal(fresh.product, "30_day_content_pack");
  assert.equal(fresh.paymentStatus, "pending");
  assert.equal(fresh.ownerId, "uid-owner-a");
  assert.equal(fresh.billplzBillId, null);
  assert.equal(fresh.paidAt, null);
  assert.equal(fresh.packId, packIdForOrder(fresh.orderId));
});

/* --- the happy path ------------------------------------------------------- */

test("a paid callback for the right bill and amount fulfils exactly once", () => {
  const decision = decideFulfilment(order(), callback(), COLLECTION);
  assert.equal(decision.kind, "fulfil");
  assert.equal(decision.kind === "fulfil" && decision.transactionId, "6TSHTBSA");
});

/* --- replay --------------------------------------------------------------- */

test("a repeated callback for an already-paid order creates nothing", () => {
  const paid = order({ paymentStatus: "paid", paidAt: NOW });
  const decision = decideFulfilment(paid, callback(), COLLECTION);
  assert.equal(decision.kind, "already");
  assert.equal(decision.kind === "already" && decision.packId, paid.packId);
});

test("a replay reports the pack the first callback made, not a new one", () => {
  const paid = order({ paymentStatus: "paid", paidAt: NOW });
  const first = decideFulfilment(paid, callback(), COLLECTION);
  const second = decideFulfilment(paid, callback(), COLLECTION);
  assert.deepEqual(first, second);
});

/* --- wrong bill, wrong collection, wrong money ---------------------------- */

test("a callback about a different bill is refused", () => {
  const decision = decideFulfilment(order(), callback({ id: "OTHERBILL" }), COLLECTION);
  assert.equal(decision.kind, "reject");
  assert.equal(decision.kind === "reject" && decision.code, "PAYMENT_NOT_FOUND");
});

test("an order with no bill recorded cannot be fulfilled", () => {
  const decision = decideFulfilment(
    order({ billplzBillId: null }),
    callback(),
    COLLECTION,
  );
  assert.equal(decision.kind, "reject");
});

test("a bill from another collection is refused even though it is paid", () => {
  const decision = decideFulfilment(
    order(),
    callback({ collection_id: "someone-elses" }),
    COLLECTION,
  );
  assert.equal(decision.kind, "reject");
  assert.equal(decision.kind === "reject" && decision.code, "PAYMENT_NOT_FOUND");
});

test("an unconfigured collection refuses everything rather than matching blank", () => {
  const decision = decideFulfilment(order(), callback({ collection_id: "" }), "");
  assert.equal(decision.kind, "reject");
});

test("underpayment is refused", () => {
  const decision = decideFulfilment(
    order(),
    callback({ amount: "100", paid_amount: "100" }),
    COLLECTION,
  );
  assert.equal(decision.kind, "reject");
  assert.equal(decision.kind === "reject" && decision.code, "PAYMENT_AMOUNT_MISMATCH");
});

test("overpayment is refused too", () => {
  const decision = decideFulfilment(
    order(),
    callback({ amount: "9900", paid_amount: "9900" }),
    COLLECTION,
  );
  assert.equal(decision.kind, "reject");
  assert.equal(decision.kind === "reject" && decision.code, "PAYMENT_AMOUNT_MISMATCH");
});

test("an unparseable amount is refused, never treated as the price", () => {
  const decision = decideFulfilment(
    order(),
    callback({ amount: "39.90", paid_amount: "39.90" }),
    COLLECTION,
  );
  assert.equal(decision.kind, "reject");
  assert.equal(decision.kind === "reject" && decision.code, "PAYMENT_AMOUNT_MISMATCH");
});

test("an order whose stored amount was not the price is refused", () => {
  // Belt and braces: if an order ever existed with the wrong amount on it, a
  // correct payment against it still does not fulfil.
  const decision = decideFulfilment(order({ amountSen: 100 }), callback(), COLLECTION);
  assert.equal(decision.kind, "reject");
  assert.equal(decision.kind === "reject" && decision.code, "PAYMENT_AMOUNT_MISMATCH");
});

test("what was actually paid wins over what the bill said", () => {
  const decision = decideFulfilment(
    order(),
    callback({ amount: String(PACK_PRICE_SEN), paid_amount: "100" }),
    COLLECTION,
  );
  assert.equal(decision.kind, "reject");
});

/* --- not paid ------------------------------------------------------------- */

test("an unpaid callback creates no pack", () => {
  const decision = decideFulfilment(
    order(),
    callback({ paid: "false", state: "due" }),
    COLLECTION,
  );
  assert.equal(decision.kind, "unpaid");
  assert.equal(decision.kind === "unpaid" && decision.status, "pending");
});

test("a deleted bill cancels the order rather than leaving it pending forever", () => {
  const decision = decideFulfilment(
    order(),
    callback({ paid: "false", state: "deleted" }),
    COLLECTION,
  );
  assert.equal(decision.kind, "unpaid");
  assert.equal(decision.kind === "unpaid" && decision.status, "cancelled");
});

test("paid=false with a paid-looking amount still creates nothing", () => {
  // The amount field is not authority. `paid` is.
  const decision = decideFulfilment(order(), callback({ paid: "false" }), COLLECTION);
  assert.equal(decision.kind, "unpaid");
});
