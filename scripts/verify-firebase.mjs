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
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";

import { encodePlan, encodeRestaurant, encodeUser } from "../lib/firebase/codecs.ts";
import { DEMO_RESTAURANT } from "../lib/content/demo.ts";
import { objectName, storagePath } from "../lib/firebase/upload-rules.ts";
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
const skipped = [];

/**
 * Runs a check only when the feature it needs is actually provisioned.
 *
 * A Storage check against a project with no bucket fails with an opaque
 * `storage/unknown`, which reads exactly like a broken rule. Skipping loudly
 * says the true thing — the rules were never exercised — instead of printing
 * thirteen security failures with one cause.
 */
async function check_if(condition, name, fn) {
  if (!condition) {
    skipped.push(name);
    console.log(`  SKIP ${name}`);
    return;
  }
  return check(name, fn);
}

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

/**
 * Asserts Storage refused an operation.
 *
 * Storage reports every refusal as `storage/unauthorized` whether the rule that
 * stopped it was the owner check, the content type or the size limit, so the
 * code is all there is to assert on.
 */
async function deniedStorage(label, operation) {
  try {
    await operation();
  } catch (error) {
    if (error.code === "storage/unauthorized") return;
    throw new Error(`${label} failed with ${error.code ?? error.message}, expected storage/unauthorized`);
  }
  throw new Error(`${label} was ALLOWED — the storage rules do not protect this`);
}

const app = initializeApp(CONFIG, `verify-${randomUUID()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const PNG = { contentType: "image/png" };
const PDF = { contentType: "application/pdf" };
const bytes = (n) => new Uint8Array(n);

/** Storage objects to remove at the end, whoever created them. */
const uploaded = [];

/**
 * Whether Cloud Storage is provisioned at all.
 *
 * Enabling Storage is a one-off console step and creates the bucket; until it
 * happens there is nothing for `storage.rules` to protect and every upload
 * fails for that reason rather than a security one.
 */
const storageReady = await fetch(
  `https://firebasestorage.googleapis.com/v0/b/${CONFIG.storageBucket}/o`,
)
  .then((r) => r.status !== 404)
  .catch(() => false);

