/**
 * Security and persistence verification against the real Firebase project.
 *
 * The Firebase Emulator Suite needs a JVM, which this machine does not have, so
 * the rules are verified where they actually run. Everything here talks to
 * Firestore as an ordinary signed-in client — exactly what a browser is — so a
 * pass means the deployed rules really do refuse the attempts below, not that a
 * mock said they would.
 *
 * Two throwaway accounts are created with random addresses and both they and
 * their documents are removed at the end.
 *
 *   node --env-file=.env.local scripts/verify-firebase.mjs
 */

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, getDoc, getFirestore, setDoc, updateDoc } from "firebase/firestore";

import { encodePlan, encodeRestaurant, encodeUser } from "../lib/firebase/codecs.ts";
import { DEMO_RESTAURANT } from "../lib/content/demo.ts";
import { MockContentGenerator } from "../lib/content/mock-generator.ts";

const run = promisify(execFile);

const CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

for (const [key, value] of Object.entries(CONFIG)) {
  if (!value) {
    console.error(`Missing Firebase config: ${key}. Run with --env-file=.env.local`);
    process.exit(1);
  }
}

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

/** Asserts an operation is refused by the security rules, not by anything else. */
async function denied(label, operation) {
  try {
    await operation();
  } catch (error) {
    if (error.code === "permission-denied") return;
    throw new Error(`${label} failed with ${error.code ?? error.message}, expected permission-denied`);
  }
  throw new Error(`${label} was ALLOWED — the rules do not protect this`);
}

