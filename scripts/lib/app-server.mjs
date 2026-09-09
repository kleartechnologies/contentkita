/**
 * Starts the production build against the local provider stub.
 *
 * `next start`, not `next dev`: the flow suite should exercise the same bundle
 * that gets deployed. Firebase is the real `contentkita-8fcf8` project — the
 * brief asks for the flow to run against real infrastructure, and a rules
 * mistake is exactly the kind of thing an emulator would hide.
 *
 * The provider is the only thing stubbed, because the production key lives in
 * the Netlify environment and is deliberately not available here. Everything
 * between the browser and `lib/ai/openai.ts` is the real code path.
 */

import { spawn } from "node:child_process";
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
export async function startApp({ appPort = 3117, stubPort = 8117 } = {}) {
  if (!existsSync(".next")) {
    throw new Error("No production build found. Run `npm run build` first.");
  }

  const stub = spawn("node", ["scripts/stub-openai.mjs", String(stubPort)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  stub.stdout.setEncoding("utf8");
  stub.stdout.on("data", (chunk) => process.stdout.write(chunk));

  const app = spawn("npx", ["next", "start", "-p", String(appPort)], {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      ...(await localEnv()),
      OPENAI_API_KEY: "local-stub-key-not-a-credential",
      OPENAI_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
    },
  });

  const origin = `http://127.0.0.1:${appPort}`;
  try {
    await waitForHttp(`http://127.0.0.1:${stubPort}/v1/chat/completions`, "stub");
    await waitForHttp(origin, "next start");
  } catch (error) {
    stub.kill();
    app.kill();
    throw error;
  }

  return {
    origin,
    stop() {
      stub.kill();
      app.kill();
    },
  };
}
