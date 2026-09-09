import "server-only";

/**
 * Who is calling the generation route.
 *
 * The route spends money on the owner's behalf, so it must not accept an
 * anonymous request. The caller's Firebase ID token is verified with Google's
 * Identity Toolkit, which checks the signature, the issuer, the audience and
 * the expiry — a forged or stale token is refused by Google, not by us.
 *
 * This is deliberately not the Firebase Admin SDK. Admin would mean shipping a
 * service-account private key into the deployment for one check that a public
 * endpoint already performs, and this project has no other need for server-side
 * Firebase credentials. The Web API key used below is the same public value
 * already in the browser bundle; it identifies the project and grants nothing.
 */

const LOOKUP = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

export interface Caller {
  uid: string;
  email: string;
}

export class AuthError extends Error {
  readonly code: "unauthenticated" | "unavailable" | "misconfigured";

  constructor(code: AuthError["code"], message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

/** Pulls the bearer token off the request without trusting its shape. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function verifyIdToken(idToken: string): Promise<Caller> {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!key) {
    throw new AuthError("misconfigured", "NEXT_PUBLIC_FIREBASE_API_KEY is not set");
  }
  if (!idToken) throw new AuthError("unauthenticated", "No token supplied");

  let response: Response;
  try {
    response = await fetch(`${LOOKUP}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AuthError("unavailable", "Could not reach Google to verify the token");
  }

  if (!response.ok) {
    // Google returns 400 for expired, malformed and forged tokens alike. All
    // three mean the same thing to us: sign in again.
    throw new AuthError("unauthenticated", `Token rejected (${response.status})`);
  }

  const payload = (await response.json()) as {
    users?: { localId?: string; email?: string; disabled?: boolean }[];
  };
  const user = payload.users?.[0];
  if (!user?.localId) throw new AuthError("unauthenticated", "Token matched no user");
  if (user.disabled) throw new AuthError("unauthenticated", "Account is disabled");

  return { uid: user.localId, email: user.email ?? "" };
}

/* ------------------------------- rate limit ------------------------------- */

/**
 * A small per-owner budget, counted in days written rather than requests made.
 *
 * Days are the thing that costs money, and a request is no longer a fixed
 * amount of them: a month arrives as several batches because a single
 * whole-month call cannot finish inside the platform's response limit. Counting
 * requests would therefore have quietly multiplied the ceiling by the batch
 * count. The cap is the same spend it always was — about a dozen months an hour
 * — however the client chooses to divide it up.
 *
 * In-memory and per-instance on purpose: it is a cost guard for a launch MVP,
 * not a distributed quota system, and it does the job without adding a
 * datastore.
 */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_DAYS_PER_WINDOW = 400;

const spend = new Map<string, { at: number; days: number }[]>();

/**
 * Records `days` against this owner and says whether they were affordable.
 *
 * A request that would cross the ceiling is refused whole rather than trimmed:
 * a half-written batch is not something the caller asked for.
 */
export function withinBudget(uid: string, days: number): boolean {
  const now = Date.now();
  const recent = (spend.get(uid) ?? []).filter((e) => now - e.at < WINDOW_MS);

  const used = recent.reduce((total, e) => total + e.days, 0);
  const allowed = used + days <= MAX_DAYS_PER_WINDOW;
  if (allowed) recent.push({ at: now, days });

  spend.set(uid, recent);
  return allowed;
}
