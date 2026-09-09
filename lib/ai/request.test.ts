import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { LIMITS, MAX_DAYS, RequestError, decodeGenerationRequest } from "./request.ts";

/**
 * The server's untrusted-input boundary.
 *
 * Everything here arrives from a browser. Three properties matter and are
 * asserted below: the owner is whoever the verified token says (never the
 * body), free text is clamped so one request cannot become an arbitrarily
 * expensive one, and uploaded assets are reduced to presence so a file can
 * never become a source of facts in the prompt.
 */

const UID = "uid-owner-1";

const body = (over: Record<string, unknown> = {}) => ({
  mode: "plan",
  days: 30,
  startDate: "2026-03-01",
  restaurant: { ...DEMO_RESTAURANT, ...(over.restaurant as object ?? {}) },
  ...over,
});

/* --- ownership ------------------------------------------------------------ */

test("the owner id comes from the token, never from the body", () => {
  const decoded = decodeGenerationRequest(
    body({ restaurant: { ...DEMO_RESTAURANT, id: "somebody-elses-uid" } }),
    UID,
  );

  assert.equal(decoded.restaurant.id, UID);
});

/* --- required fields ------------------------------------------------------ */

test("a body that is not an object is refused", () => {
  assert.throws(() => decodeGenerationRequest("plan please", UID), RequestError);
  assert.throws(() => decodeGenerationRequest(null, UID), RequestError);
});

test("a request with no restaurant is refused", () => {
  assert.throws(() => decodeGenerationRequest({ mode: "plan" }, UID), RequestError);
});

test("a restaurant with no name or cuisine is refused", () => {
  assert.throws(
    () => decodeGenerationRequest(body({ restaurant: { ...DEMO_RESTAURANT, name: "  " } }), UID),
    RequestError,
  );
  assert.throws(
    () => decodeGenerationRequest(body({ restaurant: { ...DEMO_RESTAURANT, cuisine: "" } }), UID),
    RequestError,
  );
});

/* --- clamping ------------------------------------------------------------- */

test("a pasted novel in menu notes is cut to the documented limit", () => {
  const decoded = decodeGenerationRequest(
    body({ restaurant: { ...DEMO_RESTAURANT, menuNotes: "a".repeat(50_000) } }),
    UID,
  );

  assert.equal(decoded.restaurant.menuNotes.length, LIMITS.menuNotes);
});

test("the best seller list is capped in both length and item size", () => {
  const decoded = decodeGenerationRequest(
    body({
      restaurant: {
        ...DEMO_RESTAURANT,
        bestSellers: Array.from({ length: 40 }, (_, i) => `Hidangan ${i} ${"x".repeat(200)}`),
      },
    }),
    UID,
  );

  assert.equal(decoded.restaurant.bestSellers.length, LIMITS.dishes);
  for (const dish of decoded.restaurant.bestSellers) {
    assert.ok(dish.length <= LIMITS.dish);
  }
});

test("duplicate dishes are collapsed regardless of case", () => {
  const decoded = decodeGenerationRequest(
    body({
      restaurant: {
        ...DEMO_RESTAURANT,
        bestSellers: ["Nasi Lemak", "nasi lemak", " NASI LEMAK ", "Mee Goreng"],
      },
    }),
    UID,
  );

  assert.deepEqual(decoded.restaurant.bestSellers, ["Nasi Lemak", "Mee Goreng"]);
});

test("a request for more than a month is clamped to 30 days", () => {
  assert.equal(decodeGenerationRequest(body({ days: 3650 }), UID).days, MAX_DAYS);
  assert.equal(decodeGenerationRequest(body({ days: 0 }), UID).days, MAX_DAYS);
  assert.equal(decodeGenerationRequest(body({ days: "many" }), UID).days, MAX_DAYS);
});

test("a valid shorter plan is honoured", () => {
  assert.equal(decodeGenerationRequest(body({ days: 7 }), UID).days, 7);
});

/* --- enums ---------------------------------------------------------------- */

test("an unknown tone, language or visual style falls back to a safe default", () => {
  const decoded = decodeGenerationRequest(
    body({
      restaurant: {
        ...DEMO_RESTAURANT,
        tone: "aggressive",
        language: "de",
        visualStyle: "cyberpunk",
      },
    }),
    UID,
  );

  assert.equal(decoded.restaurant.tone, "friendly");
  assert.equal(decoded.restaurant.language, "ms");
  assert.equal(decoded.restaurant.visualStyle, "hangat");
});

test("unknown platforms are dropped and an empty list defaults to Instagram", () => {
  const decoded = decodeGenerationRequest(
    body({ restaurant: { ...DEMO_RESTAURANT, platforms: ["threads", "myspace"] } }),
    UID,
  );

  assert.deepEqual(decoded.restaurant.platforms, ["instagram"]);
});

