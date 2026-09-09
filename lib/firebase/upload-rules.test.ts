import assert from "node:assert/strict";
import test from "node:test";

import { MB, UPLOAD_SPECS, objectName, storagePath, validateUpload } from "./upload-rules.ts";

/**
 * Upload validation.
 *
 * These rules exist twice on purpose — here, so the owner is told in plain
 * Malay why a file was refused before a byte is sent, and again in
 * `storage.rules`, so a client that skips this check is still refused by the
 * server. The two must agree, and the limits below are the ones the rules file
 * enforces.
 */

const file = (name: string, type: string, size: number) => ({ name, type, size });

/* --- logos ---------------------------------------------------------------- */

test("a normal PNG logo is accepted", () => {
  assert.equal(validateUpload("logo", file("logo.png", "image/png", 300_000)), null);
});

test("a JPEG logo is accepted", () => {
  assert.equal(validateUpload("logo", file("logo.jpg", "image/jpeg", 300_000)), null);
});

test("a PDF is refused as a logo", () => {
  const message = validateUpload("logo", file("logo.pdf", "application/pdf", 100_000));
  assert.equal(message, UPLOAD_SPECS.logo.typeMessage);
});

test("an SVG is refused as a logo", () => {
  // SVG is a script-carrying format; it is not on the allow list in either place.
  assert.ok(validateUpload("logo", file("logo.svg", "image/svg+xml", 4_000)));
});

test("a logo over 2MB is refused", () => {
  assert.equal(
    validateUpload("logo", file("logo.png", "image/png", 2 * MB + 1)),
    UPLOAD_SPECS.logo.sizeMessage,
  );
});

test("a logo of exactly 2MB is accepted", () => {
  assert.equal(validateUpload("logo", file("logo.png", "image/png", 2 * MB)), null);
});

/* --- menus ---------------------------------------------------------------- */

test("a PDF menu is accepted", () => {
  assert.equal(validateUpload("menu", file("menu.pdf", "application/pdf", 1_000_000)), null);
});

test("a photographed menu is accepted", () => {
  assert.equal(validateUpload("menu", file("menu.jpg", "image/jpeg", 1_000_000)), null);
});

test("a menu over 5MB is refused", () => {
  assert.equal(
    validateUpload("menu", file("menu.pdf", "application/pdf", 5 * MB + 1)),
    UPLOAD_SPECS.menu.sizeMessage,
  );
});

test("a Word document is refused as a menu", () => {
  assert.equal(
    validateUpload("menu", file("menu.docx", "application/msword", 20_000)),
    UPLOAD_SPECS.menu.typeMessage,
  );
});

test("an empty file is refused before it is uploaded", () => {
  const message = validateUpload("menu", file("menu.pdf", "application/pdf", 0));
  assert.ok(message);
  assert.notEqual(message, UPLOAD_SPECS.menu.sizeMessage);
});

test("every refusal is written in Malay, not English or a MIME type", () => {
  const messages = [
    validateUpload("logo", file("a.pdf", "application/pdf", 10)),
    validateUpload("logo", file("a.png", "image/png", 9 * MB)),
    validateUpload("menu", file("a.docx", "application/msword", 10)),
    validateUpload("menu", file("a.pdf", "application/pdf", 0)),
  ];
  for (const m of messages) {
    assert.ok(m);
    assert.ok(!/error|invalid|failed|unsupported/i.test(m), m);
    assert.ok(/[a-z]/.test(m) && m.endsWith("."), m);
  }
});

/* --- object names --------------------------------------------------------- */

test("an object name is prefixed with the upload time so replacing never collides", () => {
  const a = objectName("logo.png", 1_700_000_000_000);
  const b = objectName("logo.png", 1_700_000_000_001);

  assert.notEqual(a, b);
  assert.ok(a.startsWith("1700000000000-"));
});

test("spaces and punctuation are slugged out of the stored name", () => {
  const name = objectName("Menu Kak Ina (Final)!.PDF", 1);
  assert.match(name, /^1-[a-z0-9-]+\.pdf$/);
});

test("a path traversal attempt cannot escape the owner's folder", () => {
  const name = objectName("../../etc/passwd.png", 1);

  assert.ok(!name.includes("/"));
  assert.ok(!name.includes(".."));
  assert.equal(storagePath("uid-1", "logo", name).split("/").length, 4);
});

test("an absurdly long filename is cut to something storable", () => {
  const name = objectName(`${"a".repeat(500)}.png`, 1);
  assert.ok(name.length < 80, name);
});

test("a name with no extension still produces a usable object name", () => {
  const name = objectName("menu", 1);
  assert.ok(name.startsWith("1-"));
  assert.ok(!name.endsWith("."));
});

/* --- paths ---------------------------------------------------------------- */

test("assets are stored under the owner's own uid", () => {
  assert.equal(storagePath("uid-1", "logo", "a.png"), "restaurants/uid-1/logo/a.png");
  assert.equal(storagePath("uid-1", "menu", "a.pdf"), "restaurants/uid-1/menus/a.pdf");
});

test("two owners never share a folder", () => {
  const a = storagePath("uid-aaa", "logo", "x.png");
  const b = storagePath("uid-bbb", "logo", "x.png");

  assert.notEqual(a, b);
  assert.ok(a.startsWith("restaurants/uid-aaa/"));
  assert.ok(b.startsWith("restaurants/uid-bbb/"));
});

test("the accept attribute offered to the file picker matches the allow list", () => {
  for (const spec of Object.values(UPLOAD_SPECS)) {
    assert.deepEqual(spec.acceptAttribute.split(","), spec.accept);
  }
});