const app = initializeApp(CONFIG, `verify-${randomUUID()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const generator = new MockContentGenerator();

const suffix = randomUUID().slice(0, 8);
const accountA = { email: `ck-verify-a-${suffix}@contentkita.test`, password: `A${suffix}!pass` };
const accountB = { email: `ck-verify-b-${suffix}@contentkita.test`, password: `B${suffix}!pass` };

const created = [];

async function signUp({ email, password }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  created.push(credential.user.uid);
  return credential.user.uid;
}

console.log(`\nProject: ${CONFIG.projectId}\n`);

try {
  /* --- 1. A signed-out browser can reach nothing --------------------------- */
  console.log("Unauthenticated access");
  await check("cannot read a restaurant", () =>
    denied("read restaurants/x", () => getDoc(doc(db, "restaurants", "any-uid"))),
  );
  await check("cannot read a content plan", () =>
    denied("read contentPlans/x", () => getDoc(doc(db, "contentPlans", "any-uid"))),
  );
  await check("cannot read a user record", () =>
    denied("read users/x", () => getDoc(doc(db, "users", "any-uid"))),
  );
  await check("cannot write a restaurant", () =>
    denied("write restaurants/x", () =>
      setDoc(doc(db, "restaurants", "any-uid"), { ownerId: "any-uid", restaurantName: "X" }),
    ),
  );
  await check("cannot write to an undeclared collection", () =>
    denied("write anything/x", () => setDoc(doc(db, "anything", "x"), { a: 1 })),
  );

  /* --- 2. An owner can save and read back their own data ------------------- */
  console.log("\nOwner A, own data");
  const uidA = await signUp(accountA);
  const plan = await generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-03-01",
  });

  await check("can create their user record", () =>
    setDoc(doc(db, "users", uidA), encodeUser({ email: accountA.email }), { merge: true }),
  );
  await check("can save their restaurant", () =>
    setDoc(doc(db, "restaurants", uidA), encodeRestaurant(DEMO_RESTAURANT, uidA)),
  );
  await check("can save their 30-day plan", () =>
    setDoc(doc(db, "contentPlans", uidA), encodePlan(plan, uidA)),
  );
  await check("reads back exactly what was saved", async () => {
    const snap = await getDoc(doc(db, "contentPlans", uidA));
    if (!snap.exists()) throw new Error("plan document missing");
    const items = snap.data().items;
    if (items.length !== 30) throw new Error(`expected 30 days, got ${items.length}`);
    if (snap.data().ownerId !== uidA) throw new Error("ownerId did not survive");
  });
  await check("regenerating one day rewrites only that day", async () => {
    const swapped = await generator.regenerateDay(
      { restaurant: DEMO_RESTAURANT, startDate: plan.startDate, variants: { 5: 1 } },
      5,
    );
    const before = (await getDoc(doc(db, "contentPlans", uidA))).data().items;
    const items = before.map((item) => (item.day === 5 ? { ...item, ...JSON.parse(JSON.stringify(swapped)) } : item));
    await updateDoc(doc(db, "contentPlans", uidA), { items, updatedAt: new Date().toISOString() });

    const after = (await getDoc(doc(db, "contentPlans", uidA))).data().items;
    if (after.length !== 30) throw new Error("day count changed");
    if (after[4].caption === before[4].caption) throw new Error("day 5 did not change");
    for (const item of before) {
      if (item.day === 5) continue;
      const match = after.find((i) => i.day === item.day);
      if (JSON.stringify(match) !== JSON.stringify(item)) {
        throw new Error(`day ${item.day} changed but should not have`);
      }
    }
  });

  /* --- 3. An owner cannot forge ownership ---------------------------------- */
  console.log("\nOwner A, forged ownership");
  await check("cannot claim a different owner on their own document", () =>
    denied("ownerId spoof", () =>
      setDoc(doc(db, "restaurants", uidA), {
        ...encodeRestaurant(DEMO_RESTAURANT, uidA),
        ownerId: "somebody-else",
      }),
    ),
  );
  await check("cannot write into another uid's document path", () =>
    denied("write restaurants/other", () =>
      setDoc(doc(db, "restaurants", "some-other-uid"), encodeRestaurant(DEMO_RESTAURANT, "some-other-uid")),
    ),
  );
  await check("cannot delete their own documents", () =>
    denied("delete restaurants/self", () =>
      import("firebase/firestore").then(({ deleteDoc }) => deleteDoc(doc(db, "restaurants", uidA))),
    ),
  );

  /* --- 4. One owner cannot reach another's data ---------------------------- */
  console.log("\nOwner B against owner A");
  await signOut(auth);
  const uidB = await signUp(accountB);
  if (uidB === uidA) throw new Error("test accounts collided");

  await check("cannot read A's restaurant", () =>
    denied("read A restaurant", () => getDoc(doc(db, "restaurants", uidA))),
  );
  await check("cannot read A's content plan", () =>
    denied("read A plan", () => getDoc(doc(db, "contentPlans", uidA))),
  );
  await check("cannot read A's user record", () =>
    denied("read A user", () => getDoc(doc(db, "users", uidA))),
  );
  await check("cannot overwrite A's restaurant", () =>
    denied("write A restaurant", () =>
      setDoc(doc(db, "restaurants", uidA), encodeRestaurant(DEMO_RESTAURANT, uidA)),
    ),
  );
  await check("cannot edit a day in A's plan", () =>
    denied("update A plan", () =>
      updateDoc(doc(db, "contentPlans", uidA), { updatedAt: new Date().toISOString() }),
    ),
  );

  /* --- 5. The session survives, the data survives with it ------------------ */
  console.log("\nPersistence across sessions");
  await signOut(auth);
  await check("signing out really ends access", () =>
    denied("read after sign-out", () => getDoc(doc(db, "restaurants", uidA))),
  );
  await check("A signs back in and finds their plan intact", async () => {
    await signInWithEmailAndPassword(auth, accountA.email, accountA.password);
    const snap = await getDoc(doc(db, "contentPlans", uidA));
    if (!snap.exists()) throw new Error("plan did not survive the session");
    if (snap.data().items.length !== 30) throw new Error("plan came back incomplete");
    const restaurant = await getDoc(doc(db, "restaurants", uidA));
    if (restaurant.data().restaurantName !== DEMO_RESTAURANT.name) {
      throw new Error("restaurant did not survive the session");
    }
  });
  await check("a wrong password is refused", async () => {
    await signOut(auth);
    try {
      await signInWithEmailAndPassword(auth, accountA.email, "not-the-password");
    } catch (error) {
      if (String(error.code).startsWith("auth/")) return;
      throw error;
    }
    throw new Error("a wrong password was ACCEPTED");
  });
} finally {
  /* --- Clean up ------------------------------------------------------------ */
  console.log("\nCleanup");
  const { deleteUser } = await import("firebase/auth");
  for (const account of [accountA, accountB]) {
    try {
      await signOut(auth);
      const credential = await signInWithEmailAndPassword(auth, account.email, account.password);
      await deleteUser(credential.user);
      console.log(`  removed account ${account.email}`);
    } catch (error) {
      console.log(`  could not remove ${account.email}: ${error.code ?? error.message}`);
    }
  }

  // The rules forbid clients deleting documents, so the leftovers go through the
  // CLI as the project owner instead.
  for (const uid of created) {
    for (const collection of ["users", "restaurants", "contentPlans"]) {
      try {
        await run("firebase", [
          "firestore:delete", `${collection}/${uid}`,
          "--project", CONFIG.projectId,
          "--account", process.env.FIREBASE_CLI_ACCOUNT ?? "",
          "--force",
        ].filter(Boolean));
      } catch {
        console.log(`  could not remove ${collection}/${uid}`);
      }
    }
  }
  console.log(`  removed ${created.length} test document set(s)`);

  await deleteApp(app);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
