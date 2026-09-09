import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import type { ContentItem, ContentPlan, RestaurantProfile } from "@/lib/content";
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
