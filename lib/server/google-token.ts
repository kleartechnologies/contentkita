import "server-only";

import { createSign } from "node:crypto";

/**
 * A Google access token, minted from a service account, on the server only.
 *
 * ## Why this exists at all
 *
 * Everything else in ContentKita writes to Firestore as the signed-in owner,
 * through their own browser, which is why there has never been an Admin SDK
 * here and why the security rules can be as simple as "the uid is in the path".
 *
 * The Billplz callback breaks that, and it has to. It is an HTTP request from
 * Billplz's servers, not from the customer — nobody is signed in, there is no
 * ID token, and the one thing that must happen is a write. So this is the
 * narrowest server credential that can do that job: one service account with
 * `roles/datastore.user` and nothing else, used by exactly two routes.
 *
 * ## Why not firebase-admin
 *
 * The same reason `lib/ai/verify.ts` verifies ID tokens over REST rather than
 * pulling in the SDK: a self-signed JWT exchanged for an access token is about
 * forty lines, and the alternative is a large dependency that wants to manage
 * app lifecycles inside a serverless function.
 *
 * ## What is never here
 *
 * The key itself. It is read from `process.env` and never logged, never
 * returned, never put in an error message, and never sent anywhere except
 * Google's token endpoint.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

/** An hour is Google's maximum; we re-mint well before it to avoid a race. */
const LIFETIME_SECONDS = 3600;
const REFRESH_MARGIN_MS = 60_000;

export class CredentialsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CredentialsError";
  }
}

export interface ServiceAccount {
  readonly email: string;
  readonly privateKey: string;
  readonly projectId: string;
}

/**
 * The service account from the environment, or an error naming what is missing.
 *
 * The private key is stored in an env var, so its newlines arrive as the two
 * characters `\` and `n` however it was pasted. Both spellings are accepted;
 * a PEM without real newlines will not parse.
 */
export function serviceAccount(): ServiceAccount {
  const email = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();

  // Names only. A message that quoted a value would put a private key into a
  // log the moment a deployment was misconfigured.
  if (!email) throw new CredentialsError("FIREBASE_SERVICE_ACCOUNT_EMAIL is not set");
  if (!rawKey) throw new CredentialsError("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY is not set");
  if (!projectId) throw new CredentialsError("NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set");

  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  if (!privateKey.includes("BEGIN")) {
    throw new CredentialsError("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY is not a PEM key");
  }

  return { email, privateKey, projectId };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The self-signed assertion Google exchanges for an access token.
 *
 * RS256 over `header.claims`, signed with the service account's private key.
 * The `scope` claim is what keeps this narrow: a token minted here can reach
 * Firestore and nothing else in the project.
 */
function assertion(account: ServiceAccount, now: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + LIFETIME_SECONDS,
    }),
  );

  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(account.privateKey);

  return `${header}.${claims}.${base64url(signature)}`;
}

/**
 * Cached across invocations that share a warm function instance.
 *
 * A token is good for an hour and minting one is a network round trip on the
 * critical path of a payment callback, which has to answer quickly. The cache
 * is per-instance and therefore best-effort — exactly like the rate limiter in
 * `lib/ai/verify.ts`, and for the same reason: it is an optimisation, and
 * nothing is trusted to it.
 */
let cached: { token: string; expiresAt: number } | null = null;

/** Test seam: forget the cached token. */
export function resetAccessToken(): void {
  cached = null;
}

export async function accessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + REFRESH_MARGIN_MS) {
    return cached.token;
  }

  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);

  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assertion(account, now),
      }).toString(),
    });
  } catch (cause) {
    throw new CredentialsError("token endpoint unreachable", { cause });
  }

  if (!response.ok) {
    // The status, never the body: Google's error responses echo parts of the
    // assertion back, and the assertion is signed with the private key.
    throw new CredentialsError(`token endpoint returned ${response.status}`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) throw new CredentialsError("token endpoint returned no token");

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? LIFETIME_SECONDS) * 1000,
  };
  return cached.token;
}
