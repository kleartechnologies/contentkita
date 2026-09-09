import type { ContentPlan } from "../content/types.ts";
import type { PaymentStatus } from "../payment/orders.ts";

/**
 * A pack: one purchase, one month of content, owned forever.
 *
 * The unit the product actually sells. Buying again produces a second pack
 * beside the first rather than replacing it, which is why a pack has an id at
 * all — the pre-M5 model stored exactly one plan per owner at
 * `contentPlans/{uid}`, and that path has no room for a second month.
 */

/**
 * How far the writing has got.
 *
 * Kept strictly apart from `paymentStatus`. Money and content fail for
 * different reasons and must be recoverable separately: a generation that dies
 * at day nineteen leaves a paid customer who can press the button again, not a
 * customer who has to pay again.
 */
export type GenerationStatus =
  /** Paid for, nothing written yet. */
  | "awaiting_generation"
  /** A run is in progress. */
  | "generating"
  /** Every day written. */
  | "ready"
  /** Some days written, some missing. Resumable. */
  | "partial"
  /** A run ended with nothing usable. Retryable, at no further cost. */
  | "failed";

/**
 * Where a pack came from.
 *
 * `legacy` is the month an owner already had before payment existed. It is
 * grandfathered — never charged for, never deleted, and marked so that no
 * later code mistakes it for a purchase and goes looking for the order.
 */
export type PackSource = "purchase" | "legacy";

export interface Pack {
  readonly id: string;
  readonly ownerId: string;
  /** The purchase that created this pack. `null` for the grandfathered one. */
  readonly orderId: string | null;
  readonly source: PackSource;
  /** The owner's own label. Never a payment id, never a bill id. */
  readonly name: string;
  readonly paymentStatus: PaymentStatus;
  readonly generationStatus: GenerationStatus;
  /** How many days this pack is entitled to. Set at purchase. */
  readonly days: number;
  /** The written month, or `null` while it is still awaiting generation. */
  readonly plan: ContentPlan | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly paidAt: string | null;
}

/** A pack row for the list screen, without dragging thirty days along with it. */
export interface PackSummary {
  readonly id: string;
  readonly name: string;
  readonly source: PackSource;
  readonly paymentStatus: PaymentStatus;
  readonly generationStatus: GenerationStatus;
  readonly days: number;
  /** Days actually written. Zero until generation runs. */
  readonly written: number;
  readonly createdAt: string;
}

/** Whether this pack may be generated into — paid for, and not already done. */
export function canGenerate(pack: Pack): boolean {
  return (
    pack.paymentStatus === "paid" &&
    pack.generationStatus !== "ready" &&
    pack.generationStatus !== "generating"
  );
}

/** Whether the owner can open and use this pack's content. */
export function isUsable(pack: Pack): boolean {
  return pack.paymentStatus === "paid" && pack.plan !== null;
}
