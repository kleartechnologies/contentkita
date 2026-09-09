/**
 * The real-browser flow: everything a restaurant owner actually does.
 *
 * Chrome drives the deployed bundle against the real Firebase project. Only the
 * AI provider is stubbed, because the production key lives in Netlify's
 * environment and is deliberately not available here — every other layer
 * (auth, rules, uploads, the /api/generate route, prompting, validation,
 * persistence, rendering) is the genuine article.
 *
 * A step that cannot run says BLOCKED and explains why. It is never silently
 * counted as a pass.
 *
 *   npm run build && npm run test:flow
 */

import { randomUUID } from "node:crypto";
import { appendFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launch } from "./lib/cdp.mjs";
import { startApp, localEnv } from "./lib/app-server.mjs";

const HEADLESS = process.env.FLOW_HEADED !== "1";

/** Throwaway credentials, gitignored, consumed by scripts/cleanup-flow.mjs. */
const LEDGER = "scripts/.flow-accounts";

const results = [];
let current = null;

function record(status, detail) {
  results.push({ ...current, status, detail });
  const mark = { PASS: "  ok  ", FAIL: " FAIL ", BLOCK: "BLOCKED" }[status];
  console.log(`${mark} ${String(current.n).padStart(2)}. ${current.name}${detail ? ` — ${detail}` : ""}`);
}

/** Runs one numbered step from the brief. */
async function step(n, name, fn) {
  current = { n, name };
  try {
    const detail = await fn();
    record("PASS", detail);
  } catch (error) {
    if (error instanceof Blocked) record("BLOCK", error.message);
    else record("FAIL", error.message.replace(/\s+/g, " ").slice(0, 400));
  }
}