test("known platforms survive decoding", () => {
  const decoded = decodeGenerationRequest(
    body({ restaurant: { ...DEMO_RESTAURANT, platforms: ["tiktok", "whatsapp", "nonsense"] } }),
    UID,
  );

  assert.deepEqual(decoded.restaurant.platforms, ["tiktok", "whatsapp"]);
});

test("an empty copy style list defaults to santai", () => {
  const decoded = decodeGenerationRequest(
    body({ restaurant: { ...DEMO_RESTAURANT, copyStyles: [] } }),
    UID,
  );

  assert.deepEqual(decoded.restaurant.copyStyles, ["santai"]);
});

/* --- promotions ----------------------------------------------------------- */

test("promotion dates and conditions are dropped when there is no promotion", () => {
  const decoded = decodeGenerationRequest(
    body({
      restaurant: {
        ...DEMO_RESTAURANT,
        promotion: "",
        promotionDates: "Setiap hari",
        promotionConditions: "Dine-in sahaja",
      },
    }),
    UID,
  );

  assert.equal(decoded.restaurant.promotion, null);
  assert.equal(decoded.restaurant.promotionDates, "");
  assert.equal(decoded.restaurant.promotionConditions, "");
});

test("a real promotion keeps its dates and conditions", () => {
  const decoded = decodeGenerationRequest(body(), UID);

  assert.equal(decoded.restaurant.promotion, "Set Lunch RM12.90");
  assert.equal(decoded.restaurant.promotionConditions, "Dine-in sahaja");
});

/* --- assets --------------------------------------------------------------- */

test("an uploaded asset is reduced to presence, carrying no url or path", () => {
  const decoded = decodeGenerationRequest(
    body({
      restaurant: {
        ...DEMO_RESTAURANT,
        logo: {
          path: "restaurants/someone-else/logo/a.png",
          url: "https://example.com/secret.png",
          name: "a.png",
          contentType: "image/png",
          size: 10,
          uploadedAt: "2026-01-01T00:00:00.000Z",
        },
        menuFile: { path: "x", url: "https://example.com/menu.pdf" },
      },
    }),
    UID,
  );

  assert.ok(decoded.restaurant.logo);
  assert.equal(decoded.restaurant.logo.url, "");
  assert.equal(decoded.restaurant.logo.path, "");
  assert.ok(decoded.restaurant.menuFile);
  assert.equal(decoded.restaurant.menuFile.url, "");

  // Nothing that could reach a third party carries a link to the owner's files.
  assert.ok(!JSON.stringify(decoded).includes("example.com"));
});

test("no asset means no asset", () => {
  const decoded = decodeGenerationRequest(body(), UID);

  assert.equal(decoded.restaurant.logo, null);
  assert.equal(decoded.restaurant.menuFile, null);
});

/* --- day requests --------------------------------------------------------- */

test("a days request with no valid days is refused", () => {
  assert.throws(
    () => decodeGenerationRequest(body({ mode: "days", targetDays: [] }), UID),
    RequestError,
  );
  assert.throws(
    () => decodeGenerationRequest(body({ mode: "days", targetDays: [0, 99, "x"] }), UID),
    RequestError,
  );
});

test("a regenerate request cannot ask for the whole month at single-day prices", () => {
  const decoded = decodeGenerationRequest(
    body({ mode: "days", targetDays: Array.from({ length: 30 }, (_, i) => i + 1) }),
    UID,
  );

  assert.ok(decoded.targetDays.length <= 5);
});

test("target days are deduplicated and sorted", () => {
  const decoded = decodeGenerationRequest(
    body({ mode: "days", targetDays: [7, 3, 7, 3] }),
    UID,
  );

  assert.deepEqual(decoded.targetDays, [3, 7]);
});

test("an unknown mode is treated as a full plan", () => {
  assert.equal(decodeGenerationRequest(body({ mode: "everything" }), UID).mode, "plan");
});

/* --- dates ---------------------------------------------------------------- */

test("a malformed start date falls back to today rather than being trusted", () => {
  const decoded = decodeGenerationRequest(body({ startDate: "next tuesday" }), UID);

  assert.match(decoded.startDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("a valid start date is kept exactly", () => {
  assert.equal(decodeGenerationRequest(body({ startDate: "2026-12-25" }), UID).startDate, "2026-12-25");
});

/* --- avoid list ----------------------------------------------------------- */

test("the avoid list is bounded so it cannot inflate the prompt", () => {
  const decoded = decodeGenerationRequest(
    body({ avoid: Array.from({ length: 500 }, (_, i) => `hook ${i} ${"x".repeat(400)}`) }),
    UID,
  );

  assert.ok(decoded.avoid.length <= 40);
  for (const hook of decoded.avoid) assert.ok(hook.length <= 200);
});
