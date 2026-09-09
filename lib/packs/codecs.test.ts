import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import { decodePlan } from "../firebase/codecs.ts";
import {
  decodePack,
  encodeLegacyPack,
  encodePackPlan,
  encodePaidPack,
  monthlyPackName,
  packSummary,
  sortPacks,
} from "./codecs.ts";

/**
 * The pack document, in both directions.
 *
 * Two properties carry most of the weight. A paid-but-unwritten pack must
 * survive the round trip as an entitlement with no content — that is the state
 * a customer is in for the minute between paying and generating, and losing it
 * loses their money. And a migrated legacy pack must come back with the same
 * thirty days it went in with, because that content is the owner's and nobody
 * is being charged for it a second time.
 */

const UID = "uid-owner-a";
const NOW = "2026-09-10T08:00:00.000Z";

// Built once, up front: every test below wants the same thirty days, and a
// plan is a pure function of its inputs.
const SAMPLE = await new MockContentGenerator().generatePlan({
  restaurant: DEMO_RESTAURANT,
  startDate: "2026-09-01",
});

const plan = () => SAMPLE;

/* --- naming --------------------------------------------------------------- */

test("a new pack is named for its month, in Malay", () => {
  assert.equal(monthlyPackName("2026-09-10T00:00:00.000Z"), "30 Hari Content — September 2026");
  assert.equal(monthlyPackName("2026-03-01T00:00:00.000Z"), "30 Hari Content — Mac 2026");
});

test("a pack name never contains a payment identifier", () => {
  const doc = encodePaidPack({
    packId: "pak_abc123",
    ownerId: UID,
    orderId: "ord_abc123",
    days: 30,
    now: NOW,
    paidAt: NOW,
  });
  assert.ok(!doc.packName.includes("ord_"));
  assert.ok(!doc.packName.includes("pak_"));
  assert.equal(doc.packName, "30 Hari Content — September 2026");
});

/* --- the paid-but-empty pack ---------------------------------------------- */

test("a purchase creates a paid pack with nothing written yet", () => {
  const doc = encodePaidPack({
    packId: "pak_abc",
    ownerId: UID,
    orderId: "ord_abc",
    days: 30,
    now: NOW,
    paidAt: NOW,
  });

  assert.equal(doc.paymentStatus, "paid");
  assert.equal(doc.generationStatus, "awaiting_generation");
  assert.equal(doc.orderId, "ord_abc");
  assert.equal(doc.paidAt, NOW);
  assert.equal(doc.items, undefined);
});

test("an entitlement survives the round trip without any content", () => {
  const doc = encodePaidPack({
    packId: "pak_abc",
    ownerId: UID,
    orderId: "ord_abc",
    days: 30,
    now: NOW,
    paidAt: NOW,
  });
  const pack = decodePack(doc, UID, "pak_abc");

  assert.ok(pack);
  assert.equal(pack.paymentStatus, "paid");
  assert.equal(pack.generationStatus, "awaiting_generation");
  assert.equal(pack.plan, null);
  assert.equal(pack.days, 30);
});

/* --- the written pack ------------------------------------------------------ */

test("generating fills the plan without touching the entitlement", () => {
  const paid = encodePaidPack({
    packId: "pak_abc",
    ownerId: UID,
    orderId: "ord_abc",
    days: 30,
    now: NOW,
    paidAt: NOW,
  });
  const written = { ...paid, ...encodePackPlan(plan(), UID, "ready", NOW) };
  const pack = decodePack(written, UID, "pak_abc");

  assert.ok(pack);
  assert.equal(pack.paymentStatus, "paid");
  assert.equal(pack.generationStatus, "ready");
  assert.equal(pack.plan?.items.length, 30);
  assert.equal(pack.orderId, "ord_abc");
  assert.equal(pack.paidAt, NOW);
});

test("a failed run is retried on the same paid pack, with no new order", () => {
  // The state a customer is in when generation dies: their money is still
  // recorded, and the only thing that failed is the writing. Retrying must
  // reach `ready` through the same pack and the same order.
  const paid = encodePaidPack({
    packId: "pak_abc",
    ownerId: UID,
    orderId: "ord_abc",
    days: 30,
    now: NOW,
    paidAt: NOW,
  });

  // What savePackStatus writes when a run throws: the status, and nothing else.
  const failed = { ...paid, generationStatus: "failed", updatedAt: NOW };
  const afterFailure = decodePack(failed, UID, "pak_abc");
  assert.ok(afterFailure);
  assert.equal(afterFailure.paymentStatus, "paid");
  assert.equal(afterFailure.generationStatus, "failed");
  assert.equal(afterFailure.plan, null);

  const retried = decodePack(
    { ...failed, ...encodePackPlan(plan(), UID, "ready", NOW) },
    UID,
    "pak_abc",
  );
  assert.ok(retried);
  assert.equal(retried.generationStatus, "ready");
  assert.equal(retried.plan?.items.length, 30);
  // The entitlement is untouched by either write, so nobody paid twice.
  assert.equal(retried.paymentStatus, "paid");
  assert.equal(retried.orderId, "ord_abc");
  assert.equal(retried.paidAt, NOW);
});

