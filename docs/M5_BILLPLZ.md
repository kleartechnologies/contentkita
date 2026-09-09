# M5 — Billplz payments and multi-pack content

ContentKita sells one thing: a **30-day content pack for RM39.90, paid once**.
There is no subscription, no recurring billing, no auto-renewal and no stored
card. A customer who wants a second month buys a second pack for another
RM39.90, and the first one is still there, untouched, forever.

This document describes how that is built, why each piece is where it is, and
what has actually been verified. It contains no secret values and never will —
every credential below is named, never quoted.

---

## 1. Architecture

Three states, deliberately kept apart:

| State | Where it lives | Who may write it |
| --- | --- | --- |
| **Payment** — money arrived | `orders/{orderId}.paymentStatus` | The server only, after a verified Billplz callback |
| **Entitlement** — one pack is owed | `contentPacks/{uid}/packs/{packId}` (payment fields) | The server only, in the same atomic commit |
| **Content** — thirty days written | the same pack document (content fields) | The owner's own browser, after generation |

Collapsing any two of these is how a customer ends up paying twice for a crash
that was ours. Because generation is a separate state from payment, a
generation that fails leaves a paid, empty pack the owner can retry for free.

The pieces:

```
browser                     server (Next.js route handlers)          Billplz
───────                     ───────────────────────────────          ───────
lib/payment/checkout.ts ──▶ app/api/payment/create/route.ts    ──▶  POST /api/v3/bills
                              lib/payment/billplz.ts   (server-only, holds the secret key)
                              lib/payment/orders.ts    (order id, pack id, price)
                              lib/server/store.ts      (Firestore, as the service account)

                    ◀────── app/api/payment/billplz/callback/route.ts  ◀── signed callback
                              lib/payment/callback.ts  (parse, believe nothing)
                              lib/payment/signature.ts (HMAC-SHA256 X Signature)
                              lib/server/firestore.ts  (atomic :commit with preconditions)
```

There is **no Firebase Admin SDK**. Server writes go through the Firestore REST
API authenticated by a service-account JWT (`lib/server/google-token.ts`),
which keeps the deployment to a single Node runtime with no native
dependencies. Security Rules do not apply to that path, which is precisely why
the rules can say "no client may ever create a pack" with no exception.

The browser never sees the Billplz secret key, the X Signature key, the bill
id or the collection id. It gets a hosted checkout URL and its own order id.

---

## 2. Firestore schema

### `orders/{orderId}` — server-written, owner-readable

`orderId` is `ord_` + 12 random bytes, hex. Unguessable, because it appears in
URLs and on the Billplz receipt.

| Field | Type | Notes |
| --- | --- | --- |
| `orderId` | string | Same as the document id |
| `ownerId` | string | The Firebase uid from the **verified ID token**, never from a request body |
| `amountSen` | integer | Always `3990`. Stored so the price at purchase is a historical fact |
| `currency` | string | `MYR` |
| `product` | string | `30_day_content_pack` |
| `paymentStatus` | `pending` \| `paid` \| `failed` \| `cancelled` | |
| `billplzBillId` | string \| null | Attached after the bill is raised |
| `billplzCollectionId` | string \| null | Checked against every callback |
| `packId` | string | `pak_` + the order id's random half — **derived, not generated** |
| `transactionId` | string \| null | From the callback |
| `createdAt` / `updatedAt` / `paidAt` | ISO 8601 strings | |

### `billplzBills/{billId}` — server-only, invisible to every client

A one-field mapping from a Billplz bill id to our order id. This is how a
callback is resolved. The payload's own `reference_1` is *not* consulted: it
arrives in the same breath as everything else an attacker would control.

### `contentPacks/{uid}/packs/{packId}` — the entitlement and the content

| Field | Written by | Notes |
| --- | --- | --- |
| `ownerId`, `packId`, `orderId`, `source`, `paymentStatus`, `paidAt`, `days`, `createdAt` | server | Immutable to the client — the rules refuse any update that touches them |
| `packName` | owner | The owner's own label. Never a payment id |
| `items[]`, `startDate`, `restaurantId`, … | owner | The thirty days, written after generation |
| `generationStatus` | owner | `awaiting_generation` \| `generating` \| `ready` \| `partial` \| `failed` |
| `updatedAt` | owner | |

`source` is `purchase` for a bought pack and `legacy` for the grandfathered
month (§11).

### `contentPacks/{uid}/packs/{packId}/creatives/{itemId}`

