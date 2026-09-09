import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { allowedAssetUrl } from "./asset-url.ts";

const BUCKET = "example-bucket.firebasestorage.app";
const OK = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/restaurants%2Fuid-1%2Fcreatives%2Fayam.jpg?alt=media&token=abc-123`;

test("an owner's own Storage object is proxied", () => {
  const url = allowedAssetUrl(OK, BUCKET);

  assert.ok(url);
  assert.equal(url.hostname, "firebasestorage.googleapis.com");
});

/**
 * `url` arrives from the browser, so everything below is a request the
 * deployment would otherwise make on a stranger's behalf.
 */
test("the proxy is not a general fetcher", () => {
  const refused = [
    "http://firebasestorage.googleapis.com/v0/b/x/o/restaurants%2Fa?token=t",
    "https://evil.example.com/v0/b/x/o/restaurants%2Fa?token=t",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
    "https://firebasestorage.googleapis.com/../../etc/passwd",
    "not a url at all",
  ];

  for (const raw of refused) {
    assert.equal(allowedAssetUrl(raw, BUCKET), null, raw);
  }
});

test("another project's bucket is not ours to serve", () => {
  const other = OK.replace(BUCKET, "someone-else.firebasestorage.app");

  assert.equal(allowedAssetUrl(other, BUCKET), null);
});

test("only the area an owner can write to is reachable", () => {
  const outside = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/secrets%2Fkeys.json?token=t`;
  const traversal = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/restaurants%2F..%2Fsecrets?token=t`;

  assert.equal(allowedAssetUrl(outside, BUCKET), null);
  assert.equal(allowedAssetUrl(traversal, BUCKET), null);
});

test("a URL with no download token is not a URL anyone was given", () => {
  assert.equal(allowedAssetUrl(OK.replace(/&token=abc-123/, ""), BUCKET), null);
});

test("an unconfigured bucket proxies nothing at all", () => {
  assert.equal(allowedAssetUrl(OK, ""), null);
});

/* --- the rules the creative engine depends on ----------------------------- */

function rules(name: string): string {
  return readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
}

/**
 * Read rather than executed — there is no emulator in this suite — so this
 * catches the regression that matters: someone deleting or loosening the block
 * while moving code around. The live behaviour is covered by the flow script.
 */
test("creatives live under the owner's own uid, and are checked against it", () => {
  const text = rules("firestore.rules");

  assert.match(text, /match \/creatives\/\{itemId\}/);
  assert.match(text, /allow get, list: if signedInAs\(uid\)/);
  assert.match(text, /allow create, update: if signedInAs\(uid\) && ownedBy\(uid\)/);
});

test("creative uploads are images, size-capped, and owner-scoped", () => {
  const text = rules("storage.rules");

  assert.match(text, /match \/restaurants\/\{uid\}\/creatives\/\{fileName\}/);
  assert.match(
    text,
    /creatives\/\{fileName\} \{\s*\n\s*allow read: if signedInAs\(uid\);\s*\n\s*allow write: if signedInAs\(uid\) && isImage\(\) && sized\(5 \* 1024 \* 1024\);/,
  );
});