test("the plan update carries no payment fields at all", () => {
  // What the browser is allowed to send. If a payment field appeared here the
  // rules would reject the write, and rightly.
  const update = encodePackPlan(plan(), UID, "ready", NOW);
  for (const field of ["paymentStatus", "paidAt", "orderId", "source", "days"]) {
    assert.ok(!(field in update), field);
  }
});

test("generating does not rename the owner's pack", () => {
  // The label lives on the pack and is edited on its own screen. A run that
  // happened to be holding a stale name must not write it back.
  assert.ok(!("packName" in encodePackPlan(plan(), UID, "ready", NOW)));
});

/* --- the legacy pack ------------------------------------------------------- */

test("a grandfathered plan becomes a paid legacy pack, uncharged", () => {
  const original = plan();
  const doc = encodeLegacyPack({
    packId: "legacy",
    ownerId: UID,
    plan: original,
    now: NOW,
  });

  assert.equal(doc.source, "legacy");
  assert.equal(doc.orderId, null);
  assert.equal(doc.paymentStatus, "paid");
  assert.equal(doc.paidAt, null, "nobody paid for this one and the record says so");
  assert.equal(doc.generationStatus, "ready");
});

test("migration preserves every day, caption for caption", () => {
  const original = plan();
  const doc = encodeLegacyPack({ packId: "legacy", ownerId: UID, plan: original, now: NOW });
  const back = decodePack(doc, UID, "legacy");

  assert.equal(back?.plan?.items.length, 30);
  assert.deepEqual(
    back?.plan?.items.map((item) => item.caption),
    original.items.map((item) => item.caption),
  );
  assert.deepEqual(back?.plan?.items, original.items);
});

test("migration keeps the original generation date, not the migration's", () => {
  const original = plan();
  const doc = encodeLegacyPack({ packId: "legacy", ownerId: UID, plan: original, now: NOW });
  assert.equal(doc.createdAt, original.createdAt);
  assert.notEqual(doc.createdAt, NOW);
});

test("an owner's own pack name survives migration", () => {
  const named = { ...plan(), packName: "Content Bulan Puasa" };
  const doc = encodeLegacyPack({ packId: "legacy", ownerId: UID, plan: named, now: NOW });
  assert.equal(doc.packName, "Content Bulan Puasa");
});

test("a migrated pack still decodes as a plan for the old readers", () => {
  // The legacy document is a superset of the plan document, so anything that
  // could read a plan can still read this.
  const original = plan();
  const doc = encodeLegacyPack({ packId: "legacy", ownerId: UID, plan: original, now: NOW });
  assert.deepEqual(decodePlan(doc, UID)?.items, original.items);
});

/* --- decoding defensively -------------------------------------------------- */

test("an unknown payment status is read as unpaid, never as paid", () => {
  const pack = decodePack(
    { ownerId: UID, packId: "p", paymentStatus: "definitely_paid" },
    UID,
    "p",
  );
  assert.equal(pack?.paymentStatus, "pending");
});

test("a missing payment status is not an entitlement", () => {
  const pack = decodePack({ ownerId: UID, packId: "p" }, UID, "p");
  assert.equal(pack?.paymentStatus, "pending");
});

test("a document owned by somebody else does not decode", () => {
  const pack = decodePack({ ownerId: "uid-owner-b", packId: "p" }, UID, "p");
  assert.equal(pack, null);
});

test("nonsense decodes to null rather than to a free pack", () => {
  assert.equal(decodePack(null, UID, "p"), null);
  assert.equal(decodePack("paid", UID, "p"), null);
  assert.equal(decodePack(42, UID, "p"), null);
});

/* --- the list -------------------------------------------------------------- */

test("a summary reports written days separately from entitled days", () => {
  const doc = encodePaidPack({
    packId: "pak_abc",
    ownerId: UID,
    orderId: "ord_abc",
    days: 30,
    now: NOW,
    paidAt: NOW,
  });
  const summary = packSummary(decodePack(doc, UID, "pak_abc")!);
  assert.equal(summary.days, 30);
  assert.equal(summary.written, 0);
});

test("packs list newest first", () => {
  const rows = sortPacks([
    { createdAt: "2026-07-01T00:00:00.000Z" },
    { createdAt: "2026-09-01T00:00:00.000Z" },
    { createdAt: "2026-08-01T00:00:00.000Z" },
  ] as never);
  assert.deepEqual(
    rows.map((row) => row.createdAt),
    [
      "2026-09-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    ],
  );
});
