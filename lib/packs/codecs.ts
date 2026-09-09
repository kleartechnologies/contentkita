import type { ContentPlan } from "../content/types.ts";
import {
  decodePlan,
  encodePlan,
  type ContentPlanDoc,
} from "../firebase/codecs.ts";
import type { PaymentStatus } from "../payment/orders.ts";
import type { GenerationStatus, Pack, PackSource, PackSummary } from "./types.ts";

/**
 * How a pack is shaped inside Firestore, and how to get back out of it.
 *
 * The document is a `ContentPlanDoc` with an entitlement wrapped around it.
 * That is deliberate rather than lazy: the thirty days keep the exact field
 * names, ordering and defensive decoding they have had since M3, so a pack
 * migrated out of `contentPlans/{uid}` is byte-for-byte the same content, and
 * the existing plan tests still describe the part of this document that holds
 * the writing.
 *
 * Which fields a browser may write is decided by the security rules, not here.
 * This file's job is to make the two representations agree.
 */

/** The plan half is optional: a paid pack exists before a word of it is written. */
export type PackDoc = Partial<ContentPlanDoc> & {
  ownerId: string;
  packId: string;
  orderId: string | null;
  source: PackSource;
  packName: string;
  paymentStatus: PaymentStatus;
  generationStatus: GenerationStatus;
  days: number;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
};

const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "pending",
  "paid",
  "failed",
  "cancelled",
];

const GENERATION_STATUSES: readonly GenerationStatus[] = [
  "awaiting_generation",
  "generating",
  "ready",
  "partial",
  "failed",
];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * An unrecognised payment status is read as `pending`, never as `paid`.
 *
 * The direction matters more than the default. A document written by a future
 * build, or corrupted, must fail towards "no entitlement"; guessing `paid`
 * would hand out a pack on the strength of a typo.
 */
function paymentStatus(value: unknown): PaymentStatus {
  return PAYMENT_STATUSES.includes(value as PaymentStatus)
    ? (value as PaymentStatus)
    : "pending";
}

function generationStatus(value: unknown): GenerationStatus {
  return GENERATION_STATUSES.includes(value as GenerationStatus)
    ? (value as GenerationStatus)
    : "awaiting_generation";
}

const MONTHS = [
  "Januari",
  "Februari",
  "Mac",
  "April",
  "Mei",
  "Jun",
  "Julai",
  "Ogos",
  "September",
  "Oktober",
  "November",
  "Disember",
];

/**
 * The name a new pack starts with: "30 Hari Content — September 2026".
 *
 * Dated rather than numbered, because an owner with three packs recognises the
 * month they bought far faster than "Pack 2". Never an order id or a bill id:
 * those are our bookkeeping, they mean nothing to the person reading the list,
 * and they do not belong on a screen. The owner can rename it.
 */
export function monthlyPackName(
  createdAt: string,
  days = 30,
  now: Date = new Date(),
): string {
  const at = new Date(createdAt);
  const when = Number.isNaN(at.getTime()) ? now : at;
  return `${days} Hari Content — ${MONTHS[when.getUTCMonth()]} ${when.getUTCFullYear()}`;
}

/* --- encoding ------------------------------------------------------------- */

/**
 * The document the server writes when a payment is confirmed.
 *
 * Paid and empty. No plan, because nothing has been written yet, and no
 * generation has been attempted — the entitlement is the thing being recorded,
 * and it is recorded before any AI call so a crash during writing cannot lose
 * a purchase.
 */
export function encodePaidPack(input: {
  packId: string;
  ownerId: string;
  orderId: string;
  days: number;
  now: string;
  paidAt: string;
  name?: string;
}): PackDoc {
  return {
    ownerId: input.ownerId,
    packId: input.packId,
    orderId: input.orderId,
    source: "purchase",
    packName: input.name?.trim() || monthlyPackName(input.now, input.days),
    paymentStatus: "paid",
    generationStatus: "awaiting_generation",
    days: input.days,
    createdAt: input.now,
    updatedAt: input.now,
    paidAt: input.paidAt,
  };
}

