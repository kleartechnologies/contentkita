import "server-only";

import { accessToken, serviceAccount } from "./google-token.ts";
import {
  documentId,
  fromFields,
  toFields,
  type FirestoreDocument,
} from "./firestore-value.ts";

/**
 * Firestore over REST, for the two routes that cannot be a signed-in browser.
 *
 * Deliberately small. There is no query builder, no transaction helper and no
 * caching layer, because the server does exactly four things: read a document,
 * list a collection, and write one or several documents atomically with a
 * precondition. Anything larger would be a second data layer competing with
 * `lib/firebase/data.ts`, which is still where the product's reads and writes
 * belong.
 *
 * ## The important part: `commit` is the atomicity
 *
 * Firestore's `:commit` applies every write in one request or none of them, and
 * a `currentDocument` precondition on any write fails the whole batch. That
 * pair is what makes payment fulfilment idempotent without a lock: "create the
 * pack **only if** it does not exist **and** the order is still exactly as I
 * read it". Two callbacks racing means one commits and one gets
 * FAILED_CONDITION, which the caller reads as "already done".
 *
 * Security rules do not apply to these calls — a service account bypasses them
 * entirely. Every ownership check on this path is therefore made in code, and
 * that is precisely why so few things are allowed to run here.
 */

const BASE = "https://firestore.googleapis.com/v1";

export class FirestoreError extends Error {
  readonly status: number;
  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FirestoreError";
    this.status = status;
  }
}

/** A commit refused because the world changed underneath it. Not a failure. */
export class PreconditionFailed extends FirestoreError {
  constructor(message = "precondition failed") {
    super(message, 409);
    this.name = "PreconditionFailed";
  }
}

/**
 * The resource path of the database root: `projects/x/databases/(default)/documents`.
 *
 * Not a URL. Firestore uses this form for the `name` of every document inside a
 * request body, and rejects an absolute URL there with INVALID_ARGUMENT — the
 * URL form belongs only in the address a request is sent to.
 */
function documentsPath(projectId: string): string {
  return `projects/${projectId}/databases/(default)/documents`;
}

function documentsUrl(projectId: string): string {
  return `${BASE}/${documentsPath(projectId)}`;
}

async function call(
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const { projectId } = serviceAccount();
  const token = await accessToken(fetchImpl);

  return fetchImpl(`${documentsUrl(projectId)}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
}

/**
 * Turns a non-OK response into an error that says the status and nothing else.
 *
 * Firestore's error bodies quote document paths, which contain uids. Those
 * belong in neither an exception message nor whatever log eventually catches
 * it, so the body is read only far enough to tell a precondition failure from
 * a real one.
 */
async function fail(response: Response): Promise<never> {
  const body = await response.text().catch(() => "");
  if (response.status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS/.test(body)) {
    throw new PreconditionFailed();
  }
  throw new FirestoreError(`firestore returned ${response.status}`, response.status);
}

export interface StoredDocument {
  readonly id: string;
  readonly data: Record<string, unknown>;
  /** Firestore's version stamp, for use as a precondition on the next write. */
  readonly updateTime: string | undefined;
}

/** One document, or `null` if it is not there. */
export async function getDocument(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredDocument | null> {
  const response = await call(`/${path}`, { method: "GET" }, fetchImpl);
  if (response.status === 404) return null;
  if (!response.ok) await fail(response);

  const doc = (await response.json()) as FirestoreDocument;
  return {
    id: documentId(doc.name),
    data: fromFields(doc.fields),
    updateTime: doc.updateTime,
  };
}

/**
 * Every document in a collection, paged to the end.
 *
 * No ordering and no filter: the only collections read this way are one
 * owner's own packs and orders, which are small by construction — a customer
 * has as many packs as they have made purchases.
 */
export async function listDocuments(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredDocument[]> {
  const out: StoredDocument[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({ pageSize: "100" });
    if (pageToken) query.set("pageToken", pageToken);

    const response = await call(`/${path}?${query}`, { method: "GET" }, fetchImpl);
    // A collection that has never been written to is not an error.
    if (response.status === 404) return out;
    if (!response.ok) await fail(response);

    const body = (await response.json()) as {
      documents?: FirestoreDocument[];
      nextPageToken?: string;
    };
    for (const doc of body.documents ?? []) {
      out.push({
        id: documentId(doc.name),
        data: fromFields(doc.fields),
        updateTime: doc.updateTime,
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return out;
}

/**
 * One write in a commit.
 *
 * `mustNotExist` and `ifUnchangedSince` are the two preconditions this product
 * needs: the first says "create, and only create"; the second says "update,
 * but only if nobody has touched it since I read it".
 */
export interface Write {
  /** Document path relative to the database root, e.g. `orders/ord_abc`. */
  readonly path: string;
  readonly data: Record<string, unknown>;
  /** Fields to write. Omit to replace the document. */
  readonly merge?: readonly string[];
  readonly mustNotExist?: boolean;
  readonly ifUnchangedSince?: string;
}

/**
 * Applies every write, or none of them.
 *
 * Throws `PreconditionFailed` when a precondition rejects the batch. Callers
 * treat that as information rather than as an error: on the fulfilment path it
 * means another delivery of the same callback got there first, which is the
 * outcome we wanted.
 */
export async function commit(
  writes: readonly Write[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { projectId } = serviceAccount();
  const root = documentsPath(projectId);

  const payload = {
    writes: writes.map((write) => ({
      update: {
        name: `${root}/${write.path}`,
        fields: toFields(write.data),
      },
      ...(write.merge ? { updateMask: { fieldPaths: [...write.merge] } } : {}),
      ...(write.mustNotExist
        ? { currentDocument: { exists: false } }
        : write.ifUnchangedSince
          ? { currentDocument: { updateTime: write.ifUnchangedSince } }
          : {}),
    })),
  };

  const response = await call(
    ":commit",
    { method: "POST", body: JSON.stringify(payload) },
    fetchImpl,
  );
  if (!response.ok) await fail(response);
}
