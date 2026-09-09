import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { signPayload, signatureSource, verifySignature } from "./signature.ts";

/**
 * The one check standing between a stranger's HTTP request and a free pack.
 *
 * The callback URL is public. Anybody can POST `paid=true` to it, so the tests
 * below are less about "does HMAC work" than about the two ways a signature
 * check is usually wrong in practice: the source string is built differently
 * from the provider's, so every real callback is rejected; or the comparison is
 * loose enough that a forgery is accepted.
 */

const KEY = "test-x-signature-key";

/**
 * A representative Billplz X Signature callback body. Values are invented; the
 * shape and key names are the documented ones.
 */
const CALLBACK = {
  id: "8X0Iytgi",
  collection_id: "inbmmepb",
  paid: "true",
  state: "paid",
  amount: "3990",
  paid_amount: "3990",
  due_at: "2026-09-30",
  email: "owner@example.com",
  mobile: "",
  name: "OWNER",
  url: "https://www.billplz.com/bills/8X0Iytgi",
  paid_at: "2026-09-10 04:22:11 +0800",
  transaction_id: "6TSHTBSA",
  transaction_status: "completed",
};

/* --- the source string ---------------------------------------------------- */

test("keys are concatenated, sorted and joined with a pipe", () => {
  assert.equal(
    signatureSource({ b: "2", a: "1", c: "3" }),
    "a1|b2|c3",
  );
});

test("x_signature is excluded from the string it signs", () => {
  const withSig = signatureSource({ ...CALLBACK, x_signature: "deadbeef" });
  assert.equal(withSig, signatureSource(CALLBACK));
  assert.ok(!withSig.includes("deadbeef"));
});

test("sorting is case-insensitive", () => {
  // A case-sensitive sort puts every capital before every lower-case letter,
  // which would order these "Bb|aa" instead.
  assert.equal(signatureSource({ aa: "", B: "b" }), "aa|Bb");
});

test("keys differing only in case sort deterministically", () => {
  // Insertion order must not decide the result, or the same payload could
  // produce two different signatures.
  const one = signatureSource({ Amount: "1", amount: "2" });
  const other = signatureSource({ amount: "2", Amount: "1" });
  assert.equal(one, other);
});

test("empty values are kept, as the key with nothing after it", () => {
  // Dropping empty fields is the classic way to build a source string that
  // never matches: Billplz signs `mobile` whether or not the payer gave one.
  assert.ok(signatureSource(CALLBACK).includes("|mobile|"));
});

test("a value containing a pipe is not escaped away", () => {
  // Documented behaviour: the separator is not escaped. What matters is that
  // both sides compute the same thing, which they do because both use this.
  assert.equal(signatureSource({ a: "x|y" }), "ax|y");
});

/* --- signing -------------------------------------------------------------- */

test("the signature is HMAC-SHA256 of the source string, hex", () => {
  const expected = createHmac("sha256", KEY)
    .update(signatureSource(CALLBACK), "utf8")
    .digest("hex");
  assert.equal(signPayload(CALLBACK, KEY), expected);
});

/* --- verifying ------------------------------------------------------------ */

test("a genuine callback verifies", () => {
  const x_signature = signPayload(CALLBACK, KEY);
  assert.equal(verifySignature({ ...CALLBACK, x_signature }, x_signature, KEY), true);
});

test("a forged paid=true is rejected", () => {
  // The attack this whole file exists for: take a real callback for an unpaid
  // bill, flip one field, keep the signature.
  const x_signature = signPayload({ ...CALLBACK, paid: "false", state: "due" }, KEY);
  assert.equal(verifySignature({ ...CALLBACK, x_signature }, x_signature, KEY), false);
});

test("a tampered amount is rejected", () => {
  const x_signature = signPayload(CALLBACK, KEY);
  const cheap = { ...CALLBACK, amount: "100", paid_amount: "100", x_signature };
  assert.equal(verifySignature(cheap, x_signature, KEY), false);
});

test("a signature from a different key is rejected", () => {
  const x_signature = signPayload(CALLBACK, "somebody-elses-key");
  assert.equal(verifySignature({ ...CALLBACK, x_signature }, x_signature, KEY), false);
});

test("a missing signature is rejected rather than treated as blank", () => {
  assert.equal(verifySignature(CALLBACK, null, KEY), false);
  assert.equal(verifySignature(CALLBACK, undefined, KEY), false);
  assert.equal(verifySignature(CALLBACK, "", KEY), false);
});

test("an absent signing key rejects everything, including the right answer", () => {
  // Fail closed: a deployment missing BILLPLZ_X_SIGNATURE_KEY must hand out
  // nothing, not accept anything.
  const x_signature = signPayload(CALLBACK, KEY);
  assert.equal(verifySignature({ ...CALLBACK, x_signature }, x_signature, ""), false);
});

test("a short or long signature is rejected without throwing", () => {
  // timingSafeEqual throws on unequal lengths; the length check must come
  // first, and truncation must not be read as a prefix match.
  const x_signature = signPayload(CALLBACK, KEY);
  assert.equal(verifySignature(CALLBACK, x_signature.slice(0, 32), KEY), false);
  assert.equal(verifySignature(CALLBACK, `${x_signature}00`, KEY), false);
});

test("hex case and surrounding whitespace do not change the verdict", () => {
  const x_signature = signPayload(CALLBACK, KEY);
  assert.equal(verifySignature(CALLBACK, ` ${x_signature.toUpperCase()} `, KEY), true);
});
