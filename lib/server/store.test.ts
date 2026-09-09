import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import { encodePlan } from "../firebase/codecs.ts";
import { decodeCallback } from "../payment/callback.ts";
import { decideFulfilment, newOrder } from "../payment/orders.ts";
import { PACK_PRICE_SEN } from "../payment/product.ts";
import { FakeFirestore, fakeCredentials } from "./fake-firestore.ts";
import { resetAccessToken } from "./google-token.ts";
import {
  attachBill,
  fulfil,
  LEGACY_PACK_ID,
  markOrder,
  migrateLegacy,
  orderIdForBill,
  putOrder,
  readPack,
  readPacks,
  readOrder,
} from "./store.ts";

/**
 * Fulfilment, against a Firestore that behaves like Firestore.
 *
 * These are the tests the money rests on. A payment provider will deliver the
 * same callback more than once — it retries on timeouts, and a customer can
 * refresh — so "one payment, one pack" is not something the happy path
 * establishes. It has to survive the callback arriving twice, arriving twice at
 * once, and arriving after the first attempt half-failed.
 *
 * The fake implements the real preconditions, so a duplicate here fails for
 * exactly the reason it would fail in production.
 */

fakeCredentials();

const UID = "uid-owner-a";
const OTHER = "uid-owner-b";
const COLLECTION = "test-collection";
const NOW = "2026-09-10T08:00:00.000Z";

const generator = new MockContentGenerator();

function setup() {
  resetAccessToken();
  return new FakeFirestore();
}

const callbackFor = (billId: string, over: Record<string, string> = {}) =>
  decodeCallback(
    new URLSearchParams({
      id: billId,
      collection_id: COLLECTION,
      paid: "true",
      state: "paid",
      amount: String(PACK_PRICE_SEN),
      paid_amount: String(PACK_PRICE_SEN),
      paid_at: "2026-09-10 04:22:11 +0800",
      transaction_id: "6TSHTBSA",
      ...over,
    }).toString(),
  );

/** A pending order with a bill attached, exactly as `/api/payment/create` leaves it. */
async function pendingOrder(db: FakeFirestore, uid = UID, billId = "BILL1") {
  const order = newOrder(uid, NOW);
  await putOrder(order, db.fetch);
  await attachBill(order, billId, COLLECTION, NOW, db.fetch);
  return order;
}

/* --- creating an order ----------------------------------------------------- */

test("an order is stored priced, owned and unpaid", async () => {
  const db = setup();
  const order = await pendingOrder(db);

  const stored = await readOrder(order.orderId, db.fetch);
  assert.equal(stored?.order.amountSen, 3990);
  assert.equal(stored?.order.ownerId, UID);
  assert.equal(stored?.order.paymentStatus, "pending");
  assert.equal(stored?.order.billplzBillId, "BILL1");
});

test("the same order cannot be created twice", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  await assert.rejects(() => putOrder(order, db.fetch));
});

test("a bill resolves to its order through our own mapping", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  assert.equal(await orderIdForBill("BILL1", db.fetch), order.orderId);
});

test("a bill we never raised resolves to nothing", async () => {
  const db = setup();
  await pendingOrder(db);
  assert.equal(await orderIdForBill("SOMEONE-ELSES-BILL", db.fetch), null);
});

/* --- fulfilment ------------------------------------------------------------ */

test("a verified payment creates exactly one pack", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  const stored = (await readOrder(order.orderId, db.fetch))!;

  const result = await fulfil(
    stored,
    { paidAt: NOW, transactionId: "6TSHTBSA" },
    NOW,
    db.fetch,
  );

  assert.equal(result.kind, "created");
  assert.equal(result.packId, order.packId);

  const packs = await readPacks(UID, db.fetch);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].paymentStatus, "paid");
  assert.equal(packs[0].generationStatus, "awaiting_generation");
  assert.equal(packs[0].orderId, order.orderId);
});

test("the order is marked paid in the same commit as the pack", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  const stored = (await readOrder(order.orderId, db.fetch))!;
  await fulfil(stored, { paidAt: NOW, transactionId: "T1" }, NOW, db.fetch);

  const after = await readOrder(order.orderId, db.fetch);
  assert.equal(after?.order.paymentStatus, "paid");
  assert.equal(after?.order.paidAt, NOW);
  assert.equal(after?.order.transactionId, "T1");
});

