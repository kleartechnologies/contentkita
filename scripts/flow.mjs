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
  // A flat, unmistakable colour. A photo that is one known RGB value is the
  // only way to prove the owner's own picture reached the downloaded file,
  // rather than something that merely looks like it did.
  const photo = join(dir, "photo.png");
  await writeFile(
    photo,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGN4xlCHFTEMLQkA4MZZAcIaM6MAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const menu = join(dir, "menu.pdf");
  const body = "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n";
  await writeFile(menu, `%PDF-1.4\n${body}trailer<</Root 1 0 R>>\n%%EOF\n`);
  return { dir, logo, menu, photo };
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
  const CREATIVE_HEADLINE = "Hook poster ditulis sendiri oleh pemilik.";

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

    /* --- the creative studio: the design, not a description of one --------- */

    /**
     * Downloads the poster without letting the browser save it.
     *
     * `URL.createObjectURL` is where the finished PNG passes through, so
     * borrowing it hands the test the exact bytes the owner would have got.
     * The anchor click is swallowed so a headless run does not litter the
     * machine with files, and nothing in the product is modified to allow it.
     */
    const captureExport = async () => {
      await page.eval(`
        window.__flowExport = null;
        if (!window.__flowPatched) {
          window.__flowPatched = true;
          const create = URL.createObjectURL.bind(URL);
          URL.createObjectURL = (obj) => {
            if (obj instanceof Blob && obj.type === "image/png") {
              window.__flowExport = obj;
              return "blob:flow-captured";
            }
            return create(obj);
          };
          const revoke = URL.revokeObjectURL.bind(URL);
          URL.revokeObjectURL = (url) => {
            if (url !== "blob:flow-captured") revoke(url);
          };
          const click = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            if (this.hasAttribute("download")) return;
            return click.call(this);
          };
        }
        return true;
      `);
      await page.clickText("Muat turun PNG");
      await page.waitFor(`return !!window.__flowExport`, {
        timeout: 30_000,
        label: "the poster to finish exporting",
      });
    };

    /**
     * Reads the finished PNG, and looks inside the photo slot.
     *
     * The fixture photograph is one flat colour, so the file exported while it
     * was in place marks out the slot exactly. That box is then read back out
     * of a second file, exported after the photo was removed: with the
     * editor's dashed hint suppressed, nothing is drawn there at all, so the
     * region has to be a single solid colour. The same region of the editor's
     * own canvas — which is showing the hint at that moment — is checked too;
     * without that, the test would pass on a slot nobody ever drew in.
     */
    const inspectExports = async () =>
      page.eval(`
        const read = (source, w, h) => {
          const canvas = new OffscreenCanvas(w, h);
          canvas.getContext("2d").drawImage(source, 0, 0, w, h);
          return canvas.getContext("2d").getImageData(0, 0, w, h);
        };

        const filled = await createImageBitmap(window.__flowFilled);
        const empty = await createImageBitmap(window.__flowExport);
        const shot = read(filled, filled.width, filled.height);

        // Where the owner's photograph ended up.
        let minX = shot.width, minY = shot.height, maxX = -1, maxY = -1, photo = 0;
        for (let i = 0; i < shot.data.length; i += 4) {
          if (
            Math.abs(shot.data[i] - 0xe6) < 24 &&
            Math.abs(shot.data[i + 1] - 0x00) < 24 &&
            Math.abs(shot.data[i + 2] - 0x7e) < 24
          ) {
            photo++;
            const p = i / 4;
            const x = p % shot.width;
            const y = (p / shot.width) | 0;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (maxX < 0) return { photoShare: 0, slot: null };

        // The middle of the slot, clear of its rounded corners.
        const inset = (lo, hi) => {
          const pad = (hi - lo) * 0.1;
          return [lo + pad, hi - pad];
        };
        const [x0, x1] = inset(minX, maxX);
        const [y0, y1] = inset(minY, maxY);
        const frac = {
          x: x0 / shot.width,
          y: y0 / shot.height,
          w: (x1 - x0) / shot.width,
          h: (y1 - y0) / shot.height,
        };

        /** How many distinct colours are painted inside the slot. */
        const coloursIn = (image) => {
          const seen = new Set();
          const left = Math.round(frac.x * image.width);
          const top = Math.round(frac.y * image.height);
          const right = Math.round((frac.x + frac.w) * image.width);
          const bottom = Math.round((frac.y + frac.h) * image.height);
          for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) {
              const i = (y * image.width + x) * 4;
              seen.add((image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2]);
              if (seen.size > 64) return seen.size;
            }
          }
          return seen.size;
        };

        const preview = document.querySelector('canvas[role="img"]');
        return {
          width: filled.width,
          height: filled.height,
          photoShare: photo / (shot.width * shot.height),
          slot: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
          coloursInEmptyExport: coloursIn(read(empty, empty.width, empty.height)),
          coloursInEmptyEditor: coloursIn(
            read(preview, preview.width, preview.height),
          ),
        };
      `);

    /**
     * True once the fixture photograph is actually painted on the poster.
     *
     * The slot holding a reference to the photo is not the same as the photo
     * being drawn: it still has to come back through the asset proxy first.
     * Exporting before then would quietly produce a poster without it.
     */
    const PHOTO_PAINTED = `
      const canvas = document.querySelector('canvas[role="img"]');
      if (!canvas) return false;
      const { data } = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - 0xe6) < 24 &&
          data[i + 1] < 24 &&
          Math.abs(data[i + 2] - 0x7e) < 24
        ) {
          return true;
        }
      }
      return false;
    `;

    /** The headline as the studio shows it, straight out of the textarea. */
    const headline = () =>
      page.eval(
        `return document.querySelector("#creative-text-headline")?.value ?? null`,
      );

    let composedHeadline = "";

    await step(24, "Open the creative studio on a real content day", async () => {
      await page.goto(`${server.origin}${targetHref}`);
      await page.waitFor(`return !!document.querySelector('canvas[role="img"]')`, {
        timeout: 45_000,
        label: "the poster to be composed",
      });
      const text = await page.text();
      assert(text.includes("Design siap guna"), "the design section is missing");
      return "the studio opened on the day the owner was already reading";
    });

    await step(25, "Verify the generated poster", async () => {
      const painted = await page.eval(`
        const canvas = document.querySelector('canvas[role="img"]');
        const g = canvas.getContext("2d");
        const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
        const seen = new Set();
        for (let i = 0; i < data.length; i += 4) {
          seen.add(data[i] + "," + data[i + 1] + "," + data[i + 2]);
          if (seen.size > 4) break;
        }
        return { width: canvas.width, height: canvas.height, colours: seen.size };
      `);
      assert(painted.width > 0 && painted.height > 0, "the canvas has no size");
      assert(painted.colours > 1, "the poster is a blank rectangle");

      composedHeadline = await headline();
      assert(composedHeadline, "the poster has no editable headline");
      // Every word on the poster is supposed to come from the plan. The hook
      // of this very day is on screen above the studio, so it can be checked
      // rather than assumed.
      const page_text = await page.text();
      assert(
        page_text.includes(composedHeadline.trim()),
        "the headline is not a phrase from this content day",
      );
      return `${painted.width}x${painted.height} poster, headline taken from the plan`;
    });

    await step(26, "Export with the photo slot still empty", async () => {
      await captureExport();
      const shot = await page.eval(`
        const bitmap = await createImageBitmap(window.__flowExport);
        return { type: window.__flowExport.type, width: bitmap.width, height: bitmap.height };
      `);
      assert(shot.type === "image/png", `exported ${shot.type}, not a PNG`);
      assert(shot.width === 1080, `exported at ${shot.width}px, not 1080`);
      return `${shot.width}x${shot.height} PNG, before any photograph`;
    });

    await step(27, "Edit the headline", async () => {
      await page.fill("#creative-text-headline", CREATIVE_HEADLINE);
      assert((await headline()) === CREATIVE_HEADLINE, "the headline did not take");
      return "the owner rewrote the hook on the poster";
    });

    await step(28, "Save the design", async () => {
      await page.clickText("Simpan design");
      await page.waitFor(
        `return [...document.querySelectorAll("button")].some((b) => b.innerText.includes("Tersimpan"))`,
        { timeout: 30_000, label: "the design to save" },
      );
      return "saved";
    });

    await step(29, "Refresh", async () => {
      await page.goto(`${server.origin}${targetHref}`);
      await page.waitFor(`return !!document.querySelector("#creative-text-headline")`, {
        timeout: 45_000,
        label: "the studio to reload",
      });
      return "reloaded the detail page";
    });

    await step(30, "Verify the edited headline persists", async () => {
      assert(
        (await headline()) === CREATIVE_HEADLINE,
        "the saved headline did not come back",
      );
      return "the owner's own words came back from Firestore";
    });

    await step(31, "Replace the image", async () => {
      if (!storageReady) throw new Blocked("Cloud Storage is not enabled for this project");
      await page.setFile('input[type="file"][accept="image/png,image/jpeg"]', files.photo);
      await page.waitFor(
        `return document.body.innerText.includes("Gambar anda sedang digunakan")`,
        { timeout: 60_000, label: "the photo to upload" },
      );
      await page.waitFor(PHOTO_PAINTED, {
        timeout: 60_000,
        label: "the photo to be drawn on the poster",
      });
      return "the owner's own photograph went into the slot, and onto the poster";
    });

    await step(32, "Save the design with the photo", async () => {
      await page.clickText("Simpan design");
      await page.waitFor(
        `return [...document.querySelectorAll("button")].some((b) => b.innerText.includes("Tersimpan"))`,
        { timeout: 30_000, label: "the design to save" },
      );
      return "saved";
    });

    await step(33, "Refresh", async () => {
      await page.goto(`${server.origin}${targetHref}`);
      await page.waitFor(`return !!document.querySelector("#creative-text-headline")`, {
        timeout: 45_000,
        label: "the studio to reload",
      });
      return "reloaded the detail page";
    });

    await step(34, "Verify the replaced image persists", async () => {
      if (!storageReady) throw new Blocked("Cloud Storage is not enabled for this project");
      await page.waitFor(
        `return document.body.innerText.includes("Gambar anda sedang digunakan")`,
        { timeout: 45_000, label: "the saved photo" },
      );
      await page.waitFor(PHOTO_PAINTED, {
        timeout: 60_000,
        label: "the saved photo to be drawn on the poster",
      });
      assert(
        (await headline()) === CREATIVE_HEADLINE,
        "the headline was lost when the photo was saved",
      );
      return "photo and headline both came back together";
    });

    await step(35, "Download the poster as a PNG", async () => {
      if (!storageReady) throw new Blocked("Cloud Storage is not enabled for this project");
      await captureExport();
      const shot = await page.eval(`
        const bitmap = await createImageBitmap(window.__flowExport);
        return {
          type: window.__flowExport.type,
          bytes: window.__flowExport.size,
          width: bitmap.width,
          height: bitmap.height,
        };
      `);
      assert(shot.type === "image/png", `exported ${shot.type}, not a PNG`);
      assert(shot.bytes > 1000, `the exported file is only ${shot.bytes} bytes`);
      return `${shot.width}x${shot.height}, ${(shot.bytes / 1024).toFixed(0)}KB`;
    });

    await step(36, "Verify the exported PNG carries no placeholder", async () => {
      if (!storageReady) throw new Blocked("Cloud Storage is not enabled for this project");
      // Keep the file with the photograph in it, then take the photo out so
      // the editor puts its hint back and a second file can be compared.
      await page.eval(`window.__flowFilled = window.__flowExport; return true;`);
      await page.clickText("Buang gambar");
      await page.waitFor(`return document.body.innerText.includes("Belum ada gambar")`, {
        timeout: 30_000,
        label: "the photo slot to empty",
      });
      await captureExport();

      const shot = await inspectExports();
      assert(shot.slot, "the owner's photograph is not in the exported file");
      assert(
        shot.photoShare > 0.02,
        `the photograph covers only ${(shot.photoShare * 100).toFixed(1)}% of the poster`,
      );
      assert(
        shot.width === 1080 && shot.height >= 1080,
        `exported at ${shot.width}x${shot.height}`,
      );
      // The editor draws a dashed hint and a line of instructions in the empty
      // slot. If it did not, this test would pass without proving anything.
      assert(
        shot.coloursInEmptyEditor > 1,
        "the editor drew nothing in the empty slot, so there was no hint to drop",
      );
      assert(
        shot.coloursInEmptyExport === 1,
        `the empty slot carries ${shot.coloursInEmptyExport} colours in the file, so editor-only chrome was exported`,
      );
      return (
        `photo filled ${(shot.photoShare * 100).toFixed(0)}% of the poster; the empty slot is ` +
        `1 flat colour in the file against ${shot.coloursInEmptyEditor} in the editor`
      );
    });

    await step(37, "Recompose the design from the plan", async () => {
      await page.clickText("Kembali ke asal");
      await page.waitFor(
        `return document.querySelector("#creative-text-headline")?.value !== ${JSON.stringify(
          CREATIVE_HEADLINE,
        )}`,
        { timeout: 30_000, label: "the poster to be recomposed" },
      );
      assert(
        (await headline()) === composedHeadline,
        "recomposing did not restore the headline the plan generated",
      );
      return "the poster went back to the words the plan generated";
    });

    await step(38, "Verify the content day is intact", async () => {
      const text = await page.text();
      assert(
        text.includes(EDITED),
        "the owner's caption changed while they were designing",
      );
      await page.goto(`${server.origin}/dashboard`);
      await page.waitFor(
        `return document.querySelectorAll('ol li a[href^="/content/"]').length === 30`,
        { timeout: 30_000, label: "the plan" },
      );
      const after = await hooks();
      assert(
        JSON.stringify(after) === JSON.stringify(before),
        "the 30-day plan changed while the owner was designing",
      );
      return "all 30 days, and the caption, exactly as they were";
    });

    /* --- the content pack: thirty designs, not thirty visits --------------- */

    /** Opens one day from the strip and waits for its poster to be composed. */
    const openPackDay = async (day) => {
      await page.eval(`
        const buttons = [...document.querySelectorAll('nav[aria-label="Hari dalam pack"] button')];
        const el = buttons[${day - 1}];
        if (!el) throw new Error("no button for day ${day}");
        el.scrollIntoView({ block: "center" });
        el.click();
        return true;
      `);
      const label = `Hari ${String(day).padStart(2, "0")}`;
      await page.waitFor(
        `return document.querySelector("#pack-design-heading")?.innerText.includes(${JSON.stringify(label)}) ?? false`,
        { timeout: 30_000, label: `${label} to be selected` },
      );
      await page.waitFor(`return !!document.querySelector('canvas[role="img"]')`, {
        timeout: 45_000,
        label: `${label}'s poster to be composed`,
      });
      return label;
    };

    /** How many days the strip is reporting as done. */
    const packProgress = () =>
      page.eval(`
        const text = document.body.innerText;
        const m = /(\\d+)\\/(\\d+) design siap/.exec(text);
        return m ? { ready: Number(m[1]), total: Number(m[2]) } : null;
      `);

    let generateCallsBefore = 0;
    const PACK_NAME = "Content Sebulan Warung Ujian";
    const PACK_HEADLINE = "Hook pack ditulis sendiri oleh pemilik.";

    await step(39, "Open the 30-day content pack", async () => {
      await page.goto(`${server.origin}/pack`);
      await page.waitFor(
        `return document.querySelectorAll('nav[aria-label="Hari dalam pack"] button').length === 30`,
        { timeout: 45_000, label: "the 30-day strip" },
      );
      await page.waitFor(`return /\\d+\\/\\d+ design siap/.test(document.body.innerText)`, {
        timeout: 45_000,
        label: "the pack to say how much of it is already designed",
      });
      const text = await page.text();
      assert(text.includes("Nama pack"), "the pack has no editable name");
      const progress = await packProgress();
      assert(progress, "the pack does not say how many designs are ready");
      assert(progress.total === 30, `the pack counts ${progress.total} days, not 30`);
      generateCallsBefore = page.responses.filter((r) =>
        r.url.includes("/api/generate"),
      ).length;
      return `30 days listed, ${progress.ready}/${progress.total} already designed`;
    });

    await step(40, "Generate the whole pack in one press", async () => {
      // By id, not by label: the button reads "Sediakan semua design" on an
      // untouched pack and "Sambung sediakan design" once a day is done, and it
      // only appears at all once the saved designs have loaded.
      await page.waitFor(`return !!document.querySelector("#pack-generate")`, {
        timeout: 30_000,
        label: "the pack to finish loading what is already saved",
      });
      await page.click("#pack-generate");
      await page.waitFor(`return /30\\/30 design siap/.test(document.body.innerText)`, {
        timeout: 180_000,
        label: "all 30 designs to be saved",
      });
      const text = await page.text();
      assert(text.includes("Semua siap"), "the pack did not report itself ready");
      assert(!/Tak jadi|Sebahagian siap/.test(text), "the pack reported failures");
      return "one press, thirty designs";
    });

    await step(41, "Verify the pack cost no AI calls", async () => {
      const after = page.responses.filter((r) => r.url.includes("/api/generate")).length;
      assert(
        after === generateCallsBefore,
        `composing 30 designs made ${after - generateCallsBefore} call(s) to /api/generate`,
      );
      assert(
        !page.requests.some((u) => /api\.openai\.com/.test(u)),
        "the browser talked to the provider",
      );
      return `0 generation calls for 30 designs (${after} in the whole run, all from the content plan)`;
    });

    await step(42, "Verify every day reports itself ready", async () => {
      const states = await page.eval(`
        return [...document.querySelectorAll('nav[aria-label="Hari dalam pack"] button')]
          .map((b) => (b.textContent.match(/siap|gagal|sedang disediakan|belum ada design/) ?? ["?"])[0]);
      `);
      assert(states.length === 30, `the strip lists ${states.length} days`);
      const notReady = states.filter((s) => s !== "siap");
      assert(notReady.length === 0, `${notReady.length} day(s) are ${notReady[0]}`);
      return "30 of 30 days marked siap";
    });

    await step(43, "Open day 01, day 15 and day 30", async () => {
      const seen = [];
      for (const day of [1, 15, 30]) {
        const label = await openPackDay(day);
        const text = await page.text();
        assert(text.includes("Salin caption"), `${label} has no caption to copy`);
        // Section headings are rendered uppercase by CSS, and `innerText`
        // reports what is painted rather than what the markup says.
        assert(/call to action/i.test(text), `${label} has no CTA`);
        const painted = await page.eval(`
          const canvas = document.querySelector('canvas[role="img"]');
          const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
          const seen = new Set();
          for (let i = 0; i < data.length; i += 4) {
            seen.add(data[i] + "," + data[i + 1] + "," + data[i + 2]);
            if (seen.size > 4) break;
          }
          return { width: canvas.width, colours: seen.size };
        `);
        assert(painted.colours > 1, `${label} is a blank rectangle`);
        const line = await headline();
        assert(line && line.trim().length > 0, `${label} has no editable headline`);
        seen.push(label);
      }
      return `${seen.join(", ")} — each a real poster with its own caption`;
    });

    await step(44, "Copy the CTA and the hashtags on their own", async () => {
      await page.clickForReal("Salin CTA");
      await page.waitFor(
        `return [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Disalin")`,
        { timeout: 15_000, label: "the CTA copy confirmation" },
      );
      const cta = await page.clipboard().catch(() => null);
      const hasHashtags = await page.eval(`
        return [...document.querySelectorAll("button")].some((b) => b.innerText.includes("Salin hashtag"));
      `);
      if (hasHashtags) {
        await page.clickForReal("Salin hashtag");
        await page.waitFor(
          `return [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Disalin")`,
          { timeout: 15_000, label: "the hashtag copy confirmation" },
        );
      }
      const tags = await page.clipboard().catch(() => null);
      if (cta === null) return "both confirmed on the button (clipboard not readable headless)";
      assert(cta.trim().length > 0, "the CTA copied as nothing");
      if (hasHashtags) assert((tags ?? "").includes("#"), "the hashtags copied as nothing");
      return `CTA (${cta.trim().length} chars)${hasHashtags ? " and hashtags" : ""} copied separately from the caption`;
    });

    await step(45, "Verify the day the owner had already designed was left alone", async () => {
      await openPackDay(7);
      assert(
        (await headline()) === CREATIVE_HEADLINE,
        "generating the pack overwrote the design the owner had edited",
      );
      const text = await page.text();
      assert(
        text.includes("Gambar anda sedang digunakan"),
        "the photograph the owner chose was lost",
      );
      return "day 7 kept the owner's own headline and photograph";
    });

    await step(46, "Verify the pack uses the owner's own photograph", async () => {
      if (!storageReady) throw new Blocked("Cloud Storage is not enabled for this project");

      // Only offered when photographs arrived after the designs did. The run
      // above already had one to work with, so this is usually absent — and
      // pressing it when it is there is exactly what an owner would do.
      const offered = await page.eval(`
        const b = [...document.querySelectorAll("button")].find((n) => n.innerText.includes("Isi gambar pada"));
        return b ? b.innerText.trim() : null;
      `);
      if (offered) {
        await page.clickText("Isi gambar pada");
        await page.waitFor(
          `return ![...document.querySelectorAll("button")].some((n) => n.innerText.includes("Isi gambar pada"))`,
          { timeout: 120_000, label: "the photographs to be placed" },
        );
      }

      // Which days carry a picture is decided by the plan — a WhatsApp day is
      // text by nature — so this looks for the photograph across several days
      // rather than demanding it on one particular date.
      const carrying = [];
      for (const day of [2, 3, 4, 5, 6]) {
        await openPackDay(day);
        const text = await page.text();
        if (text.includes("Gambar anda sedang digunakan")) carrying.push(day);
        assert(
          !/gambar orang lain/.test(text) || text.includes("Belum ada gambar"),
          `day ${day} claims a photograph it does not have`,
        );
      }
      assert(
        carrying.length > 0,
        "no day in the pack is using the photograph the owner uploaded",
      );
      return (
        `${carrying.length} of 5 sampled days carry the owner's own photograph` +
        `${offered ? ` (after "${offered}")` : ""}`
      );
    });

    await step(47, "Edit one day in the pack and save it", async () => {
      await openPackDay(12);
      await page.fill("#creative-text-headline", PACK_HEADLINE);
      await page.clickText("Simpan design");
      await page.waitFor(
        `return [...document.querySelectorAll("button")].some((b) => b.innerText.includes("Tersimpan"))`,
        { timeout: 30_000, label: "the design to save" },
      );
      return "day 12 rewritten and saved from the pack workspace";
    });

    await step(48, "Name the pack", async () => {
      // Focused first: the field saves when it is left, and `blur()` on an
      // element that was never focused does nothing at all.
      await page.eval(`document.querySelector("#pack-name").focus(); return true;`);
      await page.fill("#pack-name", PACK_NAME);
      await page.eval(`document.querySelector("#pack-name").blur(); return true;`);
      // Waiting on the confirmation, not on the field: the field shows the new
      // name the moment it is typed, whether or not it ever reached Firestore.
      await page.waitFor(
        `return document.body.innerText.includes("Nama pack disimpan")`,
        { timeout: 30_000, label: "the pack name to be saved" },
      );
      assert(
        (await page.eval(`return document.querySelector("#pack-name")?.value ?? ""`)) === PACK_NAME,
        "the field lost the name it just saved",
      );
      return `named "${PACK_NAME}"`;
    });

    await step(49, "Refresh and verify the pack persists", async () => {
      await page.goto(`${server.origin}/pack`);
      await page.waitFor(
        `return document.querySelectorAll('nav[aria-label="Hari dalam pack"] button').length === 30`,
        { timeout: 45_000, label: "the pack after a reload" },
      );
      await page.waitFor(`return /30\\/30 design siap/.test(document.body.innerText)`, {
        timeout: 45_000,
        label: "30 designs after a reload",
      });
      assert(
        (await page.eval(`return document.querySelector("#pack-name")?.value ?? ""`)) === PACK_NAME,
        "the pack name did not survive the reload",
      );
      await openPackDay(12);
      assert(
        (await headline()) === PACK_HEADLINE,
        "the edit made in the pack workspace did not survive the reload",
      );
      return "30/30 designs, the pack name and the owner's edit all came back";
    });

    await step(50, "Export two different days from the pack", async () => {
      const sizes = [];
      for (const day of [5, 20]) {
        await openPackDay(day);
        await captureExport();
        const shot = await page.eval(`
          const bitmap = await createImageBitmap(window.__flowExport);
          return { type: window.__flowExport.type, bytes: window.__flowExport.size, width: bitmap.width, height: bitmap.height };
        `);
        assert(shot.type === "image/png", `day ${day} exported ${shot.type}`);
        assert(shot.width === 1080, `day ${day} exported at ${shot.width}px`);
        assert(shot.bytes > 1000, `day ${day} exported only ${shot.bytes} bytes`);
        sizes.push(`day ${day}: ${shot.width}x${shot.height}, ${(shot.bytes / 1024).toFixed(0)}KB`);
      }
      return sizes.join("; ");
    });

    await step(51, "Verify the content plan survived the pack", async () => {
      await page.goto(`${server.origin}/dashboard`);
      await page.waitFor(
        `return document.querySelectorAll('ol li a[href^="/content/"]').length === 30`,
        { timeout: 45_000, label: "the plan" },
      );
      const after = await hooks();
      assert(
        JSON.stringify(after) === JSON.stringify(before),
        "the 30-day plan changed while the pack was being made",
      );
      await page.goto(`${server.origin}${targetHref}`);
      await page.waitFor(`return document.body.innerText.includes(${JSON.stringify(EDITED)})`, {
        timeout: 30_000,
        label: "the owner's caption",
      });
      return "all 30 content days, and the owner's caption, exactly as they were";
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
