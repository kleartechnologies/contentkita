/**
 * Removes the throwaway accounts the browser suites leave in the real project.
 *
 * The flow and responsive suites run against `contentkita-8fcf8`, so every run
 * creates a real user and real documents. Leaving them there would slowly fill
 * the project with fixtures that look like customers.
 *
 *   node --conditions=react-server --env-file=.env.local scripts/cleanup-flow.mjs <email> <password>
 *
 * With no arguments it reads the accounts recorded in scripts/.flow-accounts,
 * which the suites append to.
 *
 * Two different authorities are needed, and the order matters:
 *
 *   - The *uploads* are deleted by the account itself, because `storage.rules`
 *     lets an owner delete their own files. Their paths come from the
 *     restaurant document, which is read before anything is removed — the
 *     rules deny listing a folder, so the document is the only way to learn
 *     what was uploaded.
 *   - The *documents* are deleted by the project owner through the Firebase
 *     CLI, because `firestore.rules` denies delete to every client. An earlier
 *     version of this script deleted them as the owner and ignored the failure,
 *     which meant it reported a clean project while orphaning every document it
 *     claimed to have removed. Deleting the account first would orphan them for
 *     good: with the uid gone, nothing can ever reach those paths again.
 *   - The *account* is deleted last, by the account itself, signed in. It is
 *     the key to both of the above, so it goes only once they are done.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { deleteApp, initializeApp } from "firebase/app";
import { deleteUser, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { deleteObject, getStorage, ref } from "firebase/storage";

import { accessToken, serviceAccount } from "../lib/server/google-token.ts";

const run = promisify(execFile);

const LEDGER = "scripts/.flow-accounts";
const COLLECTIONS = ["contentPacks", "contentPlans", "restaurants", "users"];

const CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (!CONFIG.apiKey) {
  console.error("Missing Firebase config. Run with --env-file=.env.local");
  process.exit(1);
}

/**
 * Repairs the damage the first version of this script did.
 *
 * It deleted accounts while failing to delete their documents, leaving paths no
 * client can ever reach again. Those uids cannot be recovered by signing in, so
 * they are passed in by hand after being read out of the project and checked
 * one by one.
 *
 * Two safeguards, because this deletes real documents in a real project:
 * `--protect` names uids that must never be touched whatever the list says, and
 * a uid must look like a Firebase uid rather than a collection name, so a
 * mistyped argument cannot turn into a recursive wipe.
 */