test("a duplicate callback creates no second pack", async () => {
  const db = setup();
  const order = await pendingOrder(db);

  const first = await fulfil(
    (await readOrder(order.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );
  const second = await fulfil(
    (await readOrder(order.orderId, db.fetch))!,
    { paidAt: "2026-09-11T00:00:00.000Z", transactionId: "T2" },
    "2026-09-11T00:00:00.000Z",
    db.fetch,
  );

  assert.equal(first.kind, "created");
  assert.equal(second.kind, "already");
  assert.equal((await readPacks(UID, db.fetch)).length, 1);
});

test("a duplicate does not overwrite paidAt or the transaction id", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  await fulfil(
    (await readOrder(order.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );
  await fulfil(
    (await readOrder(order.orderId, db.fetch))!,
    { paidAt: "2026-12-25T00:00:00.000Z", transactionId: "T2" },
    "2026-12-25T00:00:00.000Z",
    db.fetch,
  );

  const after = await readOrder(order.orderId, db.fetch);
  assert.equal(after?.order.paidAt, NOW);
  assert.equal(after?.order.transactionId, "T1");
});

test("a duplicate writes nothing at all", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  await fulfil(
    (await readOrder(order.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );

  const commitsBefore = db.commits;
  await fulfil(
    (await readOrder(order.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );
  assert.equal(db.commits, commitsBefore, "the second delivery did not reach the database");
});

test("two callbacks racing on the same order still make one pack", async () => {
  const db = setup();
  const order = await pendingOrder(db);

  // Both read the order before either writes — the actual race, not a
  // sequential re-run of it.
  const a = (await readOrder(order.orderId, db.fetch))!;
  const b = (await readOrder(order.orderId, db.fetch))!;

  const results = await Promise.all([
    fulfil(a, { paidAt: NOW, transactionId: "T1" }, NOW, db.fetch),
    fulfil(b, { paidAt: NOW, transactionId: "T2" }, NOW, db.fetch),
  ]);

  assert.equal(results.filter((r) => r.kind === "created").length, 1);
  assert.equal(results.filter((r) => r.kind === "already").length, 1);
  assert.equal((await readPacks(UID, db.fetch)).length, 1);
});

test("a failed commit leaves the order unpaid and no pack behind", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  db.failNextCommit = true;

  const stored = (await readOrder(order.orderId, db.fetch))!;
  await assert.rejects(() =>
    fulfil(stored, { paidAt: NOW, transactionId: "T1" }, NOW, db.fetch),
  );

  assert.equal((await readOrder(order.orderId, db.fetch))?.order.paymentStatus, "pending");
  assert.equal((await readPacks(UID, db.fetch)).length, 0);
});

test("a retry after a failed commit still fulfils, once", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  db.failNextCommit = true;
  const stored = (await readOrder(order.orderId, db.fetch))!;
  await assert.rejects(() =>
    fulfil(stored, { paidAt: NOW, transactionId: "T1" }, NOW, db.fetch),
  );

  const result = await fulfil(
    (await readOrder(order.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );
  assert.equal(result.kind, "created");
  assert.equal((await readPacks(UID, db.fetch)).length, 1);
});

/* --- one purchase, one pack ------------------------------------------------ */

test("buying again adds a pack instead of replacing the first", async () => {
  const db = setup();
  const first = await pendingOrder(db, UID, "BILL1");
  await fulfil(
    (await readOrder(first.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );

  const second = await pendingOrder(db, UID, "BILL2");
  await fulfil(
    (await readOrder(second.orderId, db.fetch))!,
    { paidAt: "2026-10-01T00:00:00.000Z", transactionId: "T2" },
    "2026-10-01T00:00:00.000Z",
    db.fetch,
  );

  const packs = await readPacks(UID, db.fetch);
  assert.equal(packs.length, 2);
  assert.notEqual(packs[0].id, packs[1].id);
  assert.deepEqual(
    new Set(packs.map((pack) => pack.orderId)),
    new Set([first.orderId, second.orderId]),
  );
});

test("a second purchase does not disturb the first pack's content", async () => {
  const db = setup();
  const first = await pendingOrder(db, UID, "BILL1");
  await fulfil(
    (await readOrder(first.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );

  // The owner generates into pack one, the way their client would.
  const plan = await generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-09-01",
  });
  db.put(`contentPacks/${UID}/packs/${first.packId}`, {
    ...db.read(`contentPacks/${UID}/packs/${first.packId}`)!,
    ...encodePlan(plan, UID, NOW),
    generationStatus: "ready",
  });

  const second = await pendingOrder(db, UID, "BILL2");
  await fulfil(
    (await readOrder(second.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T2" },
    NOW,
    db.fetch,
  );

  const kept = await readPack(UID, first.packId, db.fetch);
  assert.equal(kept?.plan?.items.length, 30);
  assert.equal(kept?.generationStatus, "ready");
  assert.deepEqual(
    kept?.plan?.items.map((item) => item.caption),
    plan.items.map((item) => item.caption),
  );
});

test("three purchases give three packs, each with its own name and content", async () => {
  const db = setup();
  const base = await generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-09-01",
  });

  const bought = [];
  for (const n of ["1", "2", "3"]) {
    const order = await pendingOrder(db, UID, `BILL${n}`);
    const at = `2026-0${n}-01T00:00:00.000Z`;
    await fulfil(
      (await readOrder(order.orderId, db.fetch))!,
      { paidAt: at, transactionId: `T${n}` },
      at,
      db.fetch,
    );

    // The owner names each one and generates into it, as the app does.
    const plan = {
      ...base,
      items: base.items.map((item) => ({ ...item, caption: `caption ${n} — ${item.day}` })),
    };
    const path = `contentPacks/${UID}/packs/${order.packId}`;
    db.put(path, {
      ...db.read(path)!,
      ...encodePlan(plan, UID, at),
      packName: `Pack ${n}`,
      generationStatus: "ready",
    });
    bought.push({ order, n });
  }

  const packs = await readPacks(UID, db.fetch);
  assert.equal(packs.length, 3);
  assert.equal(new Set(packs.map((pack) => pack.id)).size, 3);
  assert.deepEqual(
    new Set(packs.map((pack) => pack.name)),
    new Set(["Pack 1", "Pack 2", "Pack 3"]),
  );

  // Each pack still holds its own content and its own order, so no purchase
  // wrote over an earlier one.
  for (const { order, n } of bought) {
    const pack = packs.find((candidate) => candidate.id === order.packId);
    assert.equal(pack?.orderId, order.orderId);
    assert.equal(pack?.plan?.items.length, 30);
    assert.equal(pack?.plan?.items[0]?.caption, `caption ${n} — ${base.items[0].day}`);
  }
});

test("one owner's packs are not another's", async () => {
  const db = setup();
  const mine = await pendingOrder(db, UID, "BILL1");
  const theirs = await pendingOrder(db, OTHER, "BILL2");
  await fulfil(
    (await readOrder(mine.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );
  await fulfil(
    (await readOrder(theirs.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T2" },
    NOW,
    db.fetch,
  );

  assert.deepEqual(
    (await readPacks(UID, db.fetch)).map((pack) => pack.orderId),
    [mine.orderId],
  );
  assert.deepEqual(
    (await readPacks(OTHER, db.fetch)).map((pack) => pack.orderId),
    [theirs.orderId],
  );
});

/* --- not paid -------------------------------------------------------------- */

test("an unpaid callback leaves the order pending and makes no pack", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  const stored = (await readOrder(order.orderId, db.fetch))!;

  const decision = decideFulfilment(
    stored.order,
    callbackFor("BILL1", { paid: "false", state: "due" }),
    COLLECTION,
  );
  assert.equal(decision.kind, "unpaid");

  await markOrder(stored, "pending", NOW, db.fetch);
  assert.equal((await readPacks(UID, db.fetch)).length, 0);
});

test("marking never demotes an order that is already paid", async () => {
  const db = setup();
  const order = await pendingOrder(db);
  await fulfil(
    (await readOrder(order.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );

  await markOrder((await readOrder(order.orderId, db.fetch))!, "cancelled", NOW, db.fetch);
  assert.equal((await readOrder(order.orderId, db.fetch))?.order.paymentStatus, "paid");
});

/* --- legacy migration ------------------------------------------------------ */

async function withLegacyPlan(db: FakeFirestore, uid = UID) {
  const plan = await generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-01-01",
  });
  db.put(`contentPlans/${uid}`, { ...encodePlan(plan, uid, "2026-01-01T00:00:00.000Z") });
  for (const item of plan.items.slice(0, 3)) {
    db.put(`contentPlans/${uid}/creatives/${item.id}`, {
      itemId: item.id,
      ownerId: uid,
      elements: [{ id: "e1", kind: "text", text: item.hook }],
    });
  }
  return plan;
}

test("a pre-payment month becomes a grandfathered pack", async () => {
  const db = setup();
  const plan = await withLegacyPlan(db);

  const result = await migrateLegacy(UID, NOW, db.fetch);
  assert.equal(result.kind, "migrated");

  const pack = await readPack(UID, LEGACY_PACK_ID, db.fetch);
  assert.equal(pack?.source, "legacy");
  assert.equal(pack?.paymentStatus, "paid");
  assert.equal(pack?.orderId, null);
  assert.equal(pack?.plan?.items.length, plan.items.length);
});

test("every day and every caption survives migration byte for byte", async () => {
  const db = setup();
  const plan = await withLegacyPlan(db);
  await migrateLegacy(UID, NOW, db.fetch);

  const pack = await readPack(UID, LEGACY_PACK_ID, db.fetch);
  assert.deepEqual(pack?.plan?.items, plan.items);
});

test("migration copies the owner's saved designs", async () => {
  const db = setup();
  await withLegacyPlan(db);
  const result = await migrateLegacy(UID, NOW, db.fetch);

  assert.equal(result.kind === "migrated" && result.creatives, 3);
  assert.equal(db.children(`contentPacks/${UID}/packs/${LEGACY_PACK_ID}/creatives`).length, 3);
});

test("migration deletes nothing", async () => {
  const db = setup();
  await withLegacyPlan(db);
  await migrateLegacy(UID, NOW, db.fetch);

  assert.ok(db.read(`contentPlans/${UID}`), "the original plan is still there");
  assert.equal(db.children(`contentPlans/${UID}/creatives`).length, 3);
});

test("migrating twice produces one pack, not two", async () => {
  const db = setup();
  await withLegacyPlan(db);

  const first = await migrateLegacy(UID, NOW, db.fetch);
  const second = await migrateLegacy(UID, NOW, db.fetch);

  assert.equal(first.kind, "migrated");
  assert.equal(second.kind, "skipped");
  assert.equal(second.kind === "skipped" && second.reason, "already_migrated");
  assert.equal((await readPacks(UID, db.fetch)).length, 1);
});

test("two migrations racing produce one pack", async () => {
  const db = setup();
  await withLegacyPlan(db);

  const results = await Promise.all([
    migrateLegacy(UID, NOW, db.fetch),
    migrateLegacy(UID, NOW, db.fetch),
  ]);
  assert.equal(results.filter((r) => r.kind === "migrated").length, 1);
  assert.equal((await readPacks(UID, db.fetch)).length, 1);
});

test("an owner with nothing to migrate is not given a free pack", async () => {
  const db = setup();
  const result = await migrateLegacy(UID, NOW, db.fetch);
  assert.equal(result.kind, "skipped");
  assert.equal(result.kind === "skipped" && result.reason, "nothing_to_migrate");
  assert.equal((await readPacks(UID, db.fetch)).length, 0);
});

test("migration does not touch another owner's plan", async () => {
  const db = setup();
  await withLegacyPlan(db, OTHER);
  const result = await migrateLegacy(UID, NOW, db.fetch);

  assert.equal(result.kind, "skipped");
  assert.equal((await readPacks(UID, db.fetch)).length, 0);
  assert.equal((await readPacks(OTHER, db.fetch)).length, 0);
});

test("a migrated pack and a purchased pack live side by side", async () => {
  const db = setup();
  await withLegacyPlan(db);
  await migrateLegacy(UID, NOW, db.fetch);

  const order = await pendingOrder(db, UID, "BILL9");
  await fulfil(
    (await readOrder(order.orderId, db.fetch))!,
    { paidAt: NOW, transactionId: "T1" },
    NOW,
    db.fetch,
  );

  const packs = await readPacks(UID, db.fetch);
  assert.equal(packs.length, 2);
  assert.deepEqual(
    new Set(packs.map((pack) => pack.source)),
    new Set(["legacy", "purchase"]),
  );
});
