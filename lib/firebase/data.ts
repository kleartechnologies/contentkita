import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

import type { ContentItem, ContentPlan, RestaurantProfile } from "@/lib/content";
import { decodeCreative, encodeCreative, type Creative } from "@/lib/creative";
import { firebaseDb } from "./client";
import {
  decodePlan,
  decodeRestaurant,
  encodeItem,
  encodePlan,
  encodeRestaurant,
  encodeUser,
} from "./codecs";

/**
 * Every read and write the product performs against Firestore.
 *
 * The data model is intentionally flat: one document per collection per owner,
 * keyed by the Firebase Auth uid. That makes the document path itself the
 * ownership boundary, which is what the security rules check — there is no
 * query whose results depend on a client-supplied owner field.
 */

export const COLLECTIONS = {
  users: "users",
  restaurants: "restaurants",
  contentPlans: "contentPlans",
  /**
   * A subcollection of `contentPlans/{uid}`, one document per content day.
   *
   * Not a top-level collection: hanging it under the owner's plan keeps the
   * uid in the path, which is the whole basis of the security model above. It
   * is also why creatives are not simply another field on the plan document —
   * thirty layouts of a dozen elements each would push one document towards
   * Firestore's 1MB limit, and editing one day would rewrite the other
   * twenty-nine.
   */
  creatives: "creatives",
} as const;

/**
 * Records who the owner is on first sign-in, and keeps `updatedAt` current
 * afterwards. Merged rather than overwritten so a later sign-in never resets
 * `createdAt`.
 */
export async function ensureUserDoc(
  uid: string,
  email: string,
  displayName?: string | null,
): Promise<void> {
  const ref = doc(firebaseDb(), COLLECTIONS.users, uid);
  const existing = await getDoc(ref);
  const createdAt = existing.exists()
    ? (existing.data().createdAt as string | undefined)
    : undefined;
  await setDoc(ref, encodeUser({ email, displayName, createdAt }), { merge: true });
}

export async function loadRestaurant(
  uid: string,
): Promise<RestaurantProfile | null> {
  const snap = await getDoc(doc(firebaseDb(), COLLECTIONS.restaurants, uid));
  return snap.exists() ? decodeRestaurant(snap.data(), uid) : null;
}

export async function saveRestaurant(
  uid: string,
  profile: RestaurantProfile,
): Promise<void> {
  await setDoc(
    doc(firebaseDb(), COLLECTIONS.restaurants, uid),
    encodeRestaurant(profile, uid),
  );
}

export async function loadPlan(uid: string): Promise<ContentPlan | null> {
  const snap = await getDoc(doc(firebaseDb(), COLLECTIONS.contentPlans, uid));
  return snap.exists() ? decodePlan(snap.data(), uid) : null;
}

export async function savePlan(uid: string, plan: ContentPlan): Promise<void> {
  await setDoc(
    doc(firebaseDb(), COLLECTIONS.contentPlans, uid),
    encodePlan(plan, uid),
  );
}

/**
 * Renames the owner's pack, and touches nothing else.
 *
 * An `updateDoc` of two fields rather than a `savePlan`: rewriting the whole
 * document to change a label would put thirty days back through the encoder for
 * no reason, and any day the owner had edited in another tab meanwhile would be
 * quietly reverted to what this browser happened to be holding.
 */
export async function savePackName(uid: string, name: string): Promise<void> {
  await updateDoc(doc(firebaseDb(), COLLECTIONS.contentPlans, uid), {
    packName: name,
    updatedAt: new Date().toISOString(),
  });
}

/* --------------------------------- creatives ------------------------------- */

function creativesRef(uid: string) {
  return collection(
    firebaseDb(),
    COLLECTIONS.contentPlans,
    uid,
    COLLECTIONS.creatives,
  );
}

/** The saved creative for one content day, or `null` if none was ever saved. */
export async function loadCreative(
  uid: string,
  itemId: string,
): Promise<Creative | null> {
  const snap = await getDoc(doc(creativesRef(uid), itemId));
  return snap.exists() ? decodeCreative(snap.data(), itemId) : null;
}

/** Every creative the owner has saved, oldest day first. */
export async function loadCreatives(uid: string): Promise<Creative[]> {
  const snap = await getDocs(creativesRef(uid));
  const out: Creative[] = [];
  for (const document of snap.docs) {
    const creative = decodeCreative(document.data(), document.id);
    // A single corrupt document does not hide the rest of the owner's work.
    if (creative) out.push(creative);
  }
  return out.sort((a, b) => a.day - b.day);
}

export async function saveCreative(
  uid: string,
  creative: Creative,
): Promise<void> {
  await setDoc(doc(creativesRef(uid), creative.id), encodeCreative(creative, uid));
}

/**
 * Persists a single regenerated day.
 *
 * The plan lives in one document, so the whole `items` array is written back —
 * but only the one day was regenerated. The other twenty-nine are passed
 * through byte-for-byte as they were loaded.
 */
export async function savePlanItem(
  uid: string,
  plan: ContentPlan,
  next: ContentItem,
): Promise<void> {
  const items = plan.items.map((item) =>
    item.day === next.day ? encodeItem(next) : encodeItem(item),
  );
  await updateDoc(doc(firebaseDb(), COLLECTIONS.contentPlans, uid), {
    items,
    updatedAt: new Date().toISOString(),
  });
}
