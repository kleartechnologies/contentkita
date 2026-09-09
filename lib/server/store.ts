import "server-only";

import { decodePack, encodeLegacyPack, encodePaidPack } from "../packs/codecs.ts";
import { decodePlan } from "../firebase/codecs.ts";
import type { Pack } from "../packs/types.ts";
import type { Order, PaymentStatus } from "../payment/orders.ts";
import { PACK_DAYS } from "../payment/product.ts";
import {
  commit,
  getDocument,
  listDocuments,
  PreconditionFailed,
  type Write,
} from "./firestore.ts";

/**
 * The server's own view of orders, packs and the legacy plan.
 *
 * Everything a browser cannot be allowed to do lives here: creating an order at
 * a price it did not choose, marking one paid, and turning a paid order into a
 * pack. The security rules deny all of that to clients outright, so this file
 * is not a convenience — it is the only path by which those documents ever get
 * written.
 *
 * The uid always comes from a verified token or from a stored order. There is
 * no function here that takes an owner id from a request body.
 */

/* --- paths ---------------------------------------------------------------- */

/** Orders are top level, keyed by an unguessable id, with the owner on the doc. */
const orderPath = (orderId: string) => `orders/${orderId}`;

/**
 * Bill id → order id.
 *
 * A tiny mapping document instead of a query on `orders.billplzBillId`. Two
 * reasons: a query needs an index and a list permission that nothing else
 * wants, and this makes "is this a bill we raised?" a document lookup that
 * either exists or does not. The callback's claim about which order it belongs
 * to is never taken from the payload.
 */
const billPath = (billId: string) => `billplzBills/${encodeURIComponent(billId)}`;

const packPath = (uid: string, packId: string) => `contentPacks/${uid}/packs/${packId}`;
const packsPath = (uid: string) => `contentPacks/${uid}/packs`;
const legacyPlanPath = (uid: string) => `contentPlans/${uid}`;
const legacyCreativesPath = (uid: string) => `contentPlans/${uid}/creatives`;
const packCreativesPath = (uid: string, packId: string) =>
  `contentPacks/${uid}/packs/${packId}/creatives`;

/** The one id a migrated pack ever gets, so migrating twice cannot make two. */
export const LEGACY_PACK_ID = "legacy";

/* --- orders --------------------------------------------------------------- */

function orderFrom(data: Record<string, unknown>): Order | null {
  const orderId = typeof data.orderId === "string" ? data.orderId : "";
  const ownerId = typeof data.ownerId === "string" ? data.ownerId : "";
  const packId = typeof data.packId === "string" ? data.packId : "";
  if (!orderId || !ownerId || !packId) return null;

  const status = data.paymentStatus;
  return {
    orderId,
    ownerId,
    // Not `?? PACK_PRICE_SEN`: an order with no readable amount must fail the
    // callback's amount check, not silently acquire the right one.
    amountSen: typeof data.amountSen === "number" ? data.amountSen : -1,
    currency: typeof data.currency === "string" ? data.currency : "",
    product: typeof data.product === "string" ? data.product : "",
    paymentStatus:
      status === "paid" || status === "failed" || status === "cancelled"
        ? (status as PaymentStatus)
        : "pending",
    billplzBillId: typeof data.billplzBillId === "string" ? data.billplzBillId : null,
    billplzCollectionId:
      typeof data.billplzCollectionId === "string" ? data.billplzCollectionId : null,
    packId,
    transactionId: typeof data.transactionId === "string" ? data.transactionId : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    paidAt: typeof data.paidAt === "string" ? data.paidAt : null,
  };
}

/** An order plus the version stamp a later write will use as its precondition. */
export interface StoredOrder {
  readonly order: Order;
  readonly updateTime: string | undefined;
}

export async function putOrder(order: Order, fetchImpl?: typeof fetch): Promise<void> {
  await commit(
    [{ path: orderPath(order.orderId), data: { ...order }, mustNotExist: true }],
    fetchImpl,
  );
}

