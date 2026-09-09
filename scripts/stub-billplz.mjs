/**
 * A local stand-in for Billplz.
 *
 * ContentKita's payment path can only be exercised end to end by a server that
 * raises bills, hosts a checkout page and posts a signed callback back. The
 * real one is Billplz, and pressing "pay" there — even in the sandbox — needs
 * merchant credentials that live outside this repository, so a developer
 * machine cannot drive the flow against it and must never drive it against
 * production, where the money is real.
 *
 * So this serves the same three surfaces on localhost:
 *
 *   POST /api/v3/bills      HTTP Basic with the secret key, form-encoded, and
 *                           a JSON bill back with an id and a checkout URL.
 *   GET  /bills/:id         the hosted page the customer is sent to.
 *   POST /bills/:id/pay     what pressing "pay" does: fire the server-to-server
 *                           callback first, then redirect the browser back.
 *
 * What that gets tested is everything that matters on our side: the create
 * route, HTTP Basic auth, the amount, our own bill→order mapping, the X
 * Signature algorithm, the callback route, idempotency, fulfilment, and a
 * result page that believes none of the query string. What it does NOT test is
 * Billplz itself — whether their sandbox accepts our field names, what their
 * live callback really contains, whether FPX settles. Those remain unverified
 * until someone runs a real sandbox bill, and the suite says so rather than
 * implying otherwise.
 *
 * The keys are generated per run by the caller and are not credentials: they
 * unlock a process that is thrown away when the run ends. They are read from
 * this process's own environment, exactly as the real ones are, so the code
 * under test cannot tell the difference.
 *
 *   node scripts/stub-billplz.mjs [port]
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8118);

const COLLECTION = process.env.BILLPLZ_COLLECTION_ID ?? "";
const SECRET = process.env.BILLPLZ_SECRET_KEY ?? "";
const SIGNING = process.env.BILLPLZ_X_SIGNATURE_KEY ?? "";

if (!COLLECTION || !SECRET || !SIGNING) {
  console.error(
    "stub billplz: BILLPLZ_COLLECTION_ID, BILLPLZ_SECRET_KEY and" +
      " BILLPLZ_X_SIGNATURE_KEY must all be set",
  );
  process.exit(1);
}

/** Every bill this run has raised, by id. Memory only; nothing is persisted. */
const bills = new Map();

/** Milliseconds to hold a callback back, so the redirect can arrive first. */
let callbackDelayMs = 0;

/** Billplz's own signing, reimplemented from their documentation. */
function sign(params, key) {
  const source = Object.keys(params)
    .filter((k) => k !== "x_signature")
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0))
    .map((k) => `${k}${params[k]}`)
    .join("|");
  return createHmac("sha256", key).update(source, "utf8").digest("hex");
}

