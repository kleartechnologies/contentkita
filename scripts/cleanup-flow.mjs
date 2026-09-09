/**
 * Removes the throwaway accounts the browser suites leave in the real project.
 *
 * The flow and responsive suites run against `contentkita-8fcf8`, so every run
 * creates a real user and real documents. Leaving them there would slowly fill
 * the project with fixtures that look like customers.
 *
 *   node --env-file=.env.local scripts/cleanup-flow.mjs <email> <password>
 *
 * With no arguments it reads the accounts recorded in scripts/.flow-accounts,
 * which the suites append to.
 *
 * Two different authorities are needed, and the order matters:
 *
 *   - The *account* is deleted by the account itself, signed in.
 *   - The *documents* are deleted by the project owner through the Firebase
 *     CLI, because `firestore.rules` denies delete to every client. An earlier
 *     version of this script deleted them as the owner and ignored the failure,
 *     which meant it reported a clean project while orphaning every document it
 *     claimed to have removed. Deleting the account first would orphan them for
 *     good: with the uid gone, nothing can ever reach those paths again.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { deleteApp, initializeApp } from "firebase/app";
import { deleteUser, getAuth, signInWithEmailAndPassword } from "firebase/auth";

const run = promisify(execFile);

const LEDGER = "scripts/.flow-accounts";
const COLLECTIONS = ["contentPlans", "restaurants", "users"];

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
      "--force",
    ]);
    return null;
  } catch (error) {
    return (error.stderr || error.message || "").trim().split("\n")[0];
  }
}

const list = await accounts();
if (list.length === 0) {
  console.log("Nothing to clean up.");
  process.exit(0);
}

const app = initializeApp(CONFIG);
const auth = getAuth(app);

const remaining = [];
let removedDocs = 0;
const orphaned = [];

for (const { email, password } of list) {
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);

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
        .map((path) => `  firebase firestore:delete ${path} --project ${CONFIG.projectId} --force`)
        .join("\n"),
  );
}

console.log(
  `\nDone. ${remaining.length} account(s) and ${orphaned.length} document(s) still need attention.`,
);
if (remaining.length > 0 || orphaned.length > 0) process.exitCode = 1;
