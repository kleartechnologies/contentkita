/**
 * Where Billplz should send the customer, and where it should send the truth.
 *
 * Both URLs are absolute and must be right on the first try: a wrong
 * `callback_url` means a payment that never becomes a pack, and nobody finds
 * out until a customer complains. So the value is taken from configuration
 * where there is any, and otherwise reconstructed from the request the browser
 * just made — which is correct for local development and for deploy previews,
 * where a hardcoded production URL would be wrong.
 *
 * The forwarded headers are only trusted for choosing between our own hosts.
 * Nothing security-relevant is decided from them: the callback is verified by
 * signature and the redirect is not payment authority, so the worst a spoofed
 * `x-forwarded-host` can achieve is a bill whose callback goes nowhere and a
 * customer whose payment is never fulfilled — which is the payer's own loss and
 * changes nobody's entitlement.
 */

/**
 * Just enough of the environment to name our own site.
 *
 * A loose record rather than `ProcessEnv`: Next generates a typed environment
 * from the variables it knows about, and Netlify's `URL` and `DEPLOY_PRIME_URL`
 * are injected at runtime rather than declared anywhere it can see.
 */
export type SiteEnv = Record<string, string | undefined>;

/** Trailing slashes removed, so joining a path never doubles the separator. */
function clean(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function siteUrl(request: Request, env: SiteEnv = process.env as SiteEnv): string {
  // Netlify sets URL to the site's primary address and DEPLOY_PRIME_URL to the
  // address of this particular deploy. The deploy-specific one is what a
  // preview should use.
  const configured =
    env.NEXT_PUBLIC_SITE_URL || env.DEPLOY_PRIME_URL || env.URL;
  if (configured?.startsWith("http")) return clean(configured);

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return clean(`${proto}://${host}`);
  }

  return clean(new URL(request.url).origin);
}
