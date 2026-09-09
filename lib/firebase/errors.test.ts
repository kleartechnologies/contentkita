import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERIC_MESSAGE,
  errorCode,
  friendlyMessage,
  isTransient,
} from "./errors.ts";

/** Shaped like a FirebaseError without importing the SDK. */
function firebaseError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

test("known auth failures get a plain-language Malay message", () => {
  const cases = [
    "auth/email-already-in-use",
    "auth/invalid-email",
    "auth/weak-password",
    "auth/invalid-credential",
    "auth/user-not-found",
    "auth/wrong-password",
    "auth/too-many-requests",
    "auth/network-request-failed",
  ];

  for (const code of cases) {
    const message = friendlyMessage(firebaseError(code, `Firebase: ${code}`));
    assert.notEqual(message, GENERIC_MESSAGE, `${code} needs its own wording`);
    assert.ok(!message.includes("Firebase"), `${code} leaks the SDK name`);
    assert.ok(!message.includes("auth/"), `${code} leaks the error code`);
  }
});

test("a wrong password and an unknown email read identically", () => {
  // Different wording would tell a stranger which emails have accounts.
  const wrong = friendlyMessage(firebaseError("auth/wrong-password", "x"));
  const missing = friendlyMessage(firebaseError("auth/user-not-found", "x"));
  const invalid = friendlyMessage(firebaseError("auth/invalid-credential", "x"));

  assert.equal(wrong, missing);
  assert.equal(wrong, invalid);
});

test("a permission failure is explained, not dumped", () => {
  const message = friendlyMessage(
    firebaseError("permission-denied", "Missing or insufficient permissions."),
  );
  assert.notEqual(message, GENERIC_MESSAGE);
  assert.ok(!message.includes("permission"), "raw wording leaked through");
  assert.ok(!message.includes("Missing"), "raw wording leaked through");
});

test("an unrecognised failure falls back instead of showing its own message", () => {
  assert.equal(
    friendlyMessage(firebaseError("auth/some-future-code", "Internal token error")),
    GENERIC_MESSAGE,
  );
  assert.equal(friendlyMessage(new Error("TypeError: undefined is not a function")), GENERIC_MESSAGE);
  assert.equal(friendlyMessage("something went wrong"), GENERIC_MESSAGE);
  assert.equal(friendlyMessage(null), GENERIC_MESSAGE);
});

test("error codes are read only from a real code field", () => {
  assert.equal(errorCode(firebaseError("auth/invalid-email", "x")), "auth/invalid-email");
  assert.equal(errorCode(new Error("auth/invalid-email")), null);
  assert.equal(errorCode({}), null);
  assert.equal(errorCode(undefined), null);
});

test("connection problems are marked worth retrying, refusals are not", () => {
  assert.equal(isTransient(firebaseError("auth/network-request-failed", "x")), true);
  assert.equal(isTransient(firebaseError("unavailable", "x")), true);
  assert.equal(isTransient(firebaseError("permission-denied", "x")), false);
  assert.equal(isTransient(firebaseError("auth/wrong-password", "x")), false);
});
