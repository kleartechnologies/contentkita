/**
 * Responsive checks at the three widths the product is designed for.
 *
 * 360px is the cheap Android a kedai owner actually holds, 768px a tablet on
 * the counter, 1280px a laptop in the back office. Every screen in the owner's
 * journey is visited at each width and checked for the failures that make an
 * app unusable on a phone: sideways scrolling, controls too small to hit, and
 * the bottom navigation sitting on top of the thing you were about to press.
 *
 * Runs against the same real Firebase project and provider stub as the flow
 * suite, reusing the account the flow suite created so no extra user is made.
 *
 *   npm run build && npm run test:responsive
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";

import { launch } from "./lib/cdp.mjs";
import { startApp } from "./lib/app-server.mjs";

const WIDTHS = [360, 768, 1280];
const LEDGER = "scripts/.flow-accounts";

const results = [];

function report(width, page, name, problem) {
  results.push({ width, page, name, problem });
  const mark = problem ? " FAIL " : "  ok  ";
  console.log(`${mark} ${width}px ${page} — ${name}${problem ? `: ${problem}` : ""}`);
}

/**
 * Every check runs inside the page, because the questions are about layout and
 * only the browser can answer them.
 */
const PROBES = {
  "no horizontal overflow": `
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth + 1) return null;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 3)
      .map((el) => el.tagName.toLowerCase() + "." + (el.className.toString().split(" ")[0] || "?"));
    return "page scrolls sideways (" + doc.scrollWidth + " > " + doc.clientWidth + "), widest: " + wide.join(", ");
  `,

  "controls are big enough to tap": `
    if (window.innerWidth >= 768) return null;
    const small = [...document.querySelectorAll("button, a[href], input, select, [role=button]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        // A radio or checkbox rendered sr-only is not the target — the label
        // wrapping it is, and that gets measured on its own account.
        if (el.classList.contains("sr-only") || r.height <= 2) return false;
        // A link inside a sentence is text, not a target, and is judged by the
        // paragraph it sits in rather than by its own height.
        if (el.tagName === "A" && el.closest("p")) return false;
        return r.height < 40;
      })
      .map((el) => (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 24));
    return small.length ? small.length + " control(s) under 40px tall: " + small.slice(0, 4).join(" | ") : null;
  `,

  "bottom navigation does not cover content": `
    const nav = [...document.querySelectorAll("nav")].find((n) => {
      const s = getComputedStyle(n);
      return s.position === "fixed" && n.getBoundingClientRect().bottom >= window.innerHeight - 2;
    });
    if (!nav) return null;
    const navTop = nav.getBoundingClientRect().top;
    // Scroll to the end, where anything the bar would hide has to be.
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 120));
    const hidden = [...document.querySelectorAll("main button, main a[href], main p, main h1, main h2")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.height === 0) return false;
        return r.bottom > navTop + 1 && r.top < window.innerHeight;
      })
      .map((el) => (el.innerText || el.tagName).trim().slice(0, 24))
      .filter(Boolean);
    window.scrollTo(0, 0);
    return hidden.length ? hidden.length + " element(s) under the bar: " + hidden.slice(0, 3).join(" | ") : null;
  `,

  "text is readable": `
    const tiny = [...document.querySelectorAll("p, span, li, label, button")]
      .filter((el) => el.children.length === 0 && (el.innerText || "").trim().length > 8)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 11)
      .map((el) => el.innerText.trim().slice(0, 24));
    return tiny.length ? tiny.length + " run(s) of text under 11px: " + tiny.slice(0, 3).join(" | ") : null;
  `,
};

async function checkPage(page, width, label) {
  for (const [name, probe] of Object.entries(PROBES)) {
    let problem;
    try {
      problem = await page.eval(probe);
    } catch (error) {
      problem = `probe threw: ${error.message.slice(0, 120)}`;
    }
    report(width, label, name, problem);
  }
}

/**
 * The newest account the flow suite created, which is the only kind that has a
 * finished 30-day plan. The `resp-` accounts this file writes stop at
 * onboarding on purpose and would show an empty dashboard.
 */
async function credentials() {
  if (!existsSync(LEDGER)) return null;
  const line = (await readFile(LEDGER, "utf8"))
    .split("\n")
    .filter((l) => l.startsWith("flow-"))
    .pop();
  if (!line) return null;
  const [email, password] = line.split("\t");
  return { email, password };
}

const server = await startApp({ appPort: 3118, stubPort: 8118 });
const page = await launch();
const account = await credentials();

