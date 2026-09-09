/**
 * A minimal Chrome DevTools Protocol driver.
 *
 * Deliberately dependency-free. Puppeteer and Playwright each pull in a browser
 * download and a large dependency tree; everything the flow suite needs is a
 * WebSocket and about two hundred lines, and Node has had a global `WebSocket`
 * since v22. Chrome is already installed on any machine that can look at this
 * product, so the driver attaches to the real browser rather than shipping one.
 *
 * The helpers below drive React the way a person does — dispatching the events
 * React actually listens for — rather than poking component state, so a test
 * that passes here means the page really works.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Give up on any single wait rather than hanging a CI run forever. */
const DEFAULT_TIMEOUT = 20_000;

export class TimeoutError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, headless = true } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "contentkita-cdp-"));
  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      ...(headless ? ["--headless=new"] : []),
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const target = await waitForTarget(port);
  const page = await Page.attach(target.webSocketDebuggerUrl);

  page.close = async () => {
    await page.detach();
    child.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  return page;
}

async function waitForTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // Chrome has not opened the port yet.
    }
    await sleep(150);
  }
  throw new Error(`Chrome did not expose a debugging target on port ${port}`);
}

class Page {
  static async attach(url) {
    const socket = new WebSocket(url);
    const page = new Page(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP socket failed")), {
        once: true,
      });
    });
    socket.addEventListener("message", (event) => page.receive(event.data));
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Network.enable");
    await page.send("DOM.enable");
    return page;
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    /** Everything the page logged, so a console error can fail a test. */
    this.console = [];
    /** Every request URL, so "the browser never talks to a provider" is checkable. */
    this.requests = [];
    /** Status per URL, so a failing call can be named rather than guessed at. */
    this.responses = [];
  }

  receive(raw) {
    const message = JSON.parse(raw);
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      this.console.push({
        type: message.params.type,
        text: message.params.args
          .map((a) => a.value ?? a.description ?? a.type)
          .join(" "),
      });
    }
    if (message.method === "Runtime.exceptionThrown") {
      this.console.push({
        type: "exception",
        text: message.params.exceptionDetails.exception?.description ?? "exception",
      });
    }
    if (message.method === "Network.requestWillBeSent") {
      this.requests.push(message.params.request.url);
    }
    if (message.method === "Network.responseReceived") {
      this.responses.push({
        url: message.params.response.url,
        status: message.params.response.status,
      });
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new TimeoutError(`${method} did not answer in 60s`));
        }
      }, 60_000);
    });
  }

  async detach() {
    this.socket.close();
  }

  /** Evaluate an expression in the page and return its value. */
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    }
    return result.result.value;
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor(`return document.readyState === "complete"`);
  }

  /** Poll an expression until it returns something truthy. */
  async waitFor(expression, { timeout = DEFAULT_TIMEOUT, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(expression);
        if (last) return last;
      } catch (error) {
        last = error.message;
      }
      await sleep(200);
    }
    throw new TimeoutError(`timed out waiting for: ${label}\n  last value: ${JSON.stringify(last)?.slice(0, 300)}`);
  }

  /** Whatever sonner is showing, which is where a failure reason lands. */
  async toasts() {
    return this.eval(`
      return [...document.querySelectorAll("[data-sonner-toast]")]
        .map((t) => t.innerText.replace(/\\s+/g, " ").trim());
    `);
  }

  async url() {
    return this.eval("return location.pathname");
  }

  async text() {
    return this.eval("return document.body.innerText");
  }

  /**
   * Type into a field the way a user does.
   *
   * React installs its own value setter on the element, so assigning `.value`
   * directly updates the DOM but leaves React's state stale. Calling the
   * prototype setter and then dispatching `input` is what makes a controlled
   * component actually see the text.
   */
  async fill(selector, value) {
    return this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("no element for " + ${JSON.stringify(selector)});
      const proto = el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    `);
  }

  async click(selector) {
    return this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("no element for " + ${JSON.stringify(selector)});
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    `);
  }

  /** Click the first element matching `selector` whose text contains `text`. */
  async clickText(text, selector = "button, a, label") {
    return this.eval(`
      const want = ${JSON.stringify(text)}.toLowerCase();
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((n) => (n.innerText || n.textContent || "").toLowerCase().includes(want));
      if (!el) throw new Error("no clickable element containing " + want);
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    `);
  }

  /**
   * A real mouse press, dispatched by the browser rather than by script.
   *
   * `el.click()` is enough for almost everything, but it grants no transient
   * user activation, and Chrome refuses clipboard writes without one. Copying
   * is a headline feature of this product, so it is worth clicking for real.
   */
  async clickForReal(text, selector = "button, a") {
    const box = await this.eval(`
      const want = ${JSON.stringify(text)}.toLowerCase();
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((n) => (n.innerText || n.textContent || "").toLowerCase().includes(want));
      if (!el) throw new Error("no clickable element containing " + want);
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    `);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", {
        type,
        x: box.x,
        y: box.y,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
      });
    }
    return true;
  }

  /** Attach a real file to a real <input type=file>. */
  async setFile(selector, path) {
    const { root } = await this.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await this.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (!nodeId) throw new Error(`no file input for ${selector}`);
    await this.send("DOM.setFileInputFiles", { nodeId, files: [path] });
  }

  /**
   * Wipes everything the origin has stored, which is how this driver signs out.
   *
   * The product's own sign-out lives on the profile screen, and that screen is
   * unreachable for an account with no restaurant yet — exactly the account the
   * onboarding checks need. Clearing the origin is not a substitute for testing
   * the real button (scripts/flow.mjs does that); it is how the harness gets
   * back to a clean browser.
   */
  async clearSite(origin) {
    await this.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  }

  async setViewport(width, height = 900) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
  }

  async clearViewport() {
    await this.send("Emulation.clearDeviceMetricsOverride");
  }

  /** Reading the clipboard needs permission; granting it is scoped to origin. */
  async grantClipboard(origin) {
    await this.send("Browser.grantPermissions", {
      origin,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    });
  }

  async clipboard() {
    return this.eval("return await navigator.clipboard.readText();");
  }
}
