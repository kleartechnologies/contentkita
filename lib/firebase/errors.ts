/**
 * Firebase error codes translated into something a restaurant owner can act on.
 *
 * Raw SDK messages ("Firebase: Error (auth/invalid-credential).") never reach a
 * screen: they are English, they leak implementation detail, and they tell the
 * owner nothing about what to do next. Everything funnels through
 * `friendlyMessage()`, which always returns natural Malaysian BM.
 *
 * Pure by design — no SDK import — so it runs under `node --test` offline.
 */

const AUTH_MESSAGES: Record<string, string> = {
  "auth/email-already-in-use":
    "Emel ini sudah ada akaun. Cuba log masuk pula.",
  "auth/invalid-email": "Emel ini nampak tak betul.",
  "auth/missing-email": "Sila masukkan emel anda.",
  "auth/missing-password": "Sila masukkan kata laluan.",
  "auth/weak-password":
    "Kata laluan terlalu pendek. Guna sekurang-kurangnya 6 aksara.",
  // Firebase returns this instead of user-not-found / wrong-password when email
  // enumeration protection is on, so the wording must not hint which one it is.
  "auth/invalid-credential": "Emel atau kata laluan salah. Cuba lagi.",
  "auth/invalid-login-credentials": "Emel atau kata laluan salah. Cuba lagi.",
  "auth/user-not-found": "Emel atau kata laluan salah. Cuba lagi.",
  "auth/wrong-password": "Emel atau kata laluan salah. Cuba lagi.",
  "auth/user-disabled": "Akaun ini dah dinyahaktifkan.",
  "auth/too-many-requests":
    "Terlalu banyak cubaan. Tunggu sekejap, lepas tu cuba lagi.",
  "auth/network-request-failed":
    "Sambungan internet nampak terputus. Cuba lagi.",
  "auth/requires-recent-login":
    "Sila log masuk semula untuk teruskan.",
  "auth/operation-not-allowed":
    "Log masuk dengan emel belum tersedia buat masa ini.",
  "auth/internal-error": "Ada masalah teknikal. Cuba lagi sekejap lagi.",
};

const FIRESTORE_MESSAGES: Record<string, string> = {
  "permission-denied": "Anda tiada akses kepada maklumat ini.",
  unauthenticated: "Sesi anda dah tamat. Sila log masuk semula.",
  unavailable: "Sambungan ke pelayan terputus. Cuba lagi.",
  "deadline-exceeded": "Sambungan lambat sekarang. Cuba lagi.",
  "resource-exhausted": "Sistem sibuk sekejap. Cuba lagi sebentar lagi.",
  "not-found": "Maklumat ini tak dijumpai.",
  "already-exists": "Maklumat ini dah wujud.",
  aborted: "Simpanan tak sempat siap. Cuba lagi.",
  cancelled: "Permintaan dibatalkan. Cuba lagi.",
  "failed-precondition": "Ada masalah teknikal. Cuba lagi sekejap lagi.",
  internal: "Ada masalah teknikal. Cuba lagi sekejap lagi.",
};

export const GENERIC_MESSAGE = "Ada masalah teknikal. Cuba lagi sekejap lagi.";

/** Pulls the `code` off a Firebase error without trusting its shape. */
export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Always returns a sentence safe to show a user. Unknown codes fall back to the
 * generic message rather than leaking `error.message`.
 */
export function friendlyMessage(error: unknown): string {
  const code = errorCode(error);
  if (!code) return GENERIC_MESSAGE;
  return AUTH_MESSAGES[code] ?? FIRESTORE_MESSAGES[code] ?? GENERIC_MESSAGE;
}

/** True for codes worth a "try again" affordance rather than a form correction. */
export function isTransient(error: unknown): boolean {
  const code = errorCode(error);
  if (!code) return false;
  return [
    "auth/network-request-failed",
    "auth/too-many-requests",
    "unavailable",
    "deadline-exceeded",
    "resource-exhausted",
    "aborted",
    "cancelled",
    "internal",
  ].includes(code);
}
