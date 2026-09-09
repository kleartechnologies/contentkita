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
 *   node --conditions=react-server --env-file=.env.local scripts/verify-firebase.mjs
 */

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";

import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
} from "firebase/firestore";
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
import { composeCreative } from "../lib/creative/compose.ts";
import { decodeCreative, editText, encodeCreative, setImage } from "../lib/creative/codec.ts";
import {
  assignPhotos,
  composePackDay,
  defaultPackName,
  missingItems,
  packStatus,
  photoPool,
  runPack,
} from "../lib/creative/pack.ts";
import { allowedAssetUrl } from "../lib/creative/asset-url.ts";
import { encodePackPlan, encodePaidPack } from "../lib/packs/codecs.ts";
import { newOrder } from "../lib/payment/orders.ts";
import { PACK_DAYS } from "../lib/payment/product.ts";
import { accessToken, serviceAccount } from "../lib/server/google-token.ts";
import { commit } from "../lib/server/firestore.ts";
import {
  fulfil,
  LEGACY_PACK_ID,
  migrateLegacy,
  putOrder,
  readOrder,
} from "../lib/server/store.ts";

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
 * Firestore documents an owner is allowed to delete themselves.
 *
 * Creatives are the only collection the rules let a client remove, so they are
 * cleaned up as their owner rather than through the CLI — which cannot reach a
 * subcollection with the plain `firestore:delete` used below.
 */
const ownerDeletable = [];

/**
 * Documents only the server may remove: orders, and packs.
 *
 * The rules deny every client delete on both, which is the point of them, so
 * the cleanup for these goes through the service account instead of pretending
 * a browser could tidy up after itself.
 */
const serverDeletable = [];

async function serverDelete(path) {
  const { projectId } = serviceAccount();
  const token = await accessToken();
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`delete ${path} returned ${response.status}`);
  }
}

/**
 * A purchase, made the way production makes one.
 *
 * Not a shortcut past the payment code: this is `putOrder` and `fulfil` from
 * `lib/server/store.ts` — the same functions the verified Billplz callback
 * calls, authenticated as the same service account — writing to the same real
 * project. What follows then attacks the result as an ordinary browser.
 */
async function buy(uid) {
  const now = new Date().toISOString();
  const order = newOrder(uid, now);
  await putOrder(order);
  serverDeletable.push(`orders/${order.orderId}`);
  const stored = await readOrder(order.orderId);
  const result = await fulfil(stored, { paidAt: now, transactionId: "VERIFY" }, now);
  if (result.kind !== "created") throw new Error(`fulfilment said ${result.kind}`);
  serverDeletable.push(`contentPacks/${uid}/packs/${order.packId}`);
  return order;
}

/**
 * A pre-payment month, planted the only way one can exist now.
 *
 * Since M5 the rules freeze `contentPlans/{uid}`: no client may write it, so a
 * grandfathered owner's month can only be put in place as the server. That is
 * exactly how it got there in the real project — written before the freeze —
 * and the migration section further down carries this one forward.
 */
async function plantLegacyPlan(uid, plan) {
  await commit([{ path: `contentPlans/${uid}`, data: encodePlan(plan, uid) }]);
}