export async function readOrder(
  orderId: string,
  fetchImpl?: typeof fetch,
): Promise<StoredOrder | null> {
  const stored = await getDocument(orderPath(orderId), fetchImpl);
  if (!stored) return null;
  const order = orderFrom(stored.data);
  return order ? { order, updateTime: stored.updateTime } : null;
}

/**
 * Records the Billplz bill against the order, and the reverse mapping.
 *
 * Written after the bill exists, in one commit, so there is never a mapping
 * pointing at an order that does not know about it. If this fails the customer
 * sees a checkout error and the order stays pending with no bill — recoverable,
 * and it has cost them nothing.
 */
export async function attachBill(
  order: Order,
  billId: string,
  collectionId: string,
  now: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  await commit(
    [
      {
        path: orderPath(order.orderId),
        data: {
          billplzBillId: billId,
          billplzCollectionId: collectionId,
          updatedAt: now,
        },
        merge: ["billplzBillId", "billplzCollectionId", "updatedAt"],
      },
      {
        path: billPath(billId),
        data: { orderId: order.orderId, ownerId: order.ownerId, createdAt: now },
      },
    ],
    fetchImpl,
  );
}

/** The order a bill belongs to, from our own mapping — never from the payload. */
export async function orderIdForBill(
  billId: string,
  fetchImpl?: typeof fetch,
): Promise<string | null> {
  const stored = await getDocument(billPath(billId), fetchImpl);
  const orderId = stored?.data.orderId;
  return typeof orderId === "string" && orderId ? orderId : null;
}

/** Marks an order as not-paid. Never touches a paid one. */
export async function markOrder(
  stored: StoredOrder,
  status: PaymentStatus,
  now: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  if (stored.order.paymentStatus === "paid") return;
  await commit(
    [
      {
        path: orderPath(stored.order.orderId),
        data: { paymentStatus: status, updatedAt: now },
        merge: ["paymentStatus", "updatedAt"],
        ifUnchangedSince: stored.updateTime,
      },
    ],
    fetchImpl,
  );
}

/* --- fulfilment ----------------------------------------------------------- */

export type FulfilResult =
  /** This call made the pack. Exactly one call ever gets this. */
  | { kind: "created"; packId: string }
  /** Somebody else already did. Nothing was written. */
  | { kind: "already"; packId: string };

/**
 * Turns a verified payment into exactly one pack.
 *
 * ## Why this is one commit
 *
 * The order and the pack are written together, or neither is. That rules out
 * the two states that would cost real money to clean up: an order marked paid
 * with no pack behind it, and a pack that exists with no record of what bought
 * it.
 *
 * ## Why it cannot run twice
 *
 * Two preconditions, both of which must hold:
 *
 *   - the pack **must not already exist** — and its id is derived from the
 *     order id, so a second delivery of the same callback computes the same id
 *     and collides with the first;
 *   - the order **must be unchanged** since it was read, so if another delivery
 *     flipped it to paid a microsecond ago, this batch is rejected wholesale.
 *
 * Billplz retries callbacks, and a customer can refresh a redirect; duplicate
 * delivery is normal, not exceptional. When the commit is refused the outcome
 * is looked up rather than guessed, and the caller is told the pack already
 * exists — which is the truth, and which returns 200 so Billplz stops retrying.
 */
export async function fulfil(
  stored: StoredOrder,
  paid: { paidAt: string; transactionId: string | null },
  now: string,
  fetchImpl?: typeof fetch,
): Promise<FulfilResult> {
  const { order } = stored;

  if (order.paymentStatus === "paid") return { kind: "already", packId: order.packId };

  const writes: Write[] = [
    {
      path: orderPath(order.orderId),
      data: {
        paymentStatus: "paid",
        paidAt: paid.paidAt,
        transactionId: paid.transactionId,
        updatedAt: now,
      },
      merge: ["paymentStatus", "paidAt", "transactionId", "updatedAt"],
      ifUnchangedSince: stored.updateTime,
    },
    {
      path: packPath(order.ownerId, order.packId),
      data: {
        ...encodePaidPack({
          packId: order.packId,
          ownerId: order.ownerId,
          orderId: order.orderId,
          days: PACK_DAYS,
          now,
          paidAt: paid.paidAt,
        }),
      },
      mustNotExist: true,
    },
  ];

  try {
    await commit(writes, fetchImpl);
    return { kind: "created", packId: order.packId };
  } catch (error) {
    if (!(error instanceof PreconditionFailed)) throw error;
    // Refused. Either the pack is already there or the order moved on; both
    // mean somebody else fulfilled this payment, so confirm and report it.
    const existing = await getDocument(packPath(order.ownerId, order.packId), fetchImpl);
    if (existing) return { kind: "already", packId: order.packId };
    throw error;
  }
}

