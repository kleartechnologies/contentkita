import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

import { getFirebaseConfig } from "./config";

/**
 * Lazy singletons for the Firebase Web SDK.
 *
 * Initialisation is deferred until something actually needs Firebase, so that
 * importing a module in a server render or a unit test does not require the
 * environment to be configured. `getApps()` is checked because Next's dev
 * server re-evaluates modules on hot reload.
 */

export function firebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  return initializeApp(getFirebaseConfig());
}

let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

export function firebaseAuth(): Auth {
  authInstance ??= getAuth(firebaseApp());
  return authInstance;
}

export function firebaseDb(): Firestore {
  dbInstance ??= getFirestore(firebaseApp());
  return dbInstance;
}
