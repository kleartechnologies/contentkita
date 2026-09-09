import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import type { ContentItem, ContentPlan } from "@/lib/content";
import { decodeCreative, encodeCreative, type Creative } from "@/lib/creative";
import { decodePack, encodePackPlan } from "@/lib/packs/codecs";
import type { GenerationStatus, Pack } from "@/lib/packs/types";
import type { PaymentStatus } from "@/lib/payment/orders";
import { firebaseDb } from "./client";
import { encodeItem } from "./codecs";

/**
 * Reading and writing packs from the owner's own browser.
 *
 * The counterpart to `lib/firebase/data.ts`, and it works the same way: the
 * owner's uid is in every path, so the path itself is the authorisation and the
 * security rules have nothing to infer. What is different is that a pack has a
 * half the browser may not write. Payment fields are set by the server when a
 * verified callback arrives, and every function here writes around them —
 * content and the owner's own label, never `paymentStatus`, `paidAt`,
 * `orderId` or `ownerId`.
 *
 * That is a convention here and a rule in `firestore.rules`. The rule is what
 * enforces it; this file exists so honest code never has to fight it.
 */

const PACKS = "contentPacks";
const PACKS_SUB = "packs";
const CREATIVES = "creatives";
const ORDERS = "orders";

function packRef(uid: string, packId: string) {
  return doc(firebaseDb(), PACKS, uid, PACKS_SUB, packId);
}

function packsRef(uid: string) {
  return collection(firebaseDb(), PACKS, uid, PACKS_SUB);
}

function creativesRef(uid: string, packId: string) {
  return collection(firebaseDb(), PACKS, uid, PACKS_SUB, packId, CREATIVES);
}

/* --- packs ---------------------------------------------------------------- */

/**
 * Every pack this owner has, newest first.
 *
 * The whole document, days included, rather than a summary: a customer has as
 * many packs as they have made purchases, and fetching them once means opening
 * one costs nothing. A second query per pack would be slower and no smaller.
 */
export async function loadPacks(uid: string): Promise<Pack[]> {
  const snap = await getDocs(packsRef(uid));
  const packs: Pack[] = [];
  for (const document of snap.docs) {
    const pack = decodePack(document.data(), uid, document.id);
    // One unreadable pack does not hide the others.
    if (pack) packs.push(pack);
  }
  return packs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadPack(uid: string, packId: string): Promise<Pack | null> {
  const snap = await getDoc(packRef(uid, packId));
  return snap.exists() ? decodePack(snap.data(), uid, packId) : null;
}

/**
 * Writes a generated month into a pack the owner has already paid for.
 *
 * A merge, not a replace: the entitlement fields are already on the document
 * and this must not go near them. `encodePackPlan` carries only content and the
 * generation status, so there is nothing in the payload to go near them with.
 */
export async function savePackPlan(
  uid: string,
  packId: string,
  plan: ContentPlan,
  status: GenerationStatus,
): Promise<void> {
  await setDoc(packRef(uid, packId), encodePackPlan(plan, uid, status), {
    merge: true,
  });
}

/**
 * Persists a single regenerated day.
 *
 * The whole `items` array goes back because the plan is one document, but only
 * the one day differs; the other twenty-nine are written exactly as they were
 * loaded.
 */
export async function savePackItem(
  uid: string,
  packId: string,
  plan: ContentPlan,
  next: ContentItem,
): Promise<void> {
  await updateDoc(packRef(uid, packId), {
    items: plan.items.map((item) =>
      encodeItem(item.day === next.day ? next : item),
    ),
    updatedAt: new Date().toISOString(),
  });
}

/** Records how far a generation run got, without touching the content. */
export async function savePackStatus(
  uid: string,
  packId: string,
  status: GenerationStatus,
): Promise<void> {
  await updateDoc(packRef(uid, packId), {
    generationStatus: status,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Renames a pack, and touches nothing else.
 *
 * Two fields rather than a whole-document write: rewriting thirty days to
 * change a label would put the content back through the encoder for no reason,
 * and any day edited in another tab meanwhile would be quietly reverted.
 */
export async function savePackName(
  uid: string,
  packId: string,
  name: string,
): Promise<void> {
  await updateDoc(packRef(uid, packId), {
    packName: name,
    updatedAt: new Date().toISOString(),
  });
}

/* --- creatives ------------------------------------------------------------ */

export async function loadPackCreative(
  uid: string,
  packId: string,
  itemId: string,
): Promise<Creative | null> {
  const snap = await getDoc(doc(creativesRef(uid, packId), itemId));
  return snap.exists() ? decodeCreative(snap.data(), itemId) : null;
}

/** Every design saved against this pack, oldest day first. */
export async function loadPackCreatives(
  uid: string,
  packId: string,
): Promise<Creative[]> {
  const snap = await getDocs(creativesRef(uid, packId));
  const out: Creative[] = [];
  for (const document of snap.docs) {
    const creative = decodeCreative(document.data(), document.id);
    if (creative) out.push(creative);
  }
  return out.sort((a, b) => a.day - b.day);
}

export async function savePackCreative(
  uid: string,
  packId: string,
  creative: Creative,
): Promise<void> {
  await setDoc(
    doc(creativesRef(uid, packId), creative.id),
    encodeCreative(creative, uid),
  );
}

/* --- orders --------------------------------------------------------------- */

/**
 * The state of one of the owner's own orders.
 *
 * Read-only by the rules, and written only by the payment callback — which is
 * what makes it safe for the payment-result screen to believe. The screen knows
 * the order id from the redirect, but the *answer* comes from this document,
 * never from the URL that pointed at it.
 */
export interface OrderView {
  readonly orderId: string;
  readonly paymentStatus: PaymentStatus;
  readonly packId: string | null;
  readonly amountSen: number;
}

export async function loadOrder(orderId: string): Promise<OrderView | null> {
  const snap = await getDoc(doc(firebaseDb(), ORDERS, orderId));
  if (!snap.exists()) return null;
  const data = snap.data();
  const status = data.paymentStatus;
  return {
    orderId,
    paymentStatus:
      status === "paid" || status === "failed" || status === "cancelled"
        ? (status as PaymentStatus)
        : "pending",
    packId: typeof data.packId === "string" ? data.packId : null,
    amountSen: typeof data.amountSen === "number" ? data.amountSen : 0,
  };
}
