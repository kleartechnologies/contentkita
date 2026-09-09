/**
 * Firestore's REST wire format, in both directions.
 *
 * The client SDK hides this; the REST API does not. A document over REST is
 * `{ fields: { packName: { stringValue: "…" }, days: { integerValue: "30" } } }`,
 * and every value carries its own type tag. Getting that translation wrong is
 * how a `30` becomes a `"30"` in the database and a comparison somewhere else
 * quietly stops matching, so it lives here, on its own, with tests.
 *
 * The one thing worth knowing in advance: **integers travel as JSON strings**.
 * Firestore integers are 64-bit and JSON numbers are doubles, so the API takes
 * `integerValue: "3990"`. Sending `integerValue: 3990` is accepted and reads
 * back the same, but writing an amount as a `doubleValue` would not — and an
 * amount of money must never be a double.
 *
 * Pure. No network, no credentials, no `server-only`: it is just a codec.
 */

export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

/**
 * A JavaScript value as Firestore sees it.
 *
 * `undefined` is not representable — Firestore has no such thing — so it is
 * encoded as null rather than silently dropped, which would turn "I forgot to
 * set this" into "this field does not exist" at the far end.
 */
export function toValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { nullValue: null };
    // Safe integers become integers. Anything else is a double, and nothing
    // that represents money is ever allowed down that branch — see product.ts.
    return Number.isSafeInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return { arrayValue: value.length ? { values: value.map(toValue) } : {} };
  }

  if (typeof value === "object") {
    return { mapValue: { fields: toFields(value as Record<string, unknown>) } };
  }

  // Functions, symbols, bigints: not data, and not silently coerced into it.
  return { nullValue: null };
}

/** An object as a Firestore `fields` map. */
export function toFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(data)) fields[key] = toValue(value);
  return fields;
}

/** A Firestore value back as a plain one. Unknown tags read as `null`. */
export function fromValue(value: FirestoreValue | undefined): unknown {
  if (!value || typeof value !== "object") return null;

  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("stringValue" in value) return value.stringValue;
  if ("doubleValue" in value) return value.doubleValue;
  if ("integerValue" in value) {
    // Back to a JS number, because that is what the decoders expect. A value
    // beyond 2^53 would lose precision here; nothing this product stores as an
    // integer comes close, and the alternative — handing the decoders a
    // BigInt — would break every comparison they make.
    const parsed = Number(value.integerValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(fromValue);
  if ("mapValue" in value) return fromFields(value.mapValue.fields);

  return null;
}

/** A Firestore `fields` map back as a plain object. */
export function fromFields(
  fields: Record<string, FirestoreValue> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) out[key] = fromValue(value);
  return out;
}

/** The document id — the last path segment of its resource name. */
export function documentId(name: string | undefined): string {
  if (!name) return "";
  const parts = name.split("/");
  return parts[parts.length - 1] ?? "";
}