The designs for that pack's days. Owner-writable, owner-deletable, scoped to
the pack — a design belongs to the pack it was made in.

### `contentPlans/{uid}` — the pre-M5 plan, kept and frozen

Readable by its owner forever; **no client may write it any more**. New content
goes into a pack. Its `creatives` subcollection stays fully editable, because
those are files the owner made and freezing the plan should not freeze their
work.

---

## 3. Order lifecycle

```
                    POST /api/payment/create   (verified ID token required)
                                │
                                ▼
   orders/{id}: pending  ───────────────▶  bill raised at Billplz
                                │                     │
                                │              billplzBills/{billId} → orderId
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
  verified callback       verified callback         nothing ever
    paid=true               paid=false             (abandoned)
        │                       │                        │
        ▼                       ▼                        ▼
  paid + one pack        failed / cancelled          stays pending
                          (no pack, ever)          (no pack, ever)
```

The order is written **before** the bill is raised. If the process dies after
Billplz answers, the callback still arrives later and finds an order waiting.
The reverse ordering would produce a payment with nothing to attach it to.

An order is never reused. A second purchase is a second order with its own
derived pack id.

---

## 4. Pack lifecycle

```
  (no pack)
      │  verified payment
      ▼
  paymentStatus: paid          ← set once, by the server, never changed again
  generationStatus: awaiting_generation
      │  owner presses "Jana 30 Hari"
      ▼
  generating ──▶ ready          every day written
           └──▶ partial/failed  → retry, at no further cost
```

Two rules hold the whole product together:

1. **A pack is created exactly once.** Its id is a pure function of the order
   (`packIdForOrder`), and the create carries a "must not already exist"
   precondition. A second callback computes the same id and is refused by
   Firestore rather than making a second pack.
2. **An existing pack is never overwritten.** A new purchase creates a *new*
   document under `contentPacks/{uid}/packs/`. Nothing in the product writes
   across pack ids, and the rules forbid deleting a pack at all.

Generation failure does not touch `paymentStatus`. The owner retries from the
same paid pack, without paying again.

---

## 5. Billplz flow

1. The owner presses **Beli Pek 30 Hari — RM39.90**.
2. `startCheckout()` sends `POST /api/payment/create` with a Firebase ID token
   and **no body at all**. There is nothing for the browser to choose.
3. The server verifies the token, mints an order for `uid`, and creates a bill:

   ```
   POST {BILLPLZ_BASE_URL}/api/v3/bills
   authorization: Basic base64(BILLPLZ_SECRET_KEY + ":")
   content-type: application/x-www-form-urlencoded

   collection_id={BILLPLZ_COLLECTION_ID}
   email=<the verified account email>
   name=<the account name>
   amount=3990
   callback_url=https://<site>/api/payment/billplz/callback
   redirect_url=https://<site>/payment/result?order=ord_…
   description=ContentKita — 30 Hari Content (RM39.90)
   reference_1_label=Order&reference_1=ord_…
   ```

   `amount` is not a parameter of `createBill` — it is `PACK_PRICE_SEN`, read
   from the product definition, so there is no code path by which a caller can
   supply one.
4. The bill id is stored on the order and in `billplzBills/{billId}`.
5. The browser is sent to the hosted checkout page. **The card details never
   touch ContentKita.**
6. Billplz POSTs the signed callback to `callback_url` — this is the payment.
7. The customer is redirected to `/payment/result?order=…`, which polls *our
   own order document* until it says `paid`. The redirect's own parameters are
   never read as truth: a hand-typed `paid=true` confirms nothing.

The callback and the redirect race, and either order is fine. If the redirect
lands first the screen says "Bayaran sedang disahkan…" and keeps polling; if
the callback lands first the pack is already there when the page loads.

---

## 6. Callback verification

`app/api/payment/billplz/callback/route.ts`, in order, and the order is the
security argument:

1. **Read the body. Believe none of it.** `decodeCallback` returns the raw
   parameters alongside the decoded ones, because the signature covers the
   payload exactly as it arrived.
2. **Verify `x_signature`** against `BILLPLZ_X_SIGNATURE_KEY` using Billplz's
   documented X Signature format:
   - take every parameter except `x_signature`;
   - concatenate each as `key` immediately followed by `value`;
   - sort those strings by key, ascending, case-insensitive;
   - join with `|`;
   - HMAC-SHA256, hex.

   There is no allow-list of expected keys: Billplz signs what it sends, so
   dropping an unrecognised field would reject every real callback. The
   comparison is `timingSafeEqual` on equal-length buffers.

   A failure here returns **401 and touches no database**.
