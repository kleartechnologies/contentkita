/**
 * What payment failures are allowed to say out loud.
 *
 * Two audiences, and they must never be given the same text. A stable code is
 * for us: it goes in the log line and in the JSON body so a support question
 * can be answered from a grep. A Malay sentence is for the restaurant owner,
 * who cannot act on "HTTP 422 from bills endpoint" and should not be shown it.
 *
 * Nothing from Billplz, Firestore or a stack trace reaches the browser through
 * here. That is not tidiness — a provider error can carry a bill id, an email,
 * or the shape of our own configuration, and an error body is the easiest
 * place in a system to leak something by accident.
 */

export type PaymentErrorCode =
  /** A required Billplz or Firebase server variable is missing or malformed. */
  | "PAYMENT_CONFIG_ERROR"
  /** Billplz would not create the bill. */
  | "PAYMENT_CREATE_FAILED"
  /** The callback's x_signature did not match. Nothing was believed. */
  | "PAYMENT_SIGNATURE_INVALID"
  /** No order of ours matches this bill. */
  | "PAYMENT_NOT_FOUND"
  /** The bill was paid, but not for RM39.90. */
  | "PAYMENT_AMOUNT_MISMATCH"
  /** This payment has already been fulfilled. Not a failure; a no-op. */
  | "PAYMENT_ALREADY_PROCESSED"
  /** The pack asked for does not exist, or does not belong to the caller. */
  | "PACK_NOT_FOUND"
  /** No verified Firebase user on a request that requires one. */
  | "PAYMENT_UNAUTHENTICATED"
  /** Well-formed request, unusable contents. */
  | "PAYMENT_BAD_REQUEST"
  /** Something else broke. Deliberately says nothing about what. */
  | "PAYMENT_UNAVAILABLE";

const MESSAGES: Record<PaymentErrorCode, string> = {
  PAYMENT_CONFIG_ERROR:
    "Sistem bayaran belum sedia. Kami sedang perbaiki — cuba lagi sekejap lagi.",
  PAYMENT_CREATE_FAILED:
    "Tak dapat buka halaman bayaran sekarang. Cuba lagi sekejap lagi.",
  PAYMENT_SIGNATURE_INVALID:
    "Pengesahan bayaran gagal. Kalau duit dah ditolak, hubungi kami.",
  PAYMENT_NOT_FOUND: "Kami tak jumpa rekod bayaran ini.",
  PAYMENT_AMOUNT_MISMATCH:
    "Jumlah bayaran tak sepadan. Hubungi kami dan kami akan semak.",
  PAYMENT_ALREADY_PROCESSED: "Bayaran ini dah diproses.",
  PACK_NOT_FOUND: "Pek content ini tak dijumpai.",
  PAYMENT_UNAUTHENTICATED: "Sila log masuk dulu.",
  PAYMENT_BAD_REQUEST: "Permintaan tak lengkap. Muat semula halaman dan cuba lagi.",
  PAYMENT_UNAVAILABLE: "Ada masalah teknikal. Cuba lagi sekejap lagi.",
};

/** The owner-facing sentence for a code. Always Malay, always safe to display. */
export function paymentMessage(code: PaymentErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.PAYMENT_UNAVAILABLE;
}

/**
 * A payment failure with a code the browser is allowed to see.
 *
 * `cause` is for the server log only. It never crosses the wire, which is why
 * it is a separate field rather than folded into the message.
 */
export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly status: number;

  constructor(code: PaymentErrorCode, status = 400, cause?: unknown) {
    super(code, { cause });
    this.name = "PaymentError";
    this.code = code;
    this.status = status;
  }
}

/** The exact body every payment route returns when something goes wrong. */
export function paymentErrorBody(code: PaymentErrorCode): {
  error: PaymentErrorCode;
  message: string;
} {
  return { error: code, message: paymentMessage(code) };
}