/**
 * The grandfathered pack: content the owner already had before packs existed.
 *
 * Marked `paid` because they are entitled to it — they had it — and `legacy`
 * so nothing goes looking for a purchase that was never made. The plan is
 * carried across unchanged; `createdAt` keeps the original generation time
 * rather than the migration's, so the owner's history stays true.
 */
export function encodeLegacyPack(input: {
  packId: string;
  ownerId: string;
  plan: ContentPlan;
  now: string;
  name?: string;
}): PackDoc {
  const plan = encodePlan(input.plan, input.ownerId, input.now);
  const createdAt = input.plan.createdAt || input.now;
  return {
    ...plan,
    ownerId: input.ownerId,
    packId: input.packId,
    orderId: null,
    source: "legacy",
    packName:
      input.name?.trim() ||
      input.plan.packName?.trim() ||
      monthlyPackName(createdAt, input.plan.items.length),
    paymentStatus: "paid",
    generationStatus: input.plan.items.length > 0 ? "ready" : "awaiting_generation",
    days: input.plan.items.length,
    createdAt,
    updatedAt: input.now,
    paidAt: null,
  };
}

/**
 * The plan half of the document, for the owner's client to write after a run.
 *
 * Only the content fields and the generation status: nothing here can change
 * who owns the pack, whether it was paid for, or which order bought it. The
 * rules enforce that too — this shape is what makes it easy to obey.
 *
 * `packName` is dropped rather than written. It is the owner's label, edited
 * on its own screen at its own time, and a generation run has no business
 * carrying whatever name the browser happened to be holding back over it.
 */
export function encodePackPlan(
  plan: ContentPlan,
  ownerId: string,
  status: GenerationStatus,
  now = new Date().toISOString(),
): Omit<ContentPlanDoc, "packName"> & {
  generationStatus: GenerationStatus;
  updatedAt: string;
} {
  const { packName, ...content } = encodePlan(plan, ownerId, now);
  // Read once and discarded, so the compiler and the reader both see that the
  // omission is deliberate rather than an oversight.
  void packName;
  return { ...content, generationStatus: status, updatedAt: now };
}

/* --- decoding ------------------------------------------------------------- */

/**
 * A stored pack, or `null` if the document is not one.
 *
 * The plan is decoded by the same `decodePlan` the pre-M5 model uses, which
 * returns `null` for a document with no days — exactly the right answer for a
 * pack that has been paid for and not yet written.
 */
export function decodePack(data: unknown, uid: string, packId: string): Pack | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  // The uid is in the document path, so a mismatch means something is wrong
  // with our own writes rather than with the reader. Refuse it either way.
  const ownerId = str(d.ownerId);
  if (ownerId && ownerId !== uid) return null;

  const now = new Date().toISOString();
  const plan = decodePlan(d, uid);

  return {
    id: str(d.packId, packId),
    ownerId: uid,
    orderId: str(d.orderId) || null,
    source: d.source === "legacy" ? "legacy" : "purchase",
    name: str(d.packName),
    paymentStatus: paymentStatus(d.paymentStatus),
    generationStatus: generationStatus(d.generationStatus),
    days: typeof d.days === "number" && d.days > 0 ? d.days : (plan?.items.length ?? 0),
    plan,
    createdAt: str(d.createdAt, now),
    updatedAt: str(d.updatedAt, now),
    paidAt: str(d.paidAt) || null,
  };
}

/** A pack reduced to what the list screen shows. */
export function packSummary(pack: Pack): PackSummary {
  return {
    id: pack.id,
    name: pack.name || monthlyPackName(pack.createdAt, pack.days),
    source: pack.source,
    paymentStatus: pack.paymentStatus,
    generationStatus: pack.generationStatus,
    days: pack.days,
    written: pack.plan?.items.length ?? 0,
    createdAt: pack.createdAt,
  };
}

/** Newest first — the pack an owner just bought is the one they want. */
export function sortPacks(packs: PackSummary[]): PackSummary[] {
  return [...packs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
