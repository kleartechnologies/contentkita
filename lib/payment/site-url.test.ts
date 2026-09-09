import assert from "node:assert/strict";
import test from "node:test";

import { siteUrl } from "./site-url.ts";

/**
 * Getting this wrong means a paid customer with no pack, so it is worth the
 * handful of assertions.
 */

const req = (headers: Record<string, string> = {}, url = "https://internal/api/x") =>
  new Request(url, { headers });

test("an explicitly configured site url wins", () => {
  assert.equal(
    siteUrl(req({ host: "internal" }), {
      NEXT_PUBLIC_SITE_URL: "https://kontentkita.netlify.app",
    }),
    "https://kontentkita.netlify.app",
  );
});

test("a deploy preview uses its own address, not the production one", () => {
  assert.equal(
    siteUrl(req(), {
      URL: "https://kontentkita.netlify.app",
      DEPLOY_PRIME_URL: "https://deploy-preview-7--kontentkita.netlify.app",
    }),
    "https://deploy-preview-7--kontentkita.netlify.app",
  );
});

test("trailing slashes are stripped so paths join cleanly", () => {
  assert.equal(
    siteUrl(req(), { URL: "https://kontentkita.netlify.app/" }),
    "https://kontentkita.netlify.app",
  );
});

test("with no configuration the forwarded host is used", () => {
  assert.equal(
    siteUrl(
      req({ "x-forwarded-host": "kontentkita.netlify.app", "x-forwarded-proto": "https" }),
      {},
    ),
    "https://kontentkita.netlify.app",
  );
});

test("localhost keeps http so local development works", () => {
  assert.equal(
    siteUrl(req({ host: "localhost:3000" }), {}),
    "http://localhost:3000",
  );
});

test("a host header alone is enough", () => {
  assert.equal(
    siteUrl(req({ host: "kontentkita.netlify.app" }), {}),
    "https://kontentkita.netlify.app",
  );
});
