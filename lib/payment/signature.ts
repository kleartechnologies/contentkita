import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Billplz X Signature — the only thing that makes a callback believable.
 *
 * A callback arrives as an ordinary HTTP POST from the internet. Anyone who
 * knows the URL can send one, and a forged one claiming `paid=true` would hand
 * out a pack for free. What separates a real callback from a forgery is that
 * Billplz signs the payload with a key only Billplz and this server hold, so
 * everything below exists to reconstruct that signature and compare it.
 *
 * The documented algorithm, exactly:
 *
 *   1. Take every parameter except `x_signature`.
 *   2. Concatenate each one as `key` immediately followed by `value`.
 *   3. Sort those strings by key, ascending, case-insensitive.
 *   4. Join with `|`.
 *   5. HMAC-SHA256 with the X Signature Key, hex encoded.
 *
 * Note what is *not* here: no allow-list of expected keys. Billplz signs what
 * it sends, so dropping an unrecognised field — a new one they add later, say —
 * would compute a different source string and reject every real callback. The
 * signature covers the payload as received or it covers nothing.
 *
 * Pure apart from `node:crypto`, so it is unit-testable offline against the
 * worked example in Billplz's own documentation.
 */

/**
 * The source string a signature is computed over.
 *
 * Sorting is case-insensitive per the specification, with the raw string as a
 * tie-break so two keys differing only in case cannot make the result depend on
 * the order they happened to arrive in.
 */
export function signatureSource(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => key !== "x_signature")
    .sort((a, b) => {
      const la = a.toLowerCase();
      const lb = b.toLowerCase();
      if (la < lb) return -1;
      if (la > lb) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map((key) => `${key}${params[key]}`)
    .join("|");
}

/** The signature Billplz would have sent for these parameters. Hex, lower case. */
export function signPayload(
  params: Record<string, string>,
  signatureKey: string,
): string {
  return createHmac("sha256", signatureKey)
    .update(signatureSource(params), "utf8")
    .digest("hex");
}

/**
 * Whether the received signature is the one this payload should carry.
 *
 * Compared with `timingSafeEqual` rather than `===`. A string comparison stops
 * at the first differing byte, and the time it took to stop is a measurement of
 * how many leading characters were right — enough, over many attempts, to
 * reconstruct a valid signature one character at a time. Lengths are checked
 * first because `timingSafeEqual` throws on a mismatch, and the length of a
 * hex digest is public knowledge anyway.
 */
export function verifySignature(
  params: Record<string, string>,
  received: string | null | undefined,
  signatureKey: string,
): boolean {
  if (!received || !signatureKey) return false;

  const expected = signPayload(params, signatureKey);
  // Lower-cased because hex has two spellings and Billplz's choice of one is
  // not a security property.
  const supplied = received.trim().toLowerCase();
  if (supplied.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8"));
}