3. **Resolve the order** through our own `billplzBills/{billId}` mapping. A
   signed callback about a bill we never raised resolves to nothing and is
   answered `200` with nothing written.
4. **Check the facts** (`decideFulfilment`, a pure function):
   - `collection_id` equals `BILLPLZ_COLLECTION_ID`;
   - the bill id is the one attached to *this* order;
   - `paid` is exactly the string `"true"`;
   - the amount is exactly `3990` sen, integer-compared. `paid_amount`, when
     present, must match too.

   Anything else is a rejection: logged with a code, nothing written.
5. **Fulfil atomically** (§7).

Status codes are chosen for a retrying provider: `401` for a bad signature
(nothing to retry), `503` for a transient failure of ours (please retry — the
retry is safe because fulfilment is idempotent), and `200` for everything we
have understood and handled, including duplicates and unpaid bills.

---

## 7. Idempotency

Three independent mechanisms, any one of which is sufficient:

1. **Derived pack id.** `pak_` + the order id's random half. Two deliveries of
   the same callback compute the same pack id.
2. **Preconditions in a single atomic commit.** The Firestore `:commit`
   contains both writes:
   - the order update carries `currentDocument.updateTime = <the read version>`
     — it applies only if nobody has touched the order since;
   - the pack create carries `currentDocument.exists = false` — it applies only
     if the pack is not already there.

   Firestore applies all writes or none. A second delivery fails its
   precondition, the whole batch is rejected, and the route confirms the pack
   exists and reports `already_processed`.
3. **A status guard.** `fulfil()` returns `already` immediately if the order is
   already `paid`, before writing anything.

The net effect: **one payment, exactly one pack**, whether the callback arrives
once, twice, or twenty times, and whether or not the redirect got there first.

---

## 8. Environment variables

Set in Netlify (Site configuration → Environment variables). Names only — no
value appears in this repository, in a log, in an API response, or in a
browser.

| Name | Secret | Read by | Purpose |
| --- | --- | --- | --- |
| `BILLPLZ_BASE_URL` | no | `lib/payment/billplz.ts` | `https://www.billplz-sandbox.com` or `https://www.billplz.com` |
| `BILLPLZ_COLLECTION_ID` | no | `lib/payment/billplz.ts` | The collection bills are raised in; checked on every callback |
| `BILLPLZ_SECRET_KEY` | **yes** | `lib/payment/billplz.ts` | HTTP Basic username, empty password, when creating a bill |
| `BILLPLZ_X_SIGNATURE_KEY` | **yes** | `lib/payment/billplz.ts` | The HMAC-SHA256 key a callback is verified against |
| `FIREBASE_SERVICE_ACCOUNT_EMAIL` | **yes** | `lib/server/google-token.ts` | Server-side Firestore writes |
| `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` | **yes** | `lib/server/google-token.ts` | PEM, one line with `\n` escapes |
| `OPENAI_API_KEY` | **yes** | `lib/ai/openai.ts` | Content generation |
| `NEXT_PUBLIC_FIREBASE_*` | no | client | Public by design; access is enforced by rules |
| `NEXT_PUBLIC_SITE_URL` | no | `lib/payment/site-url.ts` | Optional. Netlify's `URL` / `DEPLOY_PRIME_URL` are used otherwise |

Rules that are enforced by a test, not by discipline
(`lib/payment/secrets.test.ts`):

- **No `NEXT_PUBLIC_` prefix on any secret.** That prefix inlines a value into
  the client bundle.
- Every module that reads a secret imports `server-only`, so an accidental
  import from a client component fails the build instead of shipping a key.
- No file reachable from any `"use client"` module, through the whole
  transitive import graph, reads a secret.
- `.env.example` lists every name with an empty value.
- `lib/payment/billplz.ts` never logs the key and never puts it in a URL.

Set values without echoing them:

```bash
netlify env:set BILLPLZ_SECRET_KEY "$(cat /path/to/key)"   # not typed inline
```

---

## 9. Sandbox setup

1. Create an account at `https://www.billplz-sandbox.com` (separate from
   production — sandbox credentials do not work against production and vice
   versa).
2. Create a **collection**; note its id.
3. From Settings, take the **Secret Key** and enable **X Signature**, taking
   the **X Signature Key**.
4. Put them in `.env.local` (gitignored) — never in a source file, never in a
   commit, never pasted into a chat or an issue:

   ```
   BILLPLZ_BASE_URL=https://www.billplz-sandbox.com
   BILLPLZ_COLLECTION_ID=…
   BILLPLZ_SECRET_KEY=…
   BILLPLZ_X_SIGNATURE_KEY=…
   ```
