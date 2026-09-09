/**
 * The allow-list for the image proxy in `app/api/asset/route.ts`.
 *
 * It lives here, apart from the route, because it is the security boundary of
 * that route and boundaries deserve tests. `url` arrives from the browser, so
 * anything this function lets through is something the deployment will fetch
 * on a stranger's behalf.
 */

/** `null` when the URL is not one of this project's own Storage objects. */
export function allowedAssetUrl(raw: string, bucket: string): URL | null {
  if (!bucket) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.hostname !== "firebasestorage.googleapis.com") return null;

  const prefix = `/v0/b/${bucket}/o/`;
  if (!url.pathname.startsWith(prefix)) return null;

  // The object path is percent-encoded inside the URL path. Only the area the
  // Storage rules let an owner write to is reachable.
  let object: string;
  try {
    object = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }
  if (!object.startsWith("restaurants/")) return null;
  if (object.includes("..")) return null;

  // The download token is the capability. Without one there is nothing being
  // presented, so there is nothing to proxy.
  if (!url.searchParams.get("token")) return null;

  return url;
}