/** An order raised and never paid — what an abandoned checkout leaves behind. */
async function unpaidOrder(uid) {
  const order = newOrder(uid, new Date().toISOString());
  await putOrder(order);
  serverDeletable.push(`orders/${order.orderId}`);
  return order;
}

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
  // The pre-payment plan document is frozen. Nothing writes it any more — a
  // month now lives in a pack somebody paid for — so the owner's own attempt
  // to write it is a denial check, and the grandfathered month the migration
  // section needs is planted as the server instead.
  await check("cannot write the pre-payment plan any more", () =>
    denied("write frozen plan", () =>
      setDoc(doc(db, "contentPlans", uidA), encodePlan(plan, uidA)),
    ),
  );
  await check("a grandfathered 30-day plan reads back exactly as it was left", async () => {
    await plantLegacyPlan(uidA, plan);
    const snap = await getDoc(doc(db, "contentPlans", uidA));
    if (!snap.exists()) throw new Error("plan document missing");
    const items = snap.data().items;
    if (items.length !== 30) throw new Error(`expected 30 days, got ${items.length}`);
    if (snap.data().ownerId !== uidA) throw new Error("ownerId did not survive");
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

  /* --- 2c. A content day becomes a creative, and stays one ---------------- */
  console.log("\nOwner A, creatives");

  // Snapshotted here, after the regeneration check above, so the last check in
  // this run can prove the creative work left the plan exactly as it found it.
  const planBefore = JSON.stringify((await getDoc(doc(db, "contentPlans", uidA))).data());

  const photoA = storagePath(uidA, "creative", objectName("ayam.png"));
  const photoB = storagePath(uidA, "creative", objectName("mee.png"));

  // Uploaded here rather than further down, because the design this section
  // works on has to be one with a photo slot in it — and whether a day gets a
  // photo slot depends on whether the restaurant has any photographs at all.
  // A restaurant with none is composed into typographic layouts on purpose,
  // so a fixture with no photos would have nowhere to put one.
  await check_if(storageReady, "can upload a creative photo to their own folder", async () => {
    await uploadBytes(storageRef(storage, photoA), bytes(4096), PNG);
    uploaded.push(photoA);
  });

  const photoRefA = storageReady
    ? {
        path: photoA,
        url: await getDownloadURL(storageRef(storage, photoA)),
        name: "ayam.png",
        contentType: "image/png",
        size: 4096,
        uploadedAt: new Date().toISOString(),
      }
    : null;
  const restaurant = photoRefA
    ? { ...DEMO_RESTAURANT, photos: [photoRefA] }
    : DEMO_RESTAURANT;

  // The first day that actually has somewhere to put a picture. Which days
  // those are is the creative engine's decision, not this script's, so it is
  // asked rather than assumed.
  const day =
    plan.items.find((item) =>
      composeCreative(restaurant, plan.id, item, {
        images: photoRefA ? [photoRefA] : [],
      }).elements.some((el) => el.kind === "image"),
    ) ?? plan.items[0];
  const composed = composeCreative(restaurant, plan.id, day, {
    images: photoRefA ? [photoRefA] : [],
  });
  const creativeRef = doc(db, "contentPlans", uidA, "creatives", composed.id);
  const creativePath = `contentPlans/${uidA}/creatives/${composed.id}`;
  let stored = composed;

  await check("can save a creative under their own plan", async () => {
    await setDoc(creativeRef, encodeCreative(composed, uidA));
    ownerDeletable.push(creativePath);
  });
  await check("reads the creative back as the same design", async () => {
    const snap = await getDoc(creativeRef);
    if (!snap.exists()) throw new Error("creative document missing");
    const back = decodeCreative(snap.data(), composed.itemId);
    if (!back) throw new Error("saved creative did not decode");
    // Compared structurally, not as text: a Firestore document is an unordered
    // map, so the order its keys come back in is not part of the design.
    if (!isDeepStrictEqual(back.elements, composed.elements)) {
      throw new Error("the elements changed on the way through Firestore");
    }
    if (back.canvas.width !== composed.canvas.width) throw new Error("canvas changed");
  });
  await check("can list their own creatives", async () => {
    const snap = await getDocs(collection(db, "contentPlans", uidA, "creatives"));
    if (snap.empty) throw new Error("listing returned nothing");
  });

  // The property that makes the whole model worth having: after a round trip
  // the headline is still a string somebody can edit, not pixels.
  await check("an edited headline is stored as editable text", async () => {
    stored = editText(stored, "headline", "Nasi Ayam Penyet panas hari ini");
    await setDoc(creativeRef, encodeCreative(stored, uidA));
    const back = decodeCreative((await getDoc(creativeRef)).data(), composed.itemId);
    const headline = back?.elements.find((el) => el.id === "headline");
    if (headline?.text !== "Nasi Ayam Penyet panas hari ini") {
      throw new Error(`headline came back as ${JSON.stringify(headline?.text)}`);
    }
    if (back?.edited !== true) throw new Error("the edit was not recorded");
  });

  await check("cannot forge the owner of a creative", () =>
    denied("creative ownerId spoof", () =>
      setDoc(creativeRef, { ...encodeCreative(stored, uidA), ownerId: "somebody-else" }),
    ),
  );
  await check("cannot save a creative into another owner's plan", () =>
    denied("write other creative", () =>
      setDoc(
        doc(db, "contentPlans", "some-other-uid", "creatives", composed.id),
        encodeCreative(stored, "some-other-uid"),
      ),
    ),
  );

  /* --- 2d. Photographs dropped into a creative ---------------------------- */
  await check_if(storageReady, "a PDF is refused as a creative photo", () =>
    deniedStorage("creative as PDF", () =>
      uploadBytes(storageRef(storage, storagePath(uidA, "creative", "x.pdf")), bytes(64), PDF),
    ),
  );
  await check_if(storageReady, "a creative photo over 5MB is refused", () =>
    deniedStorage("oversized creative photo", () =>
      uploadBytes(
        storageRef(storage, storagePath(uidA, "creative", "big.png")),
        bytes(5 * 1024 * 1024 + 1),
        PNG,
      ),
    ),
  );
  await check_if(storageReady, "cannot upload a creative photo into another owner's folder", () =>
    deniedStorage("write other creative folder", () =>
      uploadBytes(
        storageRef(storage, storagePath("some-other-uid", "creative", "a.png")),
        bytes(64),
        PNG,
      ),
    ),
  );

  await check_if(storageReady, "a photo dropped into the slot is what comes back", async () => {
    const slot = stored.elements.find((el) => el.kind === "image");
    if (!slot) throw new Error("no day in this plan composed to a design with a photo slot");
    stored = setImage(stored, slot.id, photoRefA);
    await setDoc(creativeRef, encodeCreative(stored, uidA));

    const back = decodeCreative((await getDoc(creativeRef)).data(), composed.itemId);
    const saved = back?.elements.find((el) => el.kind === "image");
    if (saved?.source?.path !== photoA) throw new Error("the photo did not persist");
  });

  await check_if(storageReady, "replacing the photo replaces the one before it", async () => {
    await uploadBytes(storageRef(storage, photoB), bytes(4096), PNG);
    uploaded.push(photoB);
    const url = await getDownloadURL(storageRef(storage, photoB));
    const slot = stored.elements.find((el) => el.kind === "image");
    stored = setImage(stored, slot.id, {
      path: photoB,
      url,
      name: "mee.png",
      contentType: "image/png",
      size: 4096,
      uploadedAt: new Date().toISOString(),
    });
    await setDoc(creativeRef, encodeCreative(stored, uidA));

    const back = decodeCreative((await getDoc(creativeRef)).data(), composed.itemId);
    const saved = back?.elements.find((el) => el.kind === "image");
    if (saved?.source?.path !== photoB) throw new Error("the replacement did not persist");
  });

  // Clearing has to give the empty slot back. Coming back with the picture the
  // owner just removed is the failure that would matter here.
  await check_if(storageReady, "clearing the photo leaves an empty slot behind", async () => {
    const slot = stored.elements.find((el) => el.kind === "image");
    const cleared = setImage(stored, slot.id, null);
    await setDoc(creativeRef, encodeCreative(cleared, uidA));

    const back = decodeCreative((await getDoc(creativeRef)).data(), composed.itemId);
    const saved = back?.elements.find((el) => el.kind === "image");
    if (saved?.source !== null) throw new Error("the cleared photo came back");

    // Put the replacement back, so the persistence checks below have one.
    await setDoc(creativeRef, encodeCreative(stored, uidA));
  });

  await check_if(storageReady, "a creative can point at the owner's logo", async () => {
    const url = await getDownloadURL(storageRef(storage, logoPath));
    const withLogo = composeCreative(
      { ...DEMO_RESTAURANT, logo: { path: logoPath, url, name: "logo.png", contentType: "image/png", size: 2048, uploadedAt: new Date().toISOString() } },
      plan.id,
      day,
    );
    const logo = withLogo.elements.find((el) => el.kind === "logo");
    if (logo?.source?.path !== logoPath) throw new Error("the logo was not placed");
  });

  /**
   * The proxy exists so an export is not blocked by canvas tainting. What a
   * unit test cannot prove is that the URLs Firebase actually hands out are
   * the shape the allow-list accepts — so that is checked against a real one.
   */
  await check_if(storageReady, "the asset proxy accepts a real download URL and nothing else", async () => {
    const url = await getDownloadURL(storageRef(storage, photoB));
    if (!allowedAssetUrl(url, CONFIG.storageBucket)) {
      throw new Error("a real Storage URL was refused by the allow-list");
    }
    const noToken = url.replace(/[?&]token=[^&]*/, "");
    if (allowedAssetUrl(noToken, CONFIG.storageBucket)) {
      throw new Error("a URL with no download token was allowed");
    }
    if (allowedAssetUrl(url, "someone-elses-bucket.firebasestorage.app")) {
      throw new Error("another project's bucket was allowed");
    }
    if (allowedAssetUrl("http://169.254.169.254/latest/meta-data/", CONFIG.storageBucket)) {
      throw new Error("the proxy would fetch an arbitrary host");
    }
  });

  /* --- 2e. The whole month, in one go -------------------------------------- */
  console.log("\nOwner A, the 30-day pack");

  /** Every creative in A's subcollection, decoded, as the app would read them. */
  async function listPack() {
    const snap = await getDocs(collection(db, "contentPlans", uidA, "creatives"));
    return snap.docs
      .map((document) => decodeCreative(document.data(), document.id))
      .filter(Boolean);
  }

  /** Writes one day exactly the way the browser does, and remembers to clean up. */
  async function persistDay(creative) {
    await setDoc(
      doc(db, "contentPlans", uidA, "creatives", creative.id),
      encodeCreative(creative, uidA),
    );
    const path = `contentPlans/${uidA}/creatives/${creative.id}`;
    if (!ownerDeletable.includes(path)) ownerDeletable.push(path);
  }

  function buildAll(before) {
    const photos = assignPhotos(plan.items, photoPool(before));
    return (item) => composePackDay(DEMO_RESTAURANT, plan.id, item, photos);
  }

  let afterFirstRun = [];

  // Day 01 already has a design in it, edited by hand and carrying a photo the
  // owner chose. A pack run that overwrites it is the failure this whole
  // section exists to catch.
  await check("a pack run generates only the days that have none", async () => {
    const before = await listPack();
    const targets = missingItems(plan.items, before);
    if (targets.length !== plan.items.length - before.length) {
      throw new Error(`${targets.length} targets for ${before.length} saved of ${plan.items.length}`);
    }
    const result = await runPack(targets, buildAll(before), persistDay);
    if (result.failures.length > 0) {
      throw new Error(`${result.failures.length} day(s) failed: ${result.failures[0].message}`);
    }
    afterFirstRun = await listPack();
    if (afterFirstRun.length !== plan.items.length) {
      throw new Error(`expected ${plan.items.length} creatives, found ${afterFirstRun.length}`);
    }
  });

  await check("every day of the plan has its own design, on the right day", async () => {
    const byItem = new Map(afterFirstRun.map((creative) => [creative.itemId, creative]));
    if (byItem.size !== plan.items.length) throw new Error("two days share a document");
    for (const item of plan.items) {
      const creative = byItem.get(item.id);
      if (!creative) throw new Error(`day ${item.day} has no design`);
      if (creative.day !== item.day) throw new Error(`design for day ${item.day} says day ${creative.day}`);
      if (creative.platform !== item.platform) {
        throw new Error(`day ${item.day} was built for ${creative.platform}, not ${item.platform}`);
      }
    }
  });

  await check("the design the owner edited was not overwritten by the run", async () => {
    const back = decodeCreative((await getDoc(creativeRef)).data(), composed.itemId);
    const headline = back?.elements.find((el) => el.id === "headline");
    if (headline?.text !== "Nasi Ayam Penyet panas hari ini") {
      throw new Error(`Day 01's headline came back as ${JSON.stringify(headline?.text)}`);
    }
    const slot = back?.elements.find((el) => el.kind === "image");
    if (slot?.source?.path !== photoB) throw new Error("Day 01 lost the photo the owner chose");
  });

  await check("the poster never carries the whole caption", async () => {
    for (const creative of afterFirstRun) {
      const item = plan.items.find((i) => i.id === creative.itemId);
      for (const el of creative.elements) {
        if (el.kind !== "text") continue;
        if (item && el.text.trim() === item.caption.trim()) {
          throw new Error(`day ${creative.day} put the caption on the poster`);
        }
        if (el.text.length > 120) {
          throw new Error(`day ${creative.day} has a ${el.text.length}-character line on the poster`);
        }
      }
    }
  });

  await check("running the pack again leaves 30 designs, not 60", async () => {
    const before = await listPack();
    const targets = missingItems(plan.items, before);
    if (targets.length !== 0) throw new Error(`${targets.length} day(s) would be generated again`);
    const result = await runPack(targets, buildAll(before), persistDay);
    if (result.saved.length !== 0) throw new Error("a second run wrote something");

    const after = await listPack();
    if (after.length !== plan.items.length) {
      throw new Error(`expected ${plan.items.length} creatives, found ${after.length}`);
    }
    // Nothing was rewritten, so nothing was touched: same timestamps, same work.
    for (const creative of after) {
      const first = afterFirstRun.find((c) => c.itemId === creative.itemId);
      if (first && first.updatedAt !== creative.updatedAt) {
        throw new Error(`day ${creative.day} was rewritten by the second run`);
      }
    }
  });

  await check("a failed day is retried without disturbing the others", async () => {
    const victim = plan.items[9];
    const { deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(db, "contentPlans", uidA, "creatives", victim.id));

    const before = await listPack();
    if (before.length !== plan.items.length - 1) throw new Error("the gap was not made");
    if (packStatus({ total: plan.items.length, ready: before.length, failed: 1, running: false }) !== "partial") {
      throw new Error("a pack with a gap reported itself ready");
    }

    const targets = missingItems(plan.items, before);
    if (targets.length !== 1 || targets[0].id !== victim.id) throw new Error("the retry picked the wrong day");
    const result = await runPack(targets, buildAll(before), persistDay);
    if (result.failures.length > 0) throw new Error("the retry failed");

    const after = await listPack();
    if (after.length !== plan.items.length) throw new Error("the gap was not filled");
    for (const creative of after) {
      if (creative.itemId === victim.id) continue;
      const first = afterFirstRun.find((c) => c.itemId === creative.itemId);
      if (first && first.updatedAt !== creative.updatedAt) {
        throw new Error(`day ${creative.day} was rewritten by a retry of day ${victim.day}`);
      }
    }
    if (packStatus({ total: plan.items.length, ready: after.length, failed: 0, running: false }) !== "ready") {
      throw new Error("a complete pack did not report itself ready");
    }
  });

  /* --- 2e. Packs and orders: the entitlement itself ------------------------ */
  //
  // Every M5 rule rests on one asymmetry. An owner may read their entitlement
  // and write the content they bought into it; they may never write the
  // entitlement. The packs below are created exactly as production creates
  // them — through the payment callback's own store functions, as the service
  // account — and then attacked from an ordinary signed-in browser.
  console.log("\nOwner A, packs and orders");

  const firstBuy = await buy(uidA);
  const secondBuy = await buy(uidA);
  const abandoned = await unpaidOrder(uidA);
  const firstPackRef = doc(db, "contentPacks", uidA, "packs", firstBuy.packId);
  const secondPackRef = doc(db, "contentPacks", uidA, "packs", secondBuy.packId);

  // A pack that was never paid for. Production only ever writes one of these
  // as a paid pack, so it is planted here to prove the rule that refuses the
  // shape rather than the value: a pending pack cannot be written into, and
  // cannot be promoted to paid by the party who benefits.
  const pendingPackId = "pak_pending_verify";
  const pendingPackRef = doc(db, "contentPacks", uidA, "packs", pendingPackId);
  {
    const now = new Date().toISOString();
    await commit([
      {
        path: `contentPacks/${uidA}/packs/${pendingPackId}`,
        data: {
          ...encodePaidPack({
            packId: pendingPackId,
            ownerId: uidA,
            orderId: abandoned.orderId,
            days: PACK_DAYS,
            now,
            paidAt: now,
          }),
          paymentStatus: "pending",
          paidAt: null,
        },
        mustNotExist: true,
      },
    ]);
    serverDeletable.push(`contentPacks/${uidA}/packs/${pendingPackId}`);
  }

  await check("the pack a verified payment created is readable by its owner", async () => {
    const snap = await getDoc(firstPackRef);
    if (!snap.exists()) throw new Error("the pack the callback created is not there");
    const data = snap.data();
    if (data.paymentStatus !== "paid") throw new Error(`paymentStatus is ${data.paymentStatus}`);
    if (data.generationStatus !== "awaiting_generation") {
      throw new Error(`a fresh pack reports ${data.generationStatus}`);
    }
    if (data.orderId !== firstBuy.orderId) throw new Error("the pack points at another order");
    if (data.ownerId !== uidA) throw new Error("the pack is owned by somebody else");
    if (data.days !== PACK_DAYS) throw new Error(`the pack is ${data.days} days`);
  });

  await check("two purchases are two packs, both the owner's", async () => {
    const snap = await getDocs(collection(db, "contentPacks", uidA, "packs"));
    const ids = snap.docs.map((d) => d.id);
    for (const id of [firstBuy.packId, secondBuy.packId]) {
      if (!ids.includes(id)) throw new Error(`pack ${id} is missing from the listing`);
    }
    if (firstBuy.packId === secondBuy.packId) throw new Error("both purchases made one pack");
  });

  await check("an owner cannot create a pack for themselves", () =>
    denied("self-issued pack", () =>
      setDoc(doc(db, "contentPacks", uidA, "packs", "pak_selfissued"), {
        ...encodePaidPack({
          packId: "pak_selfissued",
          ownerId: uidA,
          orderId: "ord_selfissued",
          days: PACK_DAYS,
          now: new Date().toISOString(),
          paidAt: new Date().toISOString(),
        }),
      }),
    ),
  );

  await check("an owner cannot create even an unpaid pack", () =>
    denied("self-issued pending pack", () =>
      setDoc(doc(db, "contentPacks", uidA, "packs", "pak_selfpending"), {
        ownerId: uidA,
        packId: "pak_selfpending",
        orderId: "ord_x",
        source: "purchase",
        paymentStatus: "pending",
        days: PACK_DAYS,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ),
  );

  await check("an owner cannot promote an unpaid pack to paid", () =>
    denied("self-payment", () =>
      updateDoc(pendingPackRef, {
        paymentStatus: "paid",
        paidAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ),
  );

  await check("an owner cannot generate into a pack they have not paid for", () =>
    denied("write unpaid pack", () =>
      updateDoc(pendingPackRef, {
        ...encodePackPlan(plan, uidA, "ready"),
      }),
    ),
  );

  await check("an owner cannot rewrite who owns their pack", () =>
    denied("pack ownerId spoof", () =>
      updateDoc(firstPackRef, { ownerId: "somebody-else", updatedAt: new Date().toISOString() }),
    ),
  );

  await check("an owner cannot rewrite what they paid for it", async () => {
    for (const [label, patch] of [
      ["paymentStatus", { paymentStatus: "pending" }],
      ["paidAt", { paidAt: "2020-01-01T00:00:00.000Z" }],
      ["orderId", { orderId: "ord_somebody_elses" }],
      ["source", { source: "legacy" }],
      ["days", { days: 3650 }],
      ["createdAt", { createdAt: "2020-01-01T00:00:00.000Z" }],
      ["packId", { packId: "pak_renamed" }],
    ]) {
      await denied(`pack ${label} rewrite`, () =>
        updateDoc(firstPackRef, { ...patch, updatedAt: new Date().toISOString() }),
      );
    }
  });

  await check("an owner cannot delete a pack they paid for", () =>
    denied("delete pack", () =>
      import("firebase/firestore").then(({ deleteDoc }) => deleteDoc(firstPackRef)),
    ),
  );

  await check("an owner can write the content they bought into their pack", async () => {
    await updateDoc(firstPackRef, encodePackPlan(plan, uidA, "ready"));
    const back = (await getDoc(firstPackRef)).data();
    if (back.items?.length !== 30) throw new Error(`the pack came back with ${back.items?.length}`);
    if (back.generationStatus !== "ready") throw new Error("the pack did not report itself ready");
    if (back.paymentStatus !== "paid") throw new Error("writing content disturbed the payment");
    if (back.orderId !== firstBuy.orderId) throw new Error("writing content disturbed the order");
  });

  await check("regenerating one day rewrites that day, in that pack only", async () => {
    const swapped = await generator.regenerateDay(
      { restaurant: DEMO_RESTAURANT, startDate: plan.startDate, variants: { 5: 1 } },
      5,
    );
    const before = (await getDoc(firstPackRef)).data().items;
    const items = before.map((item) =>
      item.day === 5 ? { ...item, ...JSON.parse(JSON.stringify(swapped)) } : item,
    );
    await updateDoc(firstPackRef, { items, updatedAt: new Date().toISOString() });

    const after = (await getDoc(firstPackRef)).data().items;
    if (after.length !== 30) throw new Error("day count changed");
    if (after[4].caption === before[4].caption) throw new Error("day 5 did not change");
    for (const item of before) {
      if (item.day === 5) continue;
      const match = after.find((i) => i.day === item.day);
      if (JSON.stringify(match) !== JSON.stringify(item)) {
        throw new Error(`day ${item.day} changed but should not have`);
      }
    }

    // The day belongs to one pack. Regeneration must not reach across to
    // another the same owner bought.
    const other = (await getDoc(secondPackRef)).data();
    if (other.items) throw new Error("regenerating one pack wrote into another");
    if (other.generationStatus !== "awaiting_generation") {
      throw new Error(`the other pack now reports ${other.generationStatus}`);
    }
  });

  await check("an owner can name their pack, and it is not a payment id", async () => {
    const name = "30 Hari Content — Ujian";
    await updateDoc(firstPackRef, { packName: name, updatedAt: new Date().toISOString() });
    const back = (await getDoc(firstPackRef)).data();
    if (back.packName !== name) throw new Error(`the name came back as ${back.packName}`);
    if (back.items?.length !== 30) throw new Error("renaming lost the content");
  });

  await check("writing one pack leaves the other exactly as it was", async () => {
    const other = (await getDoc(secondPackRef)).data();
    if (other.items) throw new Error("content appeared in a pack nobody generated");
    if (other.generationStatus !== "awaiting_generation") {
      throw new Error(`the untouched pack reports ${other.generationStatus}`);
    }
    if (other.orderId !== secondBuy.orderId) throw new Error("the second pack changed order");
  });

  await check("each pack carries its own name", async () => {
    await updateDoc(secondPackRef, {
      packName: "Pek Kedua — Ujian",
      updatedAt: new Date().toISOString(),
    });
    const first = (await getDoc(firstPackRef)).data();
    const second = (await getDoc(secondPackRef)).data();
    if (first.packName === second.packName) throw new Error("both packs answer to one name");
    if (second.items) throw new Error("naming the second pack invented content in it");
    if (first.items?.length !== 30) throw new Error("naming the second pack disturbed the first");
  });

  const packCreative = composeCreative(DEMO_RESTAURANT, firstBuy.packId, plan.items[1]);
  const packCreativeRef = doc(
    db, "contentPacks", uidA, "packs", firstBuy.packId, "creatives", packCreative.id,
  );

  await check("an owner can save a design under a pack they paid for", async () => {
    await setDoc(packCreativeRef, encodeCreative(packCreative, uidA));
    ownerDeletable.push(`contentPacks/${uidA}/packs/${firstBuy.packId}/creatives/${packCreative.id}`);
    const back = decodeCreative((await getDoc(packCreativeRef)).data(), packCreative.itemId);
    if (!back) throw new Error("the design did not come back");
  });

  await check("an owner cannot forge the owner of a pack design", () =>
    denied("pack creative ownerId spoof", () =>
      setDoc(packCreativeRef, { ...encodeCreative(packCreative, uidA), ownerId: "somebody-else" }),
    ),
  );

  await check("an owner can read their own order and see what it cost", async () => {
    const snap = await getDoc(doc(db, "orders", firstBuy.orderId));
    if (!snap.exists()) throw new Error("the owner cannot see their own order");
    const order = snap.data();
    if (order.amountSen !== 3990) throw new Error(`the order says ${order.amountSen} sen`);
    if (order.paymentStatus !== "paid") throw new Error("a fulfilled order is not marked paid");
    if (order.ownerId !== uidA) throw new Error("the order belongs to somebody else");
  });

  await check("an owner cannot pay their own order", () =>
    denied("self-marked payment", () =>
      updateDoc(doc(db, "orders", abandoned.orderId), {
        paymentStatus: "paid",
        paidAt: new Date().toISOString(),
      }),
    ),
  );

  await check("an owner cannot raise an order of their own", () =>
    denied("self-issued order", () =>
      setDoc(doc(db, "orders", "ord_selfissued_verify"), {
        orderId: "ord_selfissued_verify",
        ownerId: uidA,
        packId: "pak_selfissued_verify",
        amountSen: 1,
        currency: "MYR",
        paymentStatus: "paid",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ),
  );

  await check("an owner cannot change the amount on an order", () =>
    denied("order amount rewrite", () =>
      updateDoc(doc(db, "orders", abandoned.orderId), { amountSen: 1 }),
    ),
  );

  await check("orders cannot be enumerated at all", () =>
    denied("list orders", () => getDocs(collection(db, "orders"))),
  );

  await check("the bill-to-order mapping is invisible to every client", () =>
    denied("read bill mapping", () => getDoc(doc(db, "billplzBills", "ANYBILL"))),
  );

  /* --- 2f. The pre-payment month, migrated without being moved ------------- */
  console.log("\nOwner A, legacy migration");

  const legacyBefore = JSON.stringify((await getDoc(doc(db, "contentPlans", uidA))).data());
  const legacyPackRef = doc(db, "contentPacks", uidA, "packs", LEGACY_PACK_ID);

  await check("a grandfathered month becomes a pack the owner keeps", async () => {
    const result = await migrateLegacy(uidA, new Date().toISOString());
    if (result.kind !== "migrated") throw new Error(`migration said ${result.kind}`);
    serverDeletable.push(`contentPacks/${uidA}/packs/${LEGACY_PACK_ID}`);
    const snap = await getDoc(legacyPackRef);
    if (!snap.exists()) throw new Error("the legacy pack was not created");
    const data = snap.data();
    if (data.items?.length !== 30) throw new Error(`the legacy pack has ${data.items?.length} days`);
    if (data.paymentStatus !== "paid") throw new Error("a grandfathered owner was not kept whole");
    if (data.source !== "legacy") throw new Error(`the pack calls itself ${data.source}`);
  });

  await check("the original plan is still exactly where it was", async () => {
    const after = JSON.stringify((await getDoc(doc(db, "contentPlans", uidA))).data());
    if (after !== legacyBefore) throw new Error("the migration changed the original plan");
  });

  await check("the owner's designs came with it, and stayed behind too", async () => {
    const copied = await getDocs(
      collection(db, "contentPacks", uidA, "packs", LEGACY_PACK_ID, "creatives"),
    );
    for (const document of copied.docs) {
      ownerDeletable.push(
        `contentPacks/${uidA}/packs/${LEGACY_PACK_ID}/creatives/${document.id}`,
      );
    }
    if (copied.empty) throw new Error("no design was carried into the legacy pack");
    const original = await getDocs(collection(db, "contentPlans", uidA, "creatives"));
    if (original.empty) throw new Error("the original designs are gone");
  });

  await check("migrating twice produces one pack, not two", async () => {
    const before = (await getDocs(collection(db, "contentPacks", uidA, "packs"))).size;
    const again = await migrateLegacy(uidA, new Date().toISOString());
    if (again.kind !== "skipped") throw new Error(`the second migration said ${again.kind}`);
    const after = (await getDocs(collection(db, "contentPacks", uidA, "packs"))).size;
    if (after !== before) throw new Error(`packs went from ${before} to ${after}`);
    const stillThere = (await getDoc(legacyPackRef)).data();
    if (stillThere.items?.length !== 30) throw new Error("the second run damaged the pack");
  });

  await check("the pre-payment plan is still read-only to its owner", () =>
    denied("write frozen plan", () =>
      setDoc(doc(db, "contentPlans", uidA), encodePlan(plan, uidA)),
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

  await check("cannot read A's creative", () =>
    denied("read A creative", () => getDoc(creativeRef)),
  );
  await check("cannot list A's creatives", () =>
    denied("list A creatives", () =>
      getDocs(collection(db, "contentPlans", uidA, "creatives")),
    ),
  );
  await check("cannot overwrite A's creative", () =>
    denied("write A creative", () => setDoc(creativeRef, encodeCreative(stored, uidA))),
  );
  await check("cannot read a day from the middle of A's pack", () =>
    denied("read A pack day", () =>
      getDoc(doc(db, "contentPlans", uidA, "creatives", plan.items[14].id)),
    ),
  );
  await check("cannot rename A's pack", () =>
    denied("rename A pack", () =>
      updateDoc(doc(db, "contentPlans", uidA), {
        packName: "milik saya sekarang",
        updatedAt: new Date().toISOString(),
      }),
    ),
  );
  // What somebody else's money bought. An entitlement is only worth anything
  // if it cannot be read, written, renamed or listed by the next signed-in
  // stranger, and neither can the design work inside it.
  await check("cannot read the pack A paid for", () =>
    denied("read A pack", () => getDoc(firstPackRef)),
  );
  await check("cannot list the packs A paid for", () =>
    denied("list A packs", () => getDocs(collection(db, "contentPacks", uidA, "packs"))),
  );
  await check("cannot write content into A's pack", () =>
    denied("write A pack", () => updateDoc(firstPackRef, encodePackPlan(plan, uidA, "ready"))),
  );
  await check("cannot rename the pack A paid for", () =>
    denied("rename A pack document", () =>
      updateDoc(firstPackRef, { packName: "milik saya sekarang", updatedAt: new Date().toISOString() }),
    ),
  );
  await check("cannot issue themselves a pack in A's name", () =>
    denied("write into A's packs", () =>
      setDoc(doc(db, "contentPacks", uidA, "packs", "pak_takeover"), {
        ownerId: uidB,
        packId: "pak_takeover",
        orderId: "ord_takeover",
        source: "purchase",
        paymentStatus: "paid",
        paidAt: new Date().toISOString(),
        days: PACK_DAYS,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ),
  );
  await check("cannot read a design inside A's pack", () =>
    denied("read A pack creative", () => getDoc(packCreativeRef)),
  );
  await check("cannot overwrite a design inside A's pack", () =>
    denied("write A pack creative", () =>
      setDoc(packCreativeRef, encodeCreative(packCreative, uidB)),
    ),
  );
  await check("cannot read what A paid, or that they paid at all", () =>
    denied("read A order", () => getDoc(doc(db, "orders", firstBuy.orderId))),
  );

  await check_if(storageReady, "cannot read A's creative photo", () =>
    deniedStorage("read A creative photo", () =>
      getDownloadURL(storageRef(storage, photoB)),
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
  await check("the edited creative survives signing out and back in", async () => {
    const back = decodeCreative((await getDoc(creativeRef)).data(), composed.itemId);
    if (!back) throw new Error("the creative did not survive the session");
    const headline = back.elements.find((el) => el.id === "headline");
    if (headline?.text !== "Nasi Ayam Penyet panas hari ini") {
      throw new Error("the owner's own headline was lost");
    }
    const slot = back.elements.find((el) => el.kind === "image");
    if (slot?.source?.path !== photoB) throw new Error("the replaced photo was lost");
  });

  // The creative engine reads the plan and writes beside it. If a day moved,
  // something in there is writing where it should not.
  await check("the content plan is untouched by creative work", async () => {
    const after = JSON.stringify((await getDoc(doc(db, "contentPlans", uidA))).data());
    if (after !== planBefore) throw new Error("the content plan changed");
  });

  // Renaming used to be the one thing the pack screen wrote to the plan
  // document. It writes the pack now, and the plan refuses it.
  await check("the grandfathered plan cannot be renamed by its owner", () =>
    denied("rename frozen plan", () =>
      updateDoc(doc(db, "contentPlans", uidA), {
        packName: defaultPackName(DEMO_RESTAURANT, plan.items.length),
        updatedAt: new Date().toISOString(),
      }),
    ),
  );

  await check("both packs come back named, with the content in the right one", async () => {
    const first = (await getDoc(firstPackRef)).data();
    const second = (await getDoc(secondPackRef)).data();
    if (first.packName !== "30 Hari Content — Ujian") {
      throw new Error(`the first name came back as ${JSON.stringify(first.packName)}`);
    }
    if (second.packName !== "Pek Kedua — Ujian") {
      throw new Error(`the second name came back as ${JSON.stringify(second.packName)}`);
    }
    if (first.items?.length !== plan.items.length) throw new Error("the paid content did not survive");
    if (second.items) throw new Error("the unfinished pack gained content overnight");
    if (first.paymentStatus !== "paid" || second.paymentStatus !== "paid") {
      throw new Error("an entitlement changed across the session");
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

  // Creatives are removed as their owner while that session still exists; the
  // CLI cleanup below reaches documents, not subcollections.
  if (ownerDeletable.length > 0) {
    try {
      const { deleteDoc } = await import("firebase/firestore");
      await signOut(auth);
      await signInWithEmailAndPassword(auth, accountA.email, accountA.password);
      for (const path of ownerDeletable) {
        await deleteDoc(doc(db, path)).catch(() => {});
      }
      console.log(`  removed ${ownerDeletable.length} creative document(s)`);
    } catch (error) {
      console.log(`  could not remove creatives: ${error.code ?? error.message}`);
    }
  }

  // Orders and packs: the rules deny every client delete on both, which is the
  // property the checks above prove, so their cleanup goes through the service
  // account rather than pretending a browser could tidy up after itself.
  if (serverDeletable.length > 0) {
    let gone = 0;
    for (const path of serverDeletable) {
      try {
        await serverDelete(path);
        gone += 1;
      } catch (error) {
        console.log(`  could not remove ${path}: ${error.message}`);
      }
    }
    console.log(`  removed ${gone} order/pack document(s)`);
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
    for (const collection of ["users", "restaurants", "contentPlans", "contentPacks"]) {
      try {
        await run("firebase", [
          "firestore:delete", `${collection}/${uid}`,
          "--project", CONFIG.projectId,
          ...(account ? ["--account", account] : []),
          // Plans and packs both carry subcollections — creatives, and packs
          // themselves — which a plain delete would orphan.
          "--recursive",
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
