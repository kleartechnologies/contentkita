import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The secrets, checked against the source tree itself.
 *
 * Every other test in this repository proves that the payment code behaves
 * correctly. This one proves something the behaviour cannot: that the Billplz
 * secret key, the X Signature key, the service-account private key and the
 * OpenAI key are only ever read on the server, and cannot reach a browser
 * bundle.
 *
 * Next decides what to ship to the client by following imports from files
 * marked `"use client"`, so that is what this walks — the real import graph,
 * transitively, the same way the bundler does. A `server-only` import makes the
 * build fail if the graph is ever wrong; this test says so in one line instead
 * of in a stack trace, and it also catches the mistake that `server-only`
 * cannot: a `NEXT_PUBLIC_` prefix, which inlines a value into the bundle
 * without any import at all.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIRS = ["app", "components", "lib", "scripts"];

/** Reading any of these makes a file server-side, permanently. */
const SECRET_ENV = [
  "BILLPLZ_SECRET_KEY",
  "BILLPLZ_X_SIGNATURE_KEY",
  "FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "OPENAI_API_KEY",
];

function sources(dir: string, found: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, found);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) found.push(path);
  }
  return found;
}

const FILES = DIRS.flatMap((dir) => sources(dir));
const TEXT = new Map(FILES.map((path) => [path, readFileSync(join(ROOT, path), "utf8")]));
const app = (path: string) => !path.startsWith("scripts/") && !path.includes(".test.");

/** Resolve an import the way the bundler would: `@/` from the root, or relative. */
function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const base = specifier.startsWith("@/")
    ? specifier.slice(2)
    : relative(ROOT, resolve(ROOT, dirname(from), specifier));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (TEXT.has(candidate)) return candidate;
  }
  return null;
}

function importsOf(path: string): string[] {
  const text = TEXT.get(path) ?? "";
  const specifiers = [...text.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map((m) => m[1]);
  return specifiers.map((s) => resolveImport(path, s)).filter((s): s is string => s !== null);
}

/** Everything a file pulls in, transitively — the bundle it would produce. */
function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    queue.push(...importsOf(path));
  }
  return seen;
}

/**
 * A *read* of a secret, not a mention of one. `process.env.X = ...` is how the
 * test helpers plant a throwaway credential, and a comment naming a variable is
 * documentation; neither puts anything in a bundle.
 */
const holdsSecret = (path: string) =>
  SECRET_ENV.some((name) =>
    new RegExp(`process\\.env\\.${name}\\b(?!\\s*=[^=])`).test(TEXT.get(path) ?? ""),
  );

const SECRET_FILES = FILES.filter(app).filter(holdsSecret);
const CLIENT_FILES = FILES.filter(app).filter((path) =>
  /^\s*["']use client["']/m.test(TEXT.get(path) ?? ""),
);

test("the source tree is actually being scanned", () => {
  assert.ok(FILES.length > 50, `only found ${FILES.length} source files`);
  assert.ok(SECRET_FILES.length >= 3, `only found ${SECRET_FILES.length} secret readers`);
  assert.ok(CLIENT_FILES.length > 5, `only found ${CLIENT_FILES.length} client components`);
});

test("every file that reads a secret is marked server-only", () => {
  for (const path of SECRET_FILES) {
    // A route handler is server-side by construction; a library is not, and it
    // is libraries that get imported by mistake.
    if (path.startsWith("app/api/")) continue;
    assert.ok(
      /import\s+["']server-only["']/.test(TEXT.get(path) ?? ""),
      `${path} reads a secret without importing server-only`,
    );
  }
});

test("no client component can reach a secret, however indirectly", () => {
  for (const entry of CLIENT_FILES) {
    const reachable = [...graph(entry)].filter(holdsSecret);
    assert.deepEqual(
      reachable,
      [],
      `${entry} reaches ${reachable.join(", ")}, which reads a secret`,
    );
  }
});

test("no secret is given a NEXT_PUBLIC_ prefix anywhere", () => {
  for (const [path, text] of TEXT) {
    for (const name of [...SECRET_ENV, "BILLPLZ_BASE_URL", "BILLPLZ_COLLECTION_ID"]) {
      assert.ok(
        !text.includes(`NEXT_PUBLIC_${name}`),
        `${path} mentions NEXT_PUBLIC_${name}`,
      );
    }
  }
});

test("no secret value is committed to the example environment file", () => {
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  for (const name of [...SECRET_ENV, "FIREBASE_SERVICE_ACCOUNT_EMAIL"]) {
    const line = example.split("\n").find((l) => l.startsWith(`${name}=`));
    assert.equal(line, `${name}=`, `${name} in .env.example is not blank`);
  }
});

test("the Billplz secret never leaves the server as a URL, a body or a log", () => {
  const billplz = readFileSync(join(ROOT, "lib/payment/billplz.ts"), "utf8");
  // The key is HTTP Basic auth material and nothing else: it belongs in an
  // Authorization header, never in a query string or a logged line.
  assert.ok(!/console\.[a-z]+\([^)]*secretKey/.test(billplz), "the secret key is logged");
  assert.ok(!/searchParams[^\n]*secretKey/.test(billplz), "the secret key is put in a URL");
  assert.ok(/authorization: authorization\(/i.test(billplz), "the secret is not sent as a header");
});