if (!storageReady) {
  console.log(
    `BLOCKER: Cloud Storage is not enabled for ${CONFIG.projectId}.\n` +
      `         Bucket ${CONFIG.storageBucket} does not exist, so logo and menu\n` +
      `         uploads cannot work and storage.rules has never been enforced.\n` +
      `         Enable Storage in the Firebase console, then run:\n` +
      `           firebase deploy --only storage --project ${CONFIG.projectId}\n`,
  );
}
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
  await check_if(storageReady, "cannot read a stored logo", () =>
    deniedStorage("read restaurants/x/logo", () =>
      getDownloadURL(storageRef(storage, "restaurants/any-uid/logo/a.png")),
    ),
  );
  await check_if(storageReady, "cannot upload a file", () =>
    deniedStorage("write restaurants/x/logo", () =>
      uploadBytes(storageRef(storage, "restaurants/any-uid/logo/a.png"), bytes(8), PNG),
    ),
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

  await check("every launch field survives Firestore", async () => {
    const data = (await getDoc(doc(db, "restaurants", uidA))).data();
    const expected = {
      menuNotes: DEMO_RESTAURANT.menuNotes,
      visualStyle: DEMO_RESTAURANT.visualStyle,
      contentLanguage: DEMO_RESTAURANT.language,
      currentPromotions: DEMO_RESTAURANT.promotion,
      promotionConditions: DEMO_RESTAURANT.promotionConditions,
    };
    for (const [field, value] of Object.entries(expected)) {
      if (JSON.stringify(data[field]) !== JSON.stringify(value)) {
        throw new Error(`${field} came back as ${JSON.stringify(data[field])}`);
      }
    }
    if (JSON.stringify(data.platforms) !== JSON.stringify(DEMO_RESTAURANT.platforms)) {
      throw new Error("platforms did not survive");
    }
    if (JSON.stringify(data.copyStyles) !== JSON.stringify(DEMO_RESTAURANT.copyStyles)) {
      throw new Error("copyStyles did not survive");
    }
  });

  /* --- 2b. Uploaded files land in the owner's own folder ------------------- */
  console.log("\nOwner A, uploaded files");
  const logoPath = storagePath(uidA, "logo", objectName("logo.png"));
  const menuPath = storagePath(uidA, "menu", objectName("menu.pdf"));

  await check_if(storageReady, "can upload a logo to their own folder", async () => {
    await uploadBytes(storageRef(storage, logoPath), bytes(2048), PNG);
    uploaded.push(logoPath);
  });
  await check_if(storageReady, "can upload a menu PDF to their own folder", async () => {
    await uploadBytes(storageRef(storage, menuPath), bytes(4096), PDF);
    uploaded.push(menuPath);
  });
  await check_if(storageReady, "can read back their own logo", async () => {
    const url = await getDownloadURL(storageRef(storage, logoPath));
    if (!url.startsWith("https://")) throw new Error("no download URL");
  });
  await check_if(storageReady, "a PDF is refused as a logo", () =>
    deniedStorage("logo as PDF", () =>
      uploadBytes(storageRef(storage, storagePath(uidA, "logo", "x.pdf")), bytes(64), PDF),
    ),
  );
  await check_if(storageReady, "a logo over 2MB is refused", () =>
    deniedStorage("oversized logo", () =>
      uploadBytes(
        storageRef(storage, storagePath(uidA, "logo", "big.png")),
        bytes(2 * 1024 * 1024 + 1),
        PNG,
      ),
    ),
  );
  await check_if(storageReady, "an empty file is refused", () =>
    deniedStorage("empty logo", () =>
      uploadBytes(storageRef(storage, storagePath(uidA, "logo", "empty.png")), bytes(0), PNG),
    ),
  );
  await check_if(storageReady, "cannot upload into another owner's folder", () =>
    deniedStorage("write other folder", () =>
      uploadBytes(
        storageRef(storage, storagePath("some-other-uid", "logo", "a.png")),
        bytes(64),
        PNG,
      ),
    ),
  );
  await check_if(storageReady, "cannot upload outside the restaurants tree", () =>
    deniedStorage("write /public", () =>
      uploadBytes(storageRef(storage, "public/anything.png"), bytes(64), PNG),
    ),
  );

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

  await check_if(storageReady, "cannot read A's uploaded logo", () =>
    deniedStorage("read A logo", () => getDownloadURL(storageRef(storage, logoPath))),
  );
  await check_if(storageReady, "cannot overwrite A's uploaded logo", () =>
    deniedStorage("overwrite A logo", () =>
      uploadBytes(storageRef(storage, logoPath), bytes(64), PNG),
    ),
  );
  await check_if(storageReady, "cannot delete A's uploaded menu", () =>
    deniedStorage("delete A menu", () => deleteObject(storageRef(storage, menuPath))),
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

  // Uploaded objects are removed as their owner: the rules allow an owner to
  // delete their own files, and the CLI has no equivalent one-liner for Storage.
  if (uploaded.length > 0) {
    try {
      await signOut(auth);
      await signInWithEmailAndPassword(auth, accountA.email, accountA.password);
      for (const path of uploaded) {
        await deleteObject(storageRef(storage, path)).catch(() => {});
      }
      console.log(`  removed ${uploaded.length} uploaded file(s)`);
    } catch (error) {
      console.log(`  could not remove uploaded files: ${error.code ?? error.message}`);
    }
  }

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
  // CLI as the project owner instead. FIREBASE_CLI_ACCOUNT picks which logged-in
  // account to use; without it the CLI falls back to its own active account.
  const account = process.env.FIREBASE_CLI_ACCOUNT?.trim();
  let removed = 0;
  let left = 0;
  for (const uid of created) {
    for (const collection of ["users", "restaurants", "contentPlans"]) {
      try {
        await run("firebase", [
          "firestore:delete", `${collection}/${uid}`,
          "--project", CONFIG.projectId,
          ...(account ? ["--account", account] : []),
          "--force",
        ]);
        removed += 1;
      } catch (error) {
        left += 1;
        console.log(`  could not remove ${collection}/${uid}: ${(error.stderr || error.message || "").trim().split("\n")[0]}`);
      }
    }
  }
  // Counting attempts rather than successes would report a clean project while
  // leaving test data in it.
  console.log(`  removed ${removed} test document(s)`);
  if (left > 0) {
    console.log(
      `  ${left} test document(s) LEFT BEHIND. The Firebase CLI could not authenticate;\n` +
        `  run 'firebase login --reauth' and delete them, or remove them in the console.`,
    );
  }

  await deleteApp(app);
}

console.log(
  `\n${passed} passed, ${failures.length} failed, ${skipped.length} skipped`,
);
for (const name of failures) console.log(`  FAIL ${name}`);
if (skipped.length > 0) {
  console.log(
    `\n${skipped.length} check(s) were SKIPPED because Cloud Storage is not enabled.\n` +
      `Uploads and storage.rules remain unverified against the real project.`,
  );
}
// A skipped security check is not a passing one. The run stays red until the
// bucket exists and the rules have actually refused something.
if (failures.length > 0 || skipped.length > 0) process.exit(1);
