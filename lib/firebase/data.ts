import { doc, getDoc, setDoc } from "firebase/firestore";

import type { RestaurantProfile } from "@/lib/content";
import { firebaseDb } from "./client";
import { decodeRestaurant, encodeRestaurant, encodeUser } from "./codecs";

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

/*
 * The plan and its designs used to be written here, to `contentPlans/{uid}`.
 *
 * They are not any more. Since M5 content belongs to the pack it was bought
 * with, so it is written by `lib/firebase/packs.ts` at
 * `contentPacks/{uid}/packs/{packId}`, and `contentPlans/{uid}` is frozen by the
 * security rules: readable, never written again. A grandfathered month is
 * copied into a pack by the migration, which reads it on the server.
 *
 * Nothing was left behind here on purpose. A function that still pointed at the
 * old path would compile, pass review, and fail with permission-denied in front
 * of an owner.
 */