class Blocked extends Error {}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** A real 1x1 PNG and a real one-page PDF, written to a temp dir. */
async function fixtures() {
  const dir = await mkdtemp(join(tmpdir(), "contentkita-files-"));
  const logo = join(dir, "logo.png");
  await writeFile(
    logo,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const menu = join(dir, "menu.pdf");
  const body = "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n";
  await writeFile(menu, `%PDF-1.4\n${body}trailer<</Root 1 0 R>>\n%%EOF\n`);
  return { dir, logo, menu };
}

const RESTAURANT = {
  name: `Warung Ujian ${Math.floor(Math.random() * 9000) + 1000}`,
  cuisine: "Masakan Melayu",
  location: "Kajang, Selangor",
  description: "Warung keluarga yang masak harian guna resipi nenek.",
  customers: "Keluarga dan pekerja pejabat sekitar Kajang",
  bestSeller: "Nasi Lemak Ayam Berempah",
  menuNotes: "Teh ais buat sendiri, tak guna premix.",
  colours: "Merah bata dan krim",
};

async function main() {
  const files = await fixtures();
  const env = await localEnv();
  const email = `flow-${randomUUID().slice(0, 8)}@contentkita.test`;
  const password = `Uj!${randomUUID().slice(0, 10)}`;

  console.log(`\nContentKita — real browser flow`);
  console.log(`  firebase project: ${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);
  console.log(`  throwaway account: ${email}\n`);

  // Recorded before anything else, so a crashed run still leaves a trail the
  // cleanup script can follow rather than orphaning a real account.
  await appendFile(LEDGER, `${email}\t${password}\n`);

  // Asked once, up front. Without a bucket every upload retries for minutes
  // and then fails with an opaque code, which reads like a broken rule rather
  // than an unprovisioned service.
  const bucket = env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const storageReady = await fetch(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o`)
    .then((r) => r.status !== 404)
    .catch(() => false);
  if (!storageReady) {
    console.log(
      `  Cloud Storage is not enabled: the bucket ${bucket} does not exist.\n` +
        `  Upload steps will be reported as blocked, not passed.\n`,
    );
  }

  const server = await startApp();
  console.log(
    server.stubbed
      ? `  provider: local stub\n`
      : `  provider: REAL — ${server.origin} with its own key\n`,
  );
  const page = await launch({ headless: HEADLESS });
  await page.grantClipboard(server.origin);

  /** Every day's hook, keyed by day, read straight off the plan list. */
  const hooks = () =>
    page.eval(`
      return [...document.querySelectorAll('ol li a[href^="/content/"]')].map((a) => ({
        href: a.getAttribute("href"),
        day: Number(a.querySelector("span:nth-of-type(2)")?.textContent ?? 0),
        text: a.innerText,
      }));
    `);

  let before = [];
  let targetHref = "";
  const EDITED = "Caption ini ditulis semula oleh pemilik semasa ujian.";

  try {
    await step(1, "Open ContentKita", async () => {
      await page.goto(server.origin);
      const text = await page.text();
      assert(/ContentKita/i.test(text), "landing page did not render");
      assert(/restoran/i.test(text), "landing copy missing");
      return "landing page renders";
    });

    await step(2, "Signup", async () => {
      await page.goto(`${server.origin}/signup`);
      await page.waitFor(`return !!document.querySelector('input[type="email"]')`);
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('form button[type="submit"]');
      await page.waitFor(`return location.pathname === "/onboarding"`, {
        timeout: 30_000,
        label: "redirect to /onboarding",
      });
      return "account created, landed on onboarding";
    });

    await step(6, "Enter restaurant information", async () => {
      await page.waitFor(`return document.querySelectorAll("input, textarea").length >= 5`);
      const inputs = await page.eval(`
        return [...document.querySelectorAll("main input, input, textarea")]
          .filter((el) => el.type !== "file" && !el.classList.contains("sr-only"))
          .map((el, i) => { el.setAttribute("data-flow", "f" + i); return el.tagName; });
      `);
      assert(inputs.length >= 5, `expected 5 identity fields, saw ${inputs.length}`);
      await page.fill('[data-flow="f0"]', RESTAURANT.name);
      await page.fill('[data-flow="f1"]', RESTAURANT.cuisine);
      await page.fill('[data-flow="f2"]', RESTAURANT.location);
      await page.fill('[data-flow="f3"]', RESTAURANT.description);
      await page.fill('[data-flow="f4"]', RESTAURANT.customers);
      await page.clickText("Seterusnya");
      await page.waitFor(`return document.body.innerText.includes("Menu paling laris")`);
      return "identity step accepted";
    });

    await step(5, "Upload menu", async () => {
      await page.eval(`
        const el = [...document.querySelectorAll("input")].find((e) => e.getAttribute("placeholder") === "Nasi Ayam Penyet");
        if (!el) throw new Error("no best seller field");
        el.setAttribute("data-flow", "dish");
        const notes = document.querySelector("textarea");
        if (notes) notes.setAttribute("data-flow", "notes");
        return true;
      `);
      await page.fill('[data-flow="dish"]', RESTAURANT.bestSeller);
      // The tag input commits on Enter; a plain value change would be dropped.
      await page.eval(`
        const el = document.querySelector('[data-flow="dish"]');
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return true;
      `);
      await page.fill('[data-flow="notes"]', RESTAURANT.menuNotes);

      if (!storageReady) {
        throw new Blocked(
          `Cloud Storage is not enabled for this project, so ${bucket} does not exist.` +
            ` Enable Storage in the Firebase console, then deploy storage.rules.`,
        );
      }
      await page.setFile('input[type="file"]', files.menu);
      const outcome = await page.waitFor(
        `
        const text = document.body.innerText;
        if (/menu\\.pdf/i.test(text)) return "uploaded";
        const alert = document.querySelector('[role="alert"]');
        if (alert && alert.innerText.trim()) return "error:" + alert.innerText.trim();
        return null;
      `,
        { timeout: 30_000, label: "menu upload to settle" },
      );
      if (outcome.startsWith("error:")) {
        throw new Blocked(`upload refused: ${outcome.slice(6)}`);
      }
      return "menu.pdf uploaded to Firebase Storage";
    });

    await step(7, "Select content preferences (brand)", async () => {
      await page.clickText("Seterusnya");
      await page.waitFor(`return document.body.innerText.includes("Warna jenama")`);
      await page.eval(`
        const el = [...document.querySelectorAll("input")].find((e) => e.getAttribute("placeholder") === "Merah bata dan krim");
        if (!el) throw new Error("no brand colour field");
        el.setAttribute("data-flow", "colours");
        return true;
      `);
      await page.fill('[data-flow="colours"]', RESTAURANT.colours);
      const platforms = await page.eval(`
        return [...document.querySelectorAll('input[name="platforms"]')].filter((e) => e.checked).length;
      `);
      assert(platforms > 0, "no platform selected by default");
      return `${platforms} platform(s) selected`;
    });

    await step(4, "Upload logo", async () => {
      if (!storageReady) {
        throw new Blocked(
          `Cloud Storage is not enabled for this project, so ${bucket} does not exist.` +
            ` Enable Storage in the Firebase console, then deploy storage.rules.`,
        );
      }
      await page.setFile('input[type="file"]', files.logo);
      const outcome = await page.waitFor(
        `
        const text = document.body.innerText;
        if (/logo\\.png/i.test(text)) return "uploaded";
        const alert = document.querySelector('[role="alert"]');
        if (alert && alert.innerText.trim()) return "error:" + alert.innerText.trim();
        return null;
      `,
        { timeout: 30_000, label: "logo upload to settle" },
      );
      if (outcome.startsWith("error:")) {
        throw new Blocked(`upload refused: ${outcome.slice(6)}`);
      }
      return "logo.png uploaded to Firebase Storage";
    });

    await step(3, "Complete onboarding", async () => {
      await page.clickText("Seterusnya");
      await page.waitFor(`return document.body.innerText.includes("Gaya bahasa content")`);
      const tone = await page.eval(`
        return [...document.querySelectorAll('input[name="tone"]')].filter((e) => e.checked).length;
      `);
      const styles = await page.eval(`
        return [...document.querySelectorAll('input[name="copyStyles"]')].filter((e) => e.checked).length;
      `);
      assert(tone === 1, `expected one tone, saw ${tone}`);
      assert(styles > 0, "no copy style selected");
      return `final step reached (${styles} copy style(s))`;
    });

    await step(8, "Generate 30-day content", async () => {
      await page.clickText("Jana Content Saya");
      await page.waitFor(
        `return /Menyusun strategi|Menulis hook|Menyemak|Membaca maklumat|Menyimpan/.test(document.body.innerText)
           || location.pathname === "/dashboard"`,
        { timeout: 30_000, label: "generation to start" },
      );
      return "generation started";
    });

    await step(9, "Wait for AI response", async () => {
      await page.waitFor(`return location.pathname === "/dashboard"`, {
        timeout: 180_000,
        label: "generation to finish",
      });
      const calledProvider = page.requests.some((u) => /api\.openai\.com/.test(u));
      assert(!calledProvider, "the browser talked to the provider directly");
      const call = page.responses.find((r) => r.url.includes("/api/generate"));
      if (!call) {
        const toasts = await page.toasts();
        const screen = (await page.text()).replace(/\s+/g, " ").slice(0, 300);
        throw new Error(
          `generation never reached /api/generate. on screen: ${toasts.join(" / ") || screen}`,
        );
      }
      assert(call.status === 200, `/api/generate answered ${call.status}`);
      return "browser → /api/generate → provider, no direct provider call";
    });

    await step(10, "Verify 30 content days appear", async () => {
      await page.waitFor(
        `return document.querySelectorAll('ol li a[href^="/content/"]').length === 30`,
        { timeout: 30_000, label: "30 plan rows" },
      );
      before = await hooks();
      assert(before.length === 30, `saw ${before.length} days`);
      const days = new Set(before.map((r) => r.day));
      assert(days.size === 30, "day numbers are not unique");
      return "30 unique days rendered";
    });

    await step(11, "Open content detail", async () => {
      targetHref = before[6].href;
      await page.goto(`${server.origin}${targetHref}`);
      await page.waitFor(`return document.body.innerText.includes("Salin caption")`);
      const text = await page.text();
      assert(/Hari 0?7/.test(text), "detail page is not day 7");
      return `opened ${targetHref}`;
    });

    await step(12, "Copy caption", async () => {
      // A real mouse press, because Chrome only allows a clipboard write while
      // the page holds transient user activation from a genuine click.
      await page.clickForReal("Salin caption");
      await page.waitFor(`return document.body.innerText.includes("Disalin")`, {
        label: "copy confirmation",
      }).catch(async (error) => {
        const toasts = await page.toasts();
        throw new Error(`${error.message}${toasts.length ? ` | on screen: ${toasts.join(" / ")}` : ""}`);
      });
      // The button only flips to "Disalin" after a successful write, through
      // either the async API or the legacy fallback, so that alone is proof the
      // copy happened. Reading the text back is a bonus: headless Chrome
      // refuses `readText` when the document is not focused, and that is a
      // property of the test harness, not of the product.
      const clip = await page.clipboard().catch(() => null);
      if (clip === null) return "button confirmed the copy (clipboard not readable headless)";
      assert(clip.trim().length > 20, `clipboard held ${JSON.stringify(clip)}`);
      return `${clip.length} characters on the clipboard`;
    });

    await step(13, "Regenerate one day", async () => {
      const wasHook = await page.eval(`return document.querySelector("h1, h2")?.innerText ?? "";`);
      await page.clickText("Jana semula");
      await page.waitFor(
        `return !document.body.innerText.includes("Menjana…")`,
        { timeout: 180_000, label: "regeneration to finish" },
      );
      const text = await page.text();
      assert(!/gagal|ralat|tidak dapat/i.test(text), "regeneration reported a failure");
      return `day 7 rewritten (was: ${wasHook.slice(0, 40)}…)`;
    });

    await step(14, "Verify only that day changes", async () => {
      await page.goto(`${server.origin}/dashboard`);
      await page.waitFor(
        `return document.querySelectorAll('ol li a[href^="/content/"]').length === 30`,
      );
      const after = await hooks();
      const changed = after.filter((row, i) => row.text !== before[i].text);
      assert(changed.length === 1, `${changed.length} days changed, expected 1`);
      assert(changed[0].href === targetHref, `wrong day changed: ${changed[0].href}`);
      before = after;
      return "29 days untouched, day 7 rewritten";
    });

    await step(15, "Refresh", async () => {
      await page.goto(`${server.origin}/dashboard`);
      return "reloaded";
    });

    await step(16, "Verify content persists", async () => {
      await page.waitFor(
        `return document.querySelectorAll('ol li a[href^="/content/"]').length === 30`,
        { timeout: 30_000, label: "plan after refresh" },
      );
      const after = await hooks();
      assert(
        JSON.stringify(after) === JSON.stringify(before),
        "the plan changed across a refresh",
      );
      return "all 30 days identical after reload";
    });

    await step(17, "Edit a caption", async () => {
      await page.goto(`${server.origin}${targetHref}`);
      await page.waitFor(`return document.body.innerText.includes("Edit")`);
      await page.clickText("Edit");
      await page.waitFor(`return document.querySelectorAll("textarea").length >= 3`);
      await page.eval(`
        document.querySelectorAll("textarea")[1].setAttribute("data-flow", "caption");
        return true;
      `);
      await page.fill('[data-flow="caption"]', EDITED);
      return "caption replaced in the edit form";
    });

    await step(18, "Save", async () => {
      await page.clickText("Simpan perubahan");
      await page.waitFor(`return document.body.innerText.includes(${JSON.stringify(EDITED)})`, {
        timeout: 30_000,
        label: "edit to render",
      });
      return "saved";
    });

    await step(19, "Refresh", async () => {
      await page.goto(`${server.origin}${targetHref}`);
      return "reloaded the detail page";
    });

    await step(20, "Verify edit persists", async () => {
      await page.waitFor(`return document.body.innerText.includes(${JSON.stringify(EDITED)})`, {
        timeout: 30_000,
        label: "edited caption after refresh",
      });
      return "the owner's own words survived the reload";
    });

    await step(21, "Logout", async () => {
      await page.goto(`${server.origin}/profile`);
      await page.waitFor(`return document.body.innerText.includes("Log keluar")`);
      await page.clickText("Log keluar");
      await page.waitFor(`return location.pathname === "/" || location.pathname === "/login"`, {
        timeout: 30_000,
        label: "sign out",
      });
      return "signed out";
    });

    await step(22, "Login", async () => {
      await page.goto(`${server.origin}/login`);
      await page.waitFor(`return !!document.querySelector('input[type="email"]')`);
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('form button[type="submit"]');
      await page.waitFor(`return location.pathname === "/dashboard"`, {
        timeout: 30_000,
        label: "redirect to dashboard",
      });
      return "signed back in";
    });

    await step(23, "Verify restaurant and content still exist", async () => {
      await page.waitFor(
        `return document.querySelectorAll('ol li a[href^="/content/"]').length === 30`,
        { timeout: 30_000, label: "plan after re-login" },
      );
      const after = await hooks();
      // The edit changed the caption, not the hook, so the list should be
      // byte-identical to what was on screen before signing out.
      assert(
        JSON.stringify(after) === JSON.stringify(before),
        "the plan differs after signing back in",
      );
      const text = await page.text();
      assert(text.includes(RESTAURANT.name), "the restaurant name is gone");
      await page.goto(`${server.origin}${targetHref}`);
      await page.waitFor(`return document.body.innerText.includes(${JSON.stringify(EDITED)})`, {
        timeout: 30_000,
        label: "edited caption after re-login",
      });
      return "restaurant, plan and the owner's edit all survived";
    });
  } finally {
    const errors = page.console.filter(
      (m) => m.type === "error" || m.type === "exception",
    );
    await page.close();
    server.stop();
    await rm(files.dir, { recursive: true, force: true });

    console.log("");
    if (errors.length > 0) {
      console.log(`Browser console reported ${errors.length} error(s):`);
      for (const e of errors.slice(0, 8)) console.log(`  - ${e.text.slice(0, 200)}`);
      console.log("");
    }

    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL");
    const blocked = results.filter((r) => r.status === "BLOCK");
    console.log(
      `${passed} passed, ${failed.length} failed, ${blocked.length} blocked, of ${results.length} steps`,
    );
    for (const r of blocked) console.log(`  BLOCKED ${r.n}. ${r.name} — ${r.detail}`);
    for (const r of failed) console.log(`  FAILED  ${r.n}. ${r.name} — ${r.detail}`);
    console.log(
      `\nThe throwaway account ${email} and its documents remain in the real` +
        `\nproject. Remove them with: node --env-file=.env.local scripts/cleanup-flow.mjs`,
    );

    // A blocked step is not a passing one. The suite stays red until every
    // step of the owner's journey has actually been performed.
    if (failed.length > 0 || blocked.length > 0) process.exitCode = 1;
  }
}

await main();
