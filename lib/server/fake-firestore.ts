import { generateKeyPairSync } from "node:crypto";

import { fromFields, toFields, type FirestoreValue } from "./firestore-value.ts";

/**
 * A Firestore REST API, in memory, for tests.
 *
 * Not a mock of our own functions — a stand-in for the *service*. The code
 * under test builds real request URLs, real commit payloads and real
 * preconditions, and this answers them the way Google would. That is the point:
 * the properties worth proving about payment fulfilment are properties of the
 * preconditions, and a mock that just recorded calls would prove none of them.
 *
 * What it implements, and no more:
 *   - the OAuth token exchange (any well-formed assertion is accepted);
 *   - `GET` one document, `GET` a collection, `POST :commit`;
 *   - `currentDocument.exists=false` and `currentDocument.updateTime`;
 *   - `updateMask` merges;
 *   - all-or-nothing commits.
 *
 * Test-only. Nothing imports it outside a `.test.ts`.
 */

export interface FakeDoc {
  fields: Record<string, FirestoreValue>;
  updateTime: string;
}

export class FakeFirestore {
  readonly docs = new Map<string, FakeDoc>();
  /** Every commit attempted, for asserting that a duplicate wrote nothing. */
  commits = 0;
  /** Set to make the next commit fail as though the network died. */
  failNextCommit = false;

  private version = 0;

  private stamp(): string {
    this.version += 1;
    // Monotonic and distinct, which is all `updateTime` has to be here.
    return new Date(1_800_000_000_000 + this.version).toISOString();
  }

  put(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, { fields: toFields(data), updateTime: this.stamp() });
  }

  read(path: string): Record<string, unknown> | null {
    const doc = this.docs.get(path);
    return doc ? fromFields(doc.fields) : null;
  }

  /** Document paths under a collection, one level deep, like Firestore's list. */
  children(collection: string): string[] {
    const prefix = `${collection}/`;
    return [...this.docs.keys()].filter(
      (path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
    );
  }

  /** A `fetch` that answers as Firestore. Pass it to anything in `lib/server`. */
  get fetch(): typeof fetch {
    return (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(typeof input === "object" && "url" in input ? input.url : input));

      if (url.hostname === "oauth2.googleapis.com") {
        return json({ access_token: "fake-token", expires_in: 3600 });
      }

      const marker = "/documents";
      const at = url.pathname.indexOf(marker);
      const tail = url.pathname.slice(at + marker.length);

      if (tail === ":commit") return this.commit(String(init.body ?? ""));
      if (init.method === "GET" || !init.method) {
        return this.get(decodeURIComponent(tail.replace(/^\//, "")));
      }
      return new Response("unsupported", { status: 405 });
    }) as unknown as typeof fetch;
  }

  private get(path: string): Response {
    const doc = this.docs.get(path);
    if (doc) return json({ name: name(path), fields: doc.fields, updateTime: doc.updateTime });

    // Not a document — try it as a collection. A collection with nothing in it
    // is an empty list, not a 404, exactly as the real API behaves.
    const paths = this.children(path);
    if (paths.length > 0 || path.split("/").length % 2 === 1) {
      return json({
        documents: paths.map((child) => ({
          name: name(child),
          fields: this.docs.get(child)!.fields,
          updateTime: this.docs.get(child)!.updateTime,
        })),
      });
    }
    return new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 });
  }

  private commit(body: string): Response {
    this.commits += 1;
    if (this.failNextCommit) {
      this.failNextCommit = false;
      return new Response("boom", { status: 500 });
    }

    const payload = JSON.parse(body) as {
      writes: {
        update: { name: string; fields: Record<string, FirestoreValue> };
        updateMask?: { fieldPaths: string[] };
        currentDocument?: { exists?: boolean; updateTime?: string };
      }[];
    };

    // Preconditions are checked for every write before any is applied: a
    // commit is atomic, and half of one would hide exactly the bug these
    // tests exist to catch.
    // The real API is strict about this and the difference is invisible in a
    // lenient fake: a document `name` is a resource path, never a URL. Getting
    // it wrong fails every write in production and none of them here.
    for (const write of payload.writes) {
      if (!write.update.name.startsWith("projects/")) {
        return invalidArgument(`Document name "${write.update.name}" lacks "projects" at index 0.`);
      }
    }

    for (const write of payload.writes) {
      const path = pathOf(write.update.name);
      const existing = this.docs.get(path);
      const pre = write.currentDocument;
      if (!pre) continue;
      if (pre.exists === false && existing) return precondition();
      if (pre.updateTime && existing?.updateTime !== pre.updateTime) return precondition();
    }

    for (const write of payload.writes) {
      const path = pathOf(write.update.name);
      const existing = this.docs.get(path);
      const mask = write.updateMask?.fieldPaths;
      const fields = mask
        ? { ...(existing?.fields ?? {}) }
        : ({} as Record<string, FirestoreValue>);
      for (const [key, value] of Object.entries(write.update.fields)) {
        if (!mask || mask.includes(key)) fields[key] = value;
      }
      this.docs.set(path, { fields, updateTime: this.stamp() });
    }

    return json({ writeResults: payload.writes.map(() => ({})) });
  }
}

const PROJECT = "test-project";

function name(path: string): string {
  return `projects/${PROJECT}/databases/(default)/documents/${path}`;
}

function pathOf(resourceName: string): string {
  return resourceName.split("/documents/")[1] ?? "";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function invalidArgument(message: string): Response {
  return new Response(
    JSON.stringify({ error: { status: "INVALID_ARGUMENT", code: 400, message } }),
    { status: 400 },
  );
}

function precondition(): Response {
  return new Response(
    JSON.stringify({ error: { status: "FAILED_PRECONDITION", message: "precondition" } }),
    { status: 400 },
  );
}

/**
 * Puts a usable service account in the environment for the duration of a test
 * file. The key is generated here and never leaves the process — there is no
 * real credential anywhere in the test suite.
 */
export function fakeCredentials(): void {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL = "test@test-project.iam.gserviceaccount.com";
  process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT;
}
