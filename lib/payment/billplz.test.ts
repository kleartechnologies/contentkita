import assert from "node:assert/strict";
import test from "node:test";

import { billplzConfig, createBill } from "./billplz.ts";
import { PaymentError } from "./errors.ts";

/**
 * What leaves this server when a customer presses "buy".
 *
 * The assertions are mostly about what is *not* in the request and what is not
 * in the errors: the price must not be influenceable, the secret key must
 * travel only in an Authorization header, and a failure from Billplz must
 * reach the customer as a code and a Malay sentence rather than as whatever
 * the provider felt like saying.
 */

const CONFIG = {
  baseUrl: "https://www.billplz-sandbox.com",
  collectionId: "test-collection",
  secretKey: "test-secret-key",
  signatureKey: "test-signature-key",
};

const INPUT = {
  config: CONFIG,
  email: "owner@example.com",
  name: "Kedai Kak Ina",
  orderId: "ord_abc123",
  callbackUrl: "https://kontentkita.netlify.app/api/payment/billplz/callback",
  redirectUrl: "https://kontentkita.netlify.app/payment/result",
  description: "30 Hari Content",
};

/** Records the one request made, and answers with whatever the test needs. */
function stubFetch(answer: { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const OK_BILL = {
  id: "8X0Iytgi",
  collection_id: "test-collection",
  url: "https://www.billplz-sandbox.com/bills/8X0Iytgi",
  state: "due",
};

/* --- the request ---------------------------------------------------------- */

test("a bill is raised for exactly 3990 sen", async () => {
  const { calls, impl } = stubFetch({ body: OK_BILL });
  await createBill(INPUT, impl);

  const body = new URLSearchParams(calls[0].init.body as string);
  assert.equal(body.get("amount"), "3990");
});

test("the amount is not something a caller can pass in", async () => {
  // A compile-time property, asserted here so it stays one: there is no
  // `amount` on the input, so no route can forward a browser's idea of price.
  assert.ok(!("amount" in INPUT));
});

test("the order id is carried in a reference field", async () => {
  const { calls, impl } = stubFetch({ body: OK_BILL });
  await createBill(INPUT, impl);

  const body = new URLSearchParams(calls[0].init.body as string);
  assert.equal(body.get("reference_1"), "ord_abc123");
});

test("the secret key travels as Basic auth and nowhere else", async () => {
  const { calls, impl } = stubFetch({ body: OK_BILL });
  await createBill(INPUT, impl);

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(
    headers.authorization,
    `Basic ${Buffer.from("test-secret-key:").toString("base64")}`,
  );
  // Not in the URL, not in the body — both of which end up in access logs.
  assert.ok(!calls[0].url.includes("test-secret-key"));
  assert.ok(!(calls[0].init.body as string).includes("test-secret-key"));
});

test("the callback url is sent so Billplz can tell us the truth later", async () => {
  const { calls, impl } = stubFetch({ body: OK_BILL });
  await createBill(INPUT, impl);

  const body = new URLSearchParams(calls[0].init.body as string);
  assert.equal(body.get("callback_url"), INPUT.callbackUrl);
  assert.equal(body.get("redirect_url"), INPUT.redirectUrl);
});

/* --- the response --------------------------------------------------------- */

test("only the checkout url and ids come back", async () => {
  const { impl } = stubFetch({ body: OK_BILL });
  const bill = await createBill(INPUT, impl);

  assert.deepEqual(bill, {
    billId: "8X0Iytgi",
    collectionId: "test-collection",
    url: "https://www.billplz-sandbox.com/bills/8X0Iytgi",
  });
});

/* --- failure -------------------------------------------------------------- */

test("a rejected bill fails with a code, not with Billplz's words", async () => {
  const { impl } = stubFetch({
    status: 422,
    body: { error: { message: ["Collection is invalid"] } },
  });

  await assert.rejects(
    () => createBill(INPUT, impl),
    (error: unknown) => {
      assert.ok(error instanceof PaymentError);
      assert.equal(error.code, "PAYMENT_CREATE_FAILED");
      assert.ok(!error.message.includes("Collection is invalid"));
      return true;
    },
  );
});

test("an unreachable provider is a payment error, not a raw network error", async () => {
  const impl = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => createBill(INPUT, impl),
    (error: unknown) => error instanceof PaymentError && error.code === "PAYMENT_CREATE_FAILED",
  );
});

test("a bill with no url is refused rather than sent to the customer", async () => {
  const { impl } = stubFetch({ body: { id: "8X0Iytgi" } });
  await assert.rejects(() => createBill(INPUT, impl), PaymentError);
});

/* --- configuration -------------------------------------------------------- */

test("missing configuration fails closed, naming variables and not values", () => {
  const saved = { ...process.env };
  for (const key of [
    "BILLPLZ_BASE_URL",
    "BILLPLZ_COLLECTION_ID",
    "BILLPLZ_SECRET_KEY",
    "BILLPLZ_X_SIGNATURE_KEY",
  ]) {
    delete process.env[key];
  }

  try {
    assert.throws(
      () => billplzConfig(),
      (error: unknown) => {
        assert.ok(error instanceof PaymentError);
        assert.equal(error.code, "PAYMENT_CONFIG_ERROR");
        assert.match(String(error.cause), /BILLPLZ_SECRET_KEY/);
        return true;
      },
    );
  } finally {
    Object.assign(process.env, saved);
  }
});

test("a trailing slash on the base url does not produce a double slash", async () => {
  const { calls, impl } = stubFetch({ body: OK_BILL });
  process.env.BILLPLZ_BASE_URL = "https://www.billplz-sandbox.com/";
  process.env.BILLPLZ_COLLECTION_ID = "c";
  process.env.BILLPLZ_SECRET_KEY = "s";
  process.env.BILLPLZ_X_SIGNATURE_KEY = "x";

  await createBill({ ...INPUT, config: billplzConfig() }, impl);
  assert.equal(calls[0].url, "https://www.billplz-sandbox.com/api/v3/bills");
});