/** The username of HTTP Basic, compared without leaking its length in time. */
function authorised(header) {
  const value = String(header ?? "");
  if (!value.startsWith("Basic ")) return false;
  const user = Buffer.from(value.slice(6), "base64").toString("utf8").split(":")[0];
  const a = Buffer.from(user, "utf8");
  const b = Buffer.from(SECRET, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function body(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

/** Two decimal places from sen, for the page a human reads. */
function ringgit(sen) {
  return `RM${(sen / 100).toFixed(2)}`;
}

function escape(text) {
  return String(text).replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The callback, posted server to server, exactly as the real one arrives:
 * form-encoded, signed, and carrying Billplz's own verdict rather than ours.
 */
async function fireCallback(bill, { key = SIGNING, claimPaid = false } = {}) {
  const paid = bill.paid || claimPaid;
  const params = {
    id: bill.id,
    collection_id: bill.collectionId,
    paid: paid ? "true" : "false",
    state: paid ? "paid" : "due",
    amount: String(bill.amount),
    paid_amount: String(paid ? bill.amount : 0),
    due_at: bill.dueAt,
    email: bill.email,
    mobile: "",
    name: bill.name,
    url: `http://127.0.0.1:${port}/bills/${bill.id}`,
    paid_at: bill.paidAt ?? new Date().toISOString().replace("T", " ").slice(0, 19) + " +0800",
    transaction_id: bill.transactionId ?? "FORGED0000000000",
    transaction_status: paid ? "completed" : "pending",
  };
  params.x_signature = sign(params, key);

  const response = await fetch(bill.callbackUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  }).catch((error) => ({ status: 0, error }));

  console.log(
    `  stub billplz: callback bill=${bill.id} paid=${params.paid}` +
      `${key === SIGNING ? "" : " signed-with-wrong-key"} -> ${response.status}`,
  );
  return response.status;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname;

  /* --- the API ---------------------------------------------------------- */

  if (req.method === "POST" && path === "/api/v3/bills") {
    if (!authorised(req.headers.authorization)) {
      return json(res, 401, { error: { message: "unauthorized" } });
    }
    const form = new URLSearchParams(await body(req));
    if (form.get("collection_id") !== COLLECTION) {
      return json(res, 422, { error: { message: "collection_id invalid" } });
    }
    const amount = Number(form.get("amount"));
    if (!Number.isInteger(amount) || amount < 100) {
      return json(res, 422, { error: { message: "amount invalid" } });
    }

    const id = randomBytes(6).toString("base64url");
    const bill = {
      id,
      collectionId: COLLECTION,
      amount,
      email: form.get("email") ?? "",
      name: form.get("name") ?? "",
      callbackUrl: form.get("callback_url") ?? "",
      redirectUrl: form.get("redirect_url") ?? "",
      description: form.get("description") ?? "",
      reference1: form.get("reference_1") ?? "",
      dueAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      paid: false,
      paidAt: null,
      transactionId: null,
    };
    bills.set(id, bill);
    console.log(`  stub billplz: bill ${id} for ${amount} sen (ref ${bill.reference1})`);

    return json(res, 200, {
      id,
      collection_id: COLLECTION,
      paid: false,
      state: "due",
      amount,
      due_at: bill.dueAt,
      email: bill.email,
      name: bill.name,
      url: `http://127.0.0.1:${port}/bills/${id}`,
    });
  }

  /* --- the hosted page -------------------------------------------------- */

  const checkout = /^\/bills\/([A-Za-z0-9_-]+)$/.exec(path);
  if (req.method === "GET" && checkout) {
    const bill = bills.get(checkout[1]);
    if (!bill) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<h1>Bill not found</h1>");
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Billplz (local stub)</title>
<style>body{font:16px system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#f4f5f7}
main{background:#fff;padding:32px;border-radius:12px;box-shadow:0 1px 4px #0002;max-width:420px}
button{font:inherit;padding:12px 20px;border-radius:8px;border:0;cursor:pointer;margin-right:8px}
.pay{background:#0a7d43;color:#fff}.cancel{background:#eee}</style></head>
<body><main>
<p><strong>Billplz — local stub.</strong> No money exists here.</p>
<h1>${escape(bill.description || "Bill")}</h1>
<p>${escape(bill.name)} &lt;${escape(bill.email)}&gt;</p>
<p>Amount: <strong>${ringgit(bill.amount)}</strong> (${bill.amount} sen)</p>
<form method="POST" action="/bills/${bill.id}/pay">
  <button class="pay" type="submit" name="outcome" value="paid">Bayar ${ringgit(bill.amount)}</button>
  <button class="cancel" type="submit" name="outcome" value="cancelled">Batal bayaran</button>
</form>
</main></body></html>`);
  }

  const pay = /^\/bills\/([A-Za-z0-9_-]+)\/pay$/.exec(path);
  if (req.method === "POST" && pay) {
    const bill = bills.get(pay[1]);
    if (!bill) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<h1>Bill not found</h1>");
    }
    const outcome = new URLSearchParams(await body(req)).get("outcome");
    if (outcome === "paid" && !bill.paid) {
      bill.paid = true;
      bill.paidAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " +0800";
      bill.transactionId = randomBytes(8).toString("hex").toUpperCase();
    }

    // The callback first, as Billplz usually does: the customer's browser
    // arrives at our result page after the truth has already been delivered.
    //
    // `callbackDelayMs` reproduces the other ordering, which is the one that
    // actually tests something. A slow callback means the customer is looking
    // at the result page before any payment has been confirmed, and a product
    // that took the redirect at its word would show them a pack that does not
    // exist yet. Fired without awaiting, so the redirect goes out first.
    if (callbackDelayMs > 0) {
      const delay = callbackDelayMs;
      setTimeout(() => {
        fireCallback(bill).catch((error) => {
          console.log(`  stub billplz: delayed callback failed — ${error.message}`);
        });
      }, delay);
      console.log(`  stub billplz: callback for ${bill.id} held back ${delay}ms`);
    } else {
      await fireCallback(bill);
    }

    const back = new URL(bill.redirectUrl);
    const redirect = {
      id: bill.id,
      paid_at: bill.paidAt ?? "",
      paid: bill.paid ? "true" : "false",
    };
    const signature = sign(
      Object.fromEntries(Object.entries(redirect).map(([k, v]) => [`billplz${k}`, v])),
      SIGNING,
    );
    for (const [key, value] of Object.entries(redirect)) {
      back.searchParams.set(`billplz[${key}]`, value);
    }
    back.searchParams.set("billplz[x_signature]", signature);

    res.writeHead(302, { location: back.toString() });
    return res.end();
  }

  /* --- control surface, for the test harness only ------------------------ */

  // How long to hold a callback back, so a run can put the redirect first.
  if (req.method === "POST" && path === "/__delay") {
    const ms = Number(new URLSearchParams(await body(req)).get("ms") ?? 0);
    callbackDelayMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
    return json(res, 200, { callbackDelayMs });
  }

  if (req.method === "GET" && path === "/__bills") {
    return json(res, 200, {
      bills: [...bills.values()].map((b) => ({
        id: b.id,
        amount: b.amount,
        paid: b.paid,
        reference1: b.reference1,
        callbackUrl: b.callbackUrl,
        redirectUrl: b.redirectUrl,
      })),
    });
  }

  // Re-deliver a callback (Billplz retries), or deliver the callback an
  // internet stranger would send: paid=true for a bill nobody paid, signed with
  // a key that is not ours.
  const again = /^\/__(replay|forge)\/([A-Za-z0-9_-]+)$/.exec(path);
  if (req.method === "POST" && again) {
    const bill = bills.get(again[2]);
    if (!bill) return json(res, 404, { error: "no such bill" });
    const forged = again[1] === "forge";
    const status = await fireCallback(bill, {
      key: forged ? randomBytes(32).toString("hex") : SIGNING,
      claimPaid: forged,
    });
    return json(res, 200, { status });
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found" } }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`stub Billplz listening on http://127.0.0.1:${port}`);
});