/* --- packs ---------------------------------------------------------------- */

export async function readPack(
  uid: string,
  packId: string,
  fetchImpl?: typeof fetch,
): Promise<Pack | null> {
  const stored = await getDocument(packPath(uid, packId), fetchImpl);
  return stored ? decodePack(stored.data, uid, packId) : null;
}

export async function readPacks(uid: string, fetchImpl?: typeof fetch): Promise<Pack[]> {
  const stored = await listDocuments(packsPath(uid), fetchImpl);
  return stored
    .map((doc) => decodePack(doc.data, uid, doc.id))
    .filter((pack): pack is Pack => pack !== null);
}

/* --- legacy migration ----------------------------------------------------- */

export type MigrationResult =
  | { kind: "migrated"; packId: string; days: number; creatives: number }
  /** Already done, or there was never anything to migrate. */
  | { kind: "skipped"; reason: "already_migrated" | "nothing_to_migrate" };

/**
 * Moves an owner's pre-payment month into a pack, without moving it.
 *
 * ## Non-destructive, on purpose
 *
 * `contentPlans/{uid}` and its creatives are read and copied. Nothing is
 * deleted. If this code is wrong in some way nobody has thought of yet, the
 * original is still exactly where it was, and the owner has lost nothing.
 *
 * ## Idempotent, on purpose
 *
 * The destination id is the constant `legacy`, and the write demands the
 * document not already exist. Running the migration twice — two tabs, a retry,
 * a redeploy that re-triggers it — produces one pack, and the second run says
 * so rather than duplicating a month of the owner's content.
 *
 * The pack is marked paid and `legacy`: they had this content before payment
 * existed and they keep it. Nobody is charged retroactively.
 */
export async function migrateLegacy(
  uid: string,
  now: string,
  fetchImpl?: typeof fetch,
): Promise<MigrationResult> {
  const existing = await getDocument(packPath(uid, LEGACY_PACK_ID), fetchImpl);
  if (existing) return { kind: "skipped", reason: "already_migrated" };

  const stored = await getDocument(legacyPlanPath(uid), fetchImpl);
  if (!stored) return { kind: "skipped", reason: "nothing_to_migrate" };

  const plan = decodePlan(stored.data, uid);
  if (!plan || plan.items.length === 0) {
    return { kind: "skipped", reason: "nothing_to_migrate" };
  }

  const creatives = await listDocuments(legacyCreativesPath(uid), fetchImpl);

  const writes: Write[] = [
    {
      path: packPath(uid, LEGACY_PACK_ID),
      data: {
        ...encodeLegacyPack({ packId: LEGACY_PACK_ID, ownerId: uid, plan, now }),
      },
      mustNotExist: true,
    },
    // Copied verbatim, id for id. A creative is the owner's edited design and
    // re-deriving one would quietly discard the edits.
    ...creatives.map((creative) => ({
      path: `${packCreativesPath(uid, LEGACY_PACK_ID)}/${creative.id}`,
      data: creative.data,
      mustNotExist: true,
    })),
  ];

  try {
    await commit(writes, fetchImpl);
  } catch (error) {
    if (error instanceof PreconditionFailed) {
      return { kind: "skipped", reason: "already_migrated" };
    }
    throw error;
  }

  return {
    kind: "migrated",
    packId: LEGACY_PACK_ID,
    days: plan.items.length,
    creatives: creatives.length,
  };
}
