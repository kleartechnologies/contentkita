/**
 * Starts the production build against the local provider stub.
 *
 * `next start`, not `next dev`: the flow suite should exercise the same bundle
 * that gets deployed. Firebase is the real `contentkita-8fcf8` project — the
 * brief asks for the flow to run against real infrastructure, and a rules
 * mistake is exactly the kind of thing an emulator would hide.
 *
 * Two things are stubbed, and only two: the AI provider and Billplz. Both for
 * the same reason — their credentials live in the Netlify environment and are
 * deliberately not here — and Billplz for one more: a real bill, even a sandbox
 * one, is somebody's account, and a live one is somebody's money. Everything
 * between the browser and `lib/ai/openai.ts`, and everything between the
 * browser and `lib/payment/*`, is the real code path.
 *
 * The Billplz keys are minted per run with `randomBytes`. They are not
 * credentials and unlock nothing outside this process; they exist because the
 * code refuses to run without them, which is behaviour worth keeping under
 * test.
 *
 * Set `FLOW_ORIGIN` to run the suite against an already-deployed site instead.
 * Nothing is started or stubbed then: the provider, the build and the platform
 * limits are all the real ones, which is the only way to find out whether a
 * deploy actually works. It writes to the real project, so the throwaway
 * account it creates still has to be cleaned up afterwards.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reads `.env.local` without pulling in a dotenv dependency. */
export async function localEnv() {
  const out = {};
  if (!existsSync(".env.local")) return out;
  for (const line of (await readFile(".env.local", "utf8")).split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function waitForHttp(url, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  throw new Error(`${label} did not come up at ${url}`);
}

/**
 * Boots the stub and the app, and returns a `stop()` that kills both.
 *
 * The stub key is a fixed placeholder. It is not a credential and grants
 * nothing — it exists only because the transport refuses to run without one,
 * which is a behaviour worth keeping under test.
 */
export async function startApp({ appPort = 3117, stubPort = 8117, billplzPort = 8118 } = {}) {
  const deployed = process.env.FLOW_ORIGIN?.trim();
  if (deployed) {
    // A deployed site talks to whichever Billplz its own environment names, and
    // paying a bill there is not something a test may do on its own initiative.
    await waitForHttp(deployed, "deployed site");
    return { origin: deployed.replace(/\/$/, ""), stubbed: false, billplz: null, stop() {} };
  }

  if (!existsSync(".next")) {
    throw new Error("No production build found. Run `npm run build` first.");
  }

  const stub = spawn("node", ["scripts/stub-openai.mjs", String(stubPort)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  stub.stdout.setEncoding("utf8");
  stub.stdout.on("data", (chunk) => process.stdout.write(chunk));

  // Thrown away when this process ends. Both halves are handed to the stub and
  // to the app, and to nothing else — they are never written to a file.
  const billplzEnv = {
    BILLPLZ_BASE_URL: `http://127.0.0.1:${billplzPort}`,
    BILLPLZ_COLLECTION_ID: `flow${randomBytes(4).toString("hex")}`,
    BILLPLZ_SECRET_KEY: randomBytes(24).toString("hex"),
    BILLPLZ_X_SIGNATURE_KEY: randomBytes(32).toString("hex"),
  };

  const billplz = spawn("node", ["scripts/stub-billplz.mjs", String(billplzPort)], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, ...billplzEnv },
  });
  billplz.stdout.setEncoding("utf8");
  billplz.stdout.on("data", (chunk) => process.stdout.write(chunk));

  const origin = `http://127.0.0.1:${appPort}`;

  const app = spawn("npx", ["next", "start", "-p", String(appPort)], {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      ...(await localEnv()),
      OPENAI_API_KEY: "local-stub-key-not-a-credential",
      OPENAI_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
      // Last, so a real key that happens to be in .env.local cannot be the one
      // this run bills against.
      ...billplzEnv,
      // The bill's callback and redirect have to come back to this process, not
      // to whatever public address .env.local names.
      NEXT_PUBLIC_SITE_URL: origin,
    },
  });

  try {
    await waitForHttp(`http://127.0.0.1:${stubPort}/v1/chat/completions`, "stub");
    await waitForHttp(`http://127.0.0.1:${billplzPort}/__bills`, "billplz stub");
    await waitForHttp(origin, "next start");
  } catch (error) {
    stub.kill();
    billplz.kill();
    app.kill();
    throw error;
  }

  return {
    origin,
    stubbed: true,
    /** The harness's handle on the stubbed provider. Null against a deploy. */
    billplz: {
      origin: `http://127.0.0.1:${billplzPort}`,
      /** Every bill raised this run, straight from the stub's own memory. */
      async bills() {
        const res = await fetch(`http://127.0.0.1:${billplzPort}/__bills`);
        return (await res.json()).bills;
      },
      /**
       * Holds the next callback back by `ms`, so the customer's browser reaches
       * the result page before any payment has been confirmed.
       */
      async delay(ms) {
        await fetch(`http://127.0.0.1:${billplzPort}/__delay`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ms: String(ms) }).toString(),
        });
      },
      /** Re-delivers a callback, as Billplz does when it wants an ack again. */
      async replay(billId) {
        const res = await fetch(`http://127.0.0.1:${billplzPort}/__replay/${billId}`, {
          method: "POST",
        });
        return (await res.json()).status;
      },
      /** The same callback, signed with a key that is not ours. */
      async forge(billId) {
        const res = await fetch(`http://127.0.0.1:${billplzPort}/__forge/${billId}`, {
          method: "POST",
        });
        return (await res.json()).status;
      },
    },
    stop() {
      stub.kill();
      billplz.kill();
      app.kill();
    },
  };
}