/** A brand new account so the wizard is reachable; it never saves a profile. */
async function signUpForOnboarding() {
  const email = `resp-${randomUUID().slice(0, 8)}@contentkita.test`;
  const password = `Uj!${randomUUID().slice(0, 10)}`;
  await appendFile(LEDGER, `${email}\t${password}\n`);
  await page.goto(`${server.origin}/signup`);
  await page.waitFor(`return !!document.querySelector('input[type="email"]')`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('form button[type="submit"]');
  try {
    await page.waitFor(`return location.pathname === "/onboarding"`, {
      timeout: 30_000,
      label: "redirect to onboarding",
    });
  } catch (error) {
    // A signup that does not land on the wizard has usually been refused by
    // Firebase Auth, and the screen says why. Carrying that sentence into the
    // failure saves the next person a debugging session.
    const said = (await page.text()).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`${error.message}\n  at: ${await page.url()}\n  screen: ${said}`);
  }
}

async function signIn({ email, password }) {
  await page.goto(`${server.origin}/login`);
  await page.waitFor(`return !!document.querySelector('input[type="email"]')`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('form button[type="submit"]');
  await page.waitFor(`return location.pathname !== "/login"`, {
    timeout: 30_000,
    label: "sign in",
  });
}

async function signOut() {
  await page.clearSite(server.origin);
  await page.goto(`${server.origin}/login`);
  await page.waitFor(`return !!document.querySelector('input[type="email"]')`, {
    timeout: 30_000,
    label: "the signed-out login screen",
  });
}

try {
  // --- Signed out -------------------------------------------------------
  for (const width of WIDTHS) {
    await page.setViewport(width, width < 768 ? 780 : 900);

    await page.goto(server.origin);
    await checkPage(page, width, "landing");

    await page.goto(`${server.origin}/signup`);
    await page.waitFor(`return !!document.querySelector('input[type="email"]')`);
    await checkPage(page, width, "signup");
  }

  // --- Onboarding, on a fresh account that has no restaurant yet ---------
  await signUpForOnboarding();
  for (const width of WIDTHS) {
    await page.setViewport(width, width < 768 ? 780 : 900);
    await page.goto(`${server.origin}/onboarding`);
    await page.waitFor(`return document.body.innerText.includes("Nama restoran")`, {
      timeout: 30_000,
      label: "the wizard",
    });
    // Every step is a different layout, and the file pickers and choice grids
    // on the later ones are where a narrow screen actually breaks.
    for (const label of ["step 1 of 4", "step 2 of 4", "step 3 of 4", "step 4 of 4"]) {
      await checkPage(page, width, `onboarding ${label}`);
      if (label !== "step 4 of 4") {
        await page.clickText("Seterusnya");
        await page.waitFor(`return true`);
      }
    }
  }
  await signOut();

  // --- Signed in, with a real 30-day plan --------------------------------
  if (!account) {
    console.log(
      `\n  SKIP dashboard / content detail / profile — no account with a plan in ${LEDGER}.` +
        `\n       Run npm run test:flow first.\n`,
    );
  } else {
    await signIn(account);
    for (const width of WIDTHS) {
      await page.setViewport(width, width < 768 ? 780 : 900);

      await page.goto(`${server.origin}/dashboard`);
      await page.waitFor(
        `return document.querySelectorAll('ol li a[href^="/content/"]').length > 0`,
        { timeout: 30_000, label: "the plan" },
      );
      await checkPage(page, width, "dashboard");

      const href = await page.eval(
        `return document.querySelector('ol li a[href^="/content/"]').getAttribute("href");`,
      );
      await page.goto(`${server.origin}${href}`);
      await page.waitFor(`return document.body.innerText.includes("Salin caption")`);
      await checkPage(page, width, "content detail");

      // The edit form is a different layout on the same route, and is where a
      // phone-sized textarea most easily breaks out of its container.
      await page.clickText("Edit");
      await page.waitFor(`return document.querySelectorAll("textarea").length >= 3`);
      await checkPage(page, width, "content detail (editing)");

      // The creative pack: the one screen with a horizontally scrolling strip
      // inside a page that also carries a fixed bottom bar, which is the exact
      // shape that leaks sideways scroll. Checked after the strip has stopped
      // loading, so what is measured is the finished layout rather than the
      // skeleton.
      await page.goto(`${server.origin}/pack`);
      await page.waitFor(
        `return !!document.querySelector('nav[aria-label="Hari dalam pack"]')` +
          ` && /\\d+\\/\\d+ design siap/.test(document.body.innerText)`,
        { timeout: 45_000, label: "the pack" },
      );
      await checkPage(page, width, "pack");

      await page.goto(`${server.origin}/profile`);
      await page.waitFor(`return document.body.innerText.includes("Log keluar")`);
      await checkPage(page, width, "profile");
    }
  }
} finally {
  await page.close();
  server.stop();

  const failed = results.filter((r) => r.problem);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  for (const r of failed) console.log(`  ${r.width}px ${r.page} — ${r.name}: ${r.problem}`);
  console.log(
    `\nThrowaway accounts are listed in ${LEDGER}. Remove them with:` +
      `\n  node --conditions=react-server --env-file=.env.local scripts/cleanup-flow.mjs`,
  );
  if (failed.length > 0) process.exitCode = 1;
}
