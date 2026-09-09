/**
 * Reading a Billplz callback without believing any of it yet.
 *
 * This file does one job: turn `application/x-www-form-urlencoded` bytes into
 * a typed record. It decides nothing. Whether the payment happened is settled
 * by `verifySignature` over the *raw* parameters, and whether it entitles
 * anybody to anything is settled later against our own order.
 *
 * The raw parameters are therefore returned alongside the decoded ones, because
 * the signature covers the payload exactly as it arrived. Normalising first and
 * signing the normalised version would verify a message Billplz never sent.
 */

export interface BillplzCallback {
  /** The parameters exactly as received. What the signature is checked over. */
  readonly params: Record<string, string>;
  /** `x_signature`, pulled out for convenience. Not trusted here. */
  readonly signature: string | null;
  /** Billplz's bill id — our only reliable link back to an order. */
  readonly billId: string;
  readonly collectionId: string;
  /** Billplz's own verdict. Meaningless until the signature checks out. */
  readonly paid: boolean;
  readonly state: string;
  /** The bill's amount, in sen. Integer, never a float. */
  readonly amountSen: number | null;
  /** What was actually paid, in sen. Usually equal to `amountSen`. */
  readonly paidAmountSen: number | null;
  readonly paidAt: string | null;
  readonly transactionId: string | null;
  readonly transactionStatus: string | null;
}

/**
 * Form body → flat string map.
 *
 * Billplz posts callbacks with flat keys (`id`, `paid`, …) and sends the
 * redirect back with wrapped ones (`billplz[id]`). Only the callback is ever
 * payment authority, but unwrapping costs nothing and turns a shape surprise
 * into a parse rather than a silent "no bill id".
 */
export function formParams(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const wrapped = /^billplz\[(.+)\]$/.exec(key);
    params[wrapped ? wrapped[1] : key] = value;
  }
  return params;
}

/**
 * Sen as an integer, or null.
 *
 * Anything that is not a run of digits is refused rather than coerced:
 * `Number("39.90")` would quietly produce a number a hundred times too small,
 * and `parseInt("39.90")` a number that looks plausible and is wrong.
 */
function sen(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Decodes a callback body. Throws nothing — an unusable body decodes to nulls. */
export function decodeCallback(body: string): BillplzCallback {
  const params = formParams(body);

  return {
    params,
    signature: params.x_signature ?? null,
    billId: params.id ?? "",
    collectionId: params.collection_id ?? "",
    // Billplz sends the string "true". Anything else — including "1", a
    // missing field, or a truthy-looking "paid" — is not a yes.
    paid: params.paid === "true",
    state: params.state ?? "",
    amountSen: sen(params.amount),
    paidAmountSen: sen(params.paid_amount),
    paidAt: params.paid_at || null,
    transactionId: params.transaction_id || null,
    transactionStatus: params.transaction_status || null,
  };
}