5. Billplz must be able to reach `callback_url`, so a local run needs a public
   tunnel; set `NEXT_PUBLIC_SITE_URL` to the tunnel's address, or test against
   a Netlify deploy preview which is public already.
6. Pay a sandbox bill and confirm: the callback is logged as `fulfilled`, the
   order becomes `paid`, and exactly one pack appears.

Automated tests do **not** need any of this. `npm run test:flow` runs a local
Billplz stand-in (`scripts/stub-billplz.mjs`) which mints its own keys per run
and signs callbacks with the same X Signature algorithm.

**Real sandbox verification against Billplz's own servers has not been
performed — no sandbox credentials were available.** See §13.

---

## 10. Production setup

1. A live Billplz account, a live collection, X Signature enabled.
2. In Netlify, on the production site only, set the four `BILLPLZ_*` variables
   with `BILLPLZ_BASE_URL=https://www.billplz.com`.
3. Confirm the four names are present **before** announcing payments. A missing
   one fails the first request with `PAYMENT_CONFIG_ERROR` rather than limping
   on with a default — there is no safe default for a payment provider.
4. Register the callback URL implicitly: it is sent per bill as
   `callback_url=https://kontentkita.netlify.app/api/payment/billplz/callback`.
   Nothing needs configuring in the Billplz dashboard.
5. Redeploy so the runtime picks up the variables.
6. Make one real RM39.90 purchase and refund it, or use Billplz's own live test
   facilities. Confirm one pack, one order, one callback.

Nothing switches between sandbox and production automatically. It is a
deliberate, human change of a deployed variable.

---

## 11. Migration strategy

Owners who had content before payments existed keep it, free.

- `POST /api/packs/migrate` (authenticated) copies `contentPlans/{uid}` into
  `contentPacks/{uid}/packs/legacy` with `source: "legacy"`,
  `paymentStatus: "paid"`, `orderId: null`, and the plan's original
  `createdAt`, so the owner's history stays true.
- The creatives under the old plan are copied to the pack, and **the originals
  are left in place**. Nothing is deleted, ever. If the migration is ever
  wrong, the original is exactly where it was.
- It runs on the server, not in the browser, so the rules can forbid clients
  from creating packs at all — otherwise a new account could mint itself a free
  entitlement from the console.
- It is idempotent: the destination id is fixed (`legacy`) and the write
  demands the document not already exist, so a second call reports what the
  first did.
- `contentPlans/{uid}` is now frozen by the rules: readable, never writable.

---

## 12. Security model

**What is never trusted:** a browser's `paid=true`; a redirect URL; a
client-supplied amount, price, owner id or order status; the callback's
`reference_1`; the callback payload before its signature checks out.

**What is trusted:** a Firebase ID token verified server-side against Google's
public keys, and a callback whose `x_signature` matches an HMAC-SHA256
computed with `BILLPLZ_X_SIGNATURE_KEY`.

Layers:

1. **The bundle.** Secrets are `server-only` and provably unreachable from any
   client module — asserted by a static import-graph test, not by convention.
2. **The route.** `/api/payment/create` requires a bearer ID token (401
   without) and takes no parameters at all. Amount, product, owner and order id
   are all decided server-side.
3. **The callback.** Signature first, database second. Then collection, bill,
   owner and an exact `3990` integer comparison.
4. **The database.** Firestore Security Rules, deployed to
   `contentkita-8fcf8`:
   - `contentPacks/{uid}/packs/{packId}`: `get`/`list` for the owner;
     `create: false` and `delete: false` for everyone; `update` only when
     signed in as `uid`, with `ownerId` matching, with
     `paymentStatus == 'paid'` already stored, and touching none of
     `ownerId`, `packId`, `orderId`, `source`, `paymentStatus`, `paidAt`,
     `days`, `createdAt`.
   - `orders/{orderId}`: `get` only, only when `resource.data.ownerId` is the
     caller. No `list`, no writes at all.
   - `billplzBills/{billId}`: no client read, no client write.
   - `contentPlans/{uid}`: `get` only; writes frozen.
   - A final catch-all denies everything else.
5. **Money as an integer.** RM39.90 is `3990` sen everywhere. No floating-point
   amount exists in the codebase; `Number("39.90")` comparisons are impossible
   because the value is never a decimal string.

