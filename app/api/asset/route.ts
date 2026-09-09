/**
 * Serves an owner's own uploaded image from this origin.
 *
 * ## Why this exists
 *
 * A creative is exported by drawing it into a `<canvas>` and calling
 * `toBlob()`. The moment an image from another origin is drawn into a canvas
 * the browser marks it tainted and `toBlob()` throws — which would mean the
 * owner's logo and their food photo are exactly what stops them downloading
 * their poster. Firebase Storage download URLs are on
 * `firebasestorage.googleapis.com`, so they are another origin, and the bucket
 * does not serve CORS headers by default.
 *
 * Proxying the bytes through this route makes them same-origin. Nothing else
 * about them changes.
 *
 * ## Why this is not an open door
 *
 * A Firebase download URL already contains a per-object token, and that token
 * *is* the capability: anyone holding the URL can fetch the object straight
 * from Google without going near this app. So this route grants no access that
 * the caller did not already have, and it deliberately grants no more:
 *
 *   - the host must be Firebase Storage, and the bucket must be ours;
 *   - the path must be inside `restaurants/`, which is the only area an owner
 *     can write to;
 *   - a download token must be present, so an unguessable URL stays the thing
 *     being presented;
 *   - only image responses are passed through, and only up to a size a poster
 *     could plausibly use.
 *
 * What it must never become is a general fetcher: `url` comes from the browser,
 * so anything less strict than an allow-list here is a server-side request
 * forgery against whatever else is reachable from the deployment.
 */

import { allowedAssetUrl } from "@/lib/creative/asset-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous for a 5MB upload limit, small enough to be a real ceiling. */
const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  // Read literally rather than through a helper, so Next can inline it. This
  // is the public bucket name, not a credential.
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";
  const target = allowedAssetUrl(raw, bucket);
  if (!target) return new Response("Not an allowed asset", { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      signal: request.signal,
      // The token in the URL is the only credential involved; nothing from this
      // request's own headers should be forwarded to Google.
      headers: { accept: ALLOWED_TYPES.join(",") },
      cache: "no-store",
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    // Google's own status is passed through for 404 and 403 so the browser can
    // tell "deleted" from "broken", but its body never is.
    const status = upstream.status === 404 || upstream.status === 403 ? upstream.status : 502;
    return new Response(null, { status });
  }

  const type = (upstream.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!ALLOWED_TYPES.includes(type)) {
    return new Response("Not an image", { status: 415 });
  }

  const length = Number(upstream.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) return new Response("Too large", { status: 413 });

  return new Response(upstream.body, {
    headers: {
      "content-type": type,
      // Private: the URL carries a token, so a shared cache must not hold it.
      "cache-control": "private, max-age=3600",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