async function repairOrphans(listPath, protectedUids) {
  const uids = (await readFile(listPath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const bad = uids.filter((uid) => !/^[A-Za-z0-9]{20,40}$/.test(uid));
  if (bad.length > 0) {
    console.error(`Refusing to run: ${bad.length} entr(ies) are not uids: ${bad.join(", ")}`);
    process.exit(1);
  }

  const targets = uids.filter((uid) => !protectedUids.has(uid));
  const skipped = uids.filter((uid) => protectedUids.has(uid));
  for (const uid of skipped) console.log(`  PROTECTED, not touched: ${uid}`);

  console.log(`Deleting documents for ${targets.length} uid(s) across ${COLLECTIONS.join(", ")}.`);

  let removed = 0;
  const failed = [];
  for (const uid of targets) {
    for (const collection of COLLECTIONS) {
      const failure = await removeDoc(`${collection}/${uid}`);
      if (failure) failed.push(`${collection}/${uid}: ${failure}`);
      else removed += 1;
    }
    console.log(`  cleared ${uid}`);
  }

  console.log(`\nremoved ${removed} document path(s)`);
  console.log(
    `Uploads are not covered here — the documents naming them are gone. Check\n` +
      `  gcloud storage ls -r gs://${CONFIG.storageBucket}/restaurants --project ${CONFIG.projectId}`,
  );
  if (failed.length > 0) {
    console.log(`${failed.length} FAILED:`);
    for (const line of failed) console.log(`  ${line}`);
    process.exitCode = 1;
  }
}

async function accounts() {
  const [email, password] = process.argv.slice(2);
  if (email && password) return [{ email, password }];
  if (!existsSync(LEDGER)) return [];
  return (await readFile(LEDGER, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [email, password] = line.split("\t");
      return { email, password };
    });
}

/** Deletes one document as the project owner. Returns the reason it did not. */
async function removeDoc(path) {
  const account = process.env.FIREBASE_CLI_ACCOUNT?.trim();
  try {
    await run("firebase", [
      "firestore:delete", path,
      "--project", CONFIG.projectId,
      ...(account ? ["--account", account] : []),
      // A plan now carries its creatives in a subcollection, and those are not
      // reached by deleting the document above them.
      "--recursive",
      "--force",
    ]);
    return null;
  } catch (error) {
    return (error.stderr || error.message || "").trim().split("\n")[0];
  }
}

/**
 * Removes the orders a throwaway account raised, and their bill mappings.
 *
 * Orders are keyed by order id rather than by uid, so there is no path to
 * delete: they have to be found by their owner. No client may even list them —
 * that is the point of the rule — so this is the one part of the cleanup that
 * runs as the service account, and it deletes only documents whose `ownerId`
 * is the throwaway uid it was given.
 */
async function removeOrders(uid) {
  const { projectId } = serviceAccount();
  const token = await accessToken();
  const root = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const auth = { authorization: `Bearer ${token}` };

  const response = await fetch(`${root}:runQuery`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "orders" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "ownerId" },
            op: "EQUAL",
            value: { stringValue: uid },
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`order lookup returned ${response.status}`);

  const rows = (await response.json()).filter((row) => row.document);
  const paths = [];
  for (const { document } of rows) {
    paths.push(document.name.split("/documents/")[1]);
    const billId = document.fields?.billplzBillId?.stringValue;
    if (billId) paths.push(`billplzBills/${encodeURIComponent(billId)}`);
  }

  let removed = 0;
  for (const path of paths) {
    const result = await fetch(`${root}/${path}`, { method: "DELETE", headers: auth });
    if (result.ok || result.status === 404) removed += 1;
  }
  return removed;
}

/**
 * Removes the files an owner uploaded, as that owner.
 *
 * The paths are read off the restaurant document rather than listed, because
 * `storage.rules` authorises each object individually and denies listing a
 * folder. Returns the paths it could not remove, which is what makes a failure
 * visible instead of silently leaving files in the bucket after the account
 * that owned them is gone.
 */
async function removeUploads(storage, db, uid) {
  let restaurant;
  try {
    restaurant = await getDoc(doc(db, "restaurants", uid));
  } catch {
    return [];
  }
  if (!restaurant.exists()) return [];

  const data = restaurant.data();
  const paths = [data.logo?.path, data.menuFile?.path].filter(Boolean);

  const failed = [];
  let removed = 0;
  for (const path of paths) {
    try {
      await deleteObject(ref(storage, path));
      removed += 1;
    } catch (error) {
      // A file already gone is the outcome we wanted, not a failure.
      if (error?.code === "storage/object-not-found") continue;
      failed.push(`${path}: ${error?.code ?? error}`);
    }
  }
  if (removed > 0) console.log(`  removed ${removed} uploaded file(s)`);
  return failed;
}

const argv = process.argv.slice(2);
const orphanIndex = argv.indexOf("--orphans");
if (orphanIndex !== -1) {
  const listPath = argv[orphanIndex + 1];
  if (!listPath) {
    console.error("--orphans needs a file of uids, one per line");
    process.exit(1);
  }
  const protectIndex = argv.indexOf("--protect");
  const protectedUids = new Set(
    protectIndex === -1 ? [] : (argv[protectIndex + 1] ?? "").split(",").filter(Boolean),
  );
  await repairOrphans(listPath, protectedUids);
  process.exit(process.exitCode ?? 0);
}

const list = await accounts();
if (list.length === 0) {
  console.log("Nothing to clean up.");
  process.exit(0);
}

const app = initializeApp(CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const remaining = [];
let removedDocs = 0;
const orphaned = [];
const orphanedFiles = [];

for (const { email, password } of list) {
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);

    orphanedFiles.push(...(await removeUploads(storage, db, user.uid)));

    try {
      removedDocs += await removeOrders(user.uid);
    } catch (error) {
      console.log(`  could not remove orders for ${email}: ${error.message}`);
    }

    for (const collection of COLLECTIONS) {
      const failure = await removeDoc(`${collection}/${user.uid}`);
      if (failure) orphaned.push(`${collection}/${user.uid}`);
      else removedDocs += 1;
    }

    await deleteUser(user);
    console.log(`  removed ${email}`);
  } catch (error) {
    if (error?.code === "auth/invalid-credential" || error?.code === "auth/user-not-found") {
      console.log(`  already gone ${email}`);
      continue;
    }
    console.log(`  FAILED ${email}: ${error?.code ?? error}`);
    remaining.push(`${email}\t${password}`);
  }
}

await writeFile(LEDGER, remaining.length ? `${remaining.join("\n")}\n` : "");
await deleteApp(app);

console.log(`  removed ${removedDocs} document(s)`);

// Counting attempts rather than successes would report a clean project while
// leaving test data in it.
if (orphaned.length > 0) {
  console.log(
    `\n${orphaned.length} document(s) LEFT BEHIND. The Firebase CLI could not delete them:\n` +
      orphaned.map((path) => `  ${path}`).join("\n") +
      `\n\nRun 'firebase login --reauth', then delete them with:\n` +
      orphaned
        .map(
          (path) =>
            `  firebase firestore:delete ${path} --project ${CONFIG.projectId} --recursive --force`,
        )
        .join("\n"),
  );
}

// Files outlive the account that could delete them, so a failure here is
// reported the same way a document failure is — with the command that fixes it.
if (orphanedFiles.length > 0) {
  console.log(
    `\n${orphanedFiles.length} uploaded file(s) LEFT BEHIND:\n` +
      orphanedFiles.map((line) => `  ${line}`).join("\n") +
      `\n\nTheir owner is gone, so they need project authority:\n` +
      `  gcloud storage rm gs://${CONFIG.storageBucket}/<path> --project ${CONFIG.projectId}`,
  );
}

console.log(
  `\nDone. ${remaining.length} account(s), ${orphaned.length} document(s) and ` +
    `${orphanedFiles.length} file(s) still need attention.`,
);
if (remaining.length > 0 || orphaned.length > 0 || orphanedFiles.length > 0) {
  process.exitCode = 1;
}