**Logging.** Payment logs carry `event, orderId, billId, packId, status,
result, ms` and nothing else. Never the secret key, the signature key, an
authorization header, the raw callback body, or the customer's email or name.
Errors reaching a browser are a stable code plus a Malay sentence; Billplz
errors, Firestore internals and stack traces stay on the server.

---

## 13. Test results

Run on 2026-09-10 against Next.js 16.3.4, Node's test runner, a real Chrome via
CDP, and the real Firebase project `contentkita-8fcf8`.

| Suite | Command | Result |
| --- | --- | --- |
| Unit / integration | `npm test` | **426 passed, 0 failed** |
| Types | `npm run typecheck` | **clean** |
| Lint | `npm run lint` | **clean** |
| Production build | `npm run build` | **succeeded** |
| Real-browser end-to-end | `npm run test:flow` | **62 passed, 0 failed, 0 blocked of 62 steps** |
| Responsive layout | `npm run test:responsive` | **132 passed, 0 failed** (360 / 768 / 1280 px) |
| Real Firebase rules | `npm run verify:firebase` | **100 passed, 0 failed, 0 skipped** |
| Billplz sandbox | manual, §9 | **BLOCKED — see below** |

The end-to-end suite covers the numbered payment and multi-pack requirements of
the milestone: a server-raised bill for exactly 3990 sen, a callback signed with
the wrong key refused, a hand-typed `paid=true` redirect refusing to confirm
anything, three deliveries of the same callback producing exactly one pack,
generation only from a paid pack, a second purchase creating a second pack, and
the first pack coming back afterwards with its name, its thirty designs, its
edit and its caption intact. The Firebase suite covers the same ground from the
rules' side, including a second owner who can neither read, list, write nor
rename another owner's pack, order or design.

### Billplz sandbox — BLOCKED

Real Billplz sandbox credentials were not available for this milestone. In
accordance with the brief, the test was **not faked**. What has been verified
is everything that does not require Billplz's servers:

- the bill-creation request's method, URL, Basic authorization construction,
  and exact `amount=3990` body (`lib/payment/billplz.test.ts`);
- X Signature computation against the worked example in Billplz's own
  documentation, plus rejection of modified, missing and truncated signatures
  (`lib/payment/signature.test.ts`);
- the complete callback path end to end against a local Billplz stand-in that
  signs with the same algorithm, including duplicate delivery, redirect-first
  and callback-first ordering, wrong collection, wrong amount, unknown bill and
  unpaid states.

**What remains unverified: that Billplz's own servers accept our bill-creation
request and that a real Billplz callback verifies against a real X Signature
Key.** Production payments must not be announced until §10 has been walked with
real credentials.

---

## 14. Manual deployment checklist

Before deploying:

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test:flow`
- [ ] `npm run test:responsive`
- [ ] `npm run verify:firebase`
- [ ] `git status` clean of `.env`, `.env.local`, service-account JSON, private
      keys
- [ ] `git diff` searched for `BILLPLZ_SECRET_KEY=`, `BILLPLZ_X_SIGNATURE_KEY=`,
      `PRIVATE KEY`, `BEGIN PRIVATE KEY`, `OPENAI_API_KEY=`

Deploying:

- [ ] Commit to `main` in the existing repository
      (`github.com/kleartechnologies/contentkita`)
- [ ] Push; Netlify builds the existing site (`kontentkita.netlify.app`).
      Do not create another site or another repository
- [ ] `firebase deploy --only firestore:rules --project contentkita-8fcf8`
      — **required**: the M5 rules freeze `contentPlans` and open
      `contentPacks`, and the app cannot work without them

Before activating production payments:

- [ ] `BILLPLZ_BASE_URL`, `BILLPLZ_COLLECTION_ID`, `BILLPLZ_SECRET_KEY`,
      `BILLPLZ_X_SIGNATURE_KEY` all present in the production Netlify
      environment
- [ ] `BILLPLZ_BASE_URL` is `https://www.billplz.com`, changed deliberately by
      a human
- [ ] `FIREBASE_SERVICE_ACCOUNT_EMAIL` and
      `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` present, on a service account
      holding `roles/datastore.user` and nothing more
- [ ] One real purchase completed and confirmed: bill → verified callback →
      order `paid` → exactly one pack

After deploying:

- [ ] `/payment/result` reachable, and a paid order settles on it
- [ ] The dashboard shows RM39.90 and the words
      "Sekali bayar. Tiada langganan. Tiada caj bulanan."
- [ ] Callback logs show `[payment] callback fulfilled` with an order and a
      pack id, and no payload contents
