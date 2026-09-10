/**
 * Look at the month.
 *
 * Thirty designs that pass thirty assertions can still be thirty posters no
 * restaurant owner would put on their feed, and no test in `lib/creative`
 * can tell you which. This renders a real pack — the real composer, the real
 * renderer, a real canvas in real Chrome — into contact sheets you can open
 * and judge the way the owner will: all at once, side by side, small.
 *
 * It is a development tool, not part of the product. Nothing here runs in the
 * app, nothing here is imported by the app, and the photographs it is pointed
 * at stay outside the repository.
 *
 *   node --conditions=react-server scripts/preview.ts --photos ~/some/photos
 *
 * `--photos` is a directory of jpg/png/webp files standing in for a
 * restaurant's own pictures. Leave it off to see what a restaurant with no
 * photographs is given, which is a different product and worth looking at.
 *
 * `--restaurant path.json` reads a profile instead of the demo one, and
 * `--real` writes the month with the actual model rather than the mock — the
 * production generator, the production prompt, the production validator, with
 * the HTTP hop and the Firebase token taken out because there is no browser
 * here to hold either:
 *
 *   node --conditions=react-server --env-file=.env.local scripts/preview.ts \
 *     --real --restaurant scripts/fixtures/acceptance-restaurant.json \
 *     --photos .preview/photos
 *
 * `--real` spends money and needs OPENAI_API_KEY in the environment. The key
 * is read by the same server-side client the route uses and never reaches the
 * page, the sheet or the repository.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateItems } from "../lib/ai/generate.ts";
import { decodeGenerationRequest } from "../lib/ai/request.ts";
import { AiContentGenerator } from "../lib/content/ai-generator.ts";
import { DEMO_RESTAURANT } from "../lib/content/demo.ts";
import { MockContentGenerator } from "../lib/content/mock-generator.ts";
import type {
  AssetRef,
  ContentItem,
  ContentPlan,
  RestaurantProfile,
} from "../lib/content/types.ts";
import { assignPhotos, composePackDay } from "../lib/creative/pack.ts";
import type { Creative } from "../lib/creative/types.ts";
import { launch } from "./lib/cdp.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/* --------------------------------- options -------------------------------- */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const OUT = resolve(arg("out") ?? join(ROOT, ".preview"));
const PHOTO_DIR = arg("photos");
const COLUMNS = Number(arg("columns") ?? 5);
const TILE = Number(arg("tile") ?? 340);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const PROFILE_PATH = arg("restaurant");
const START = arg("start") ?? "2026-03-01";
/** Write the month with the real model instead of the mock generator. */
const REAL = process.argv.includes("--real");
/** `--days 3,4,18` to look closely at a few rather than at the month. */
const DAYS = (arg("days") ?? "")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

/* -------------------------------- the pack -------------------------------- */

async function photos(): Promise<AssetRef[]> {
  if (!PHOTO_DIR) return [];
  const dir = resolve(PHOTO_DIR);
  const names = (await readdir(dir))
    .filter((name) => IMAGE_EXT.has(extname(name).toLowerCase()))
    .sort();

  await mkdir(join(OUT, "photos"), { recursive: true });
  const refs: AssetRef[] = [];
  for (const [i, name] of names.entries()) {
    await copyFile(join(dir, name), join(OUT, "photos", name));
    refs.push({
      path: `preview/photos/${name}`,
      url: `/photos/${encodeURIComponent(name)}`,
      name,
      contentType: "image/jpeg",
      size: 0,
      // Ordered, so the pool below deals them out in the order they are listed.
      uploadedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    });
  }
  return refs;
}

/**
 * The restaurant the month is written for.
 *
 * The photographs found on disk are put on the profile as well as handed to
 * the composer, because the writer is told whether the kitchen has pictures
 * and writes differently when it does.
 */
async function restaurant(pool: readonly AssetRef[]): Promise<RestaurantProfile> {
  const base = PROFILE_PATH
    ? (JSON.parse(await readFile(resolve(PROFILE_PATH), "utf8")) as RestaurantProfile)
    : DEMO_RESTAURANT;
  return { ...base, photos: [...pool] };
}

/**
 * The production generator with the network taken out.
 *
 * `AiContentGenerator` is used rather than reimplemented so the batching, the
 * carried-forward hooks and the completeness check are the ones the app runs.
 * Its `fetch` is replaced by the route's own body: decode, generate, answer.
 * What is skipped is only what a browser would have supplied — a bearer token
 * and an HTTP hop — and the entitlement check, which is a question about a
 * paid pack and not about the writing.
 */
function realGenerator(ownerId: string): AiContentGenerator {
  return new AiContentGenerator({
    getToken: async () => "preview",
    endpoint: "/preview",
    fetchImpl: (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as unknown;
      const outcome = await generateItems(decodeGenerationRequest(body, ownerId));
      for (const violation of outcome.violations) {
        console.error(
          `  rejected day ${violation.day}: ${violation.code} — ${violation.detail}`,
        );
      }
      console.log(
        `  ${outcome.items.length} days · ${outcome.calls} call(s)` +
          `${outcome.repairs ? `, ${outcome.repairs} repair` : ""}` +
          ` · ${(outcome.durationMs / 1000).toFixed(1)}s · ${outcome.models.join(", ")}`,
      );
      return new Response(JSON.stringify({ items: outcome.items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });
}

async function plan(profile: RestaurantProfile): Promise<ContentPlan> {
  const generator = REAL ? realGenerator(profile.id) : new MockContentGenerator();
  return generator.generatePlan({ restaurant: profile, startDate: START });
}

function pack(
  profile: RestaurantProfile,
  content: ContentPlan,
  pool: readonly AssetRef[],
): Creative[] {
  const assigned = assignPhotos(content.items, pool, profile.bestSellers);
  return content.items
    .filter((item) => DAYS.length === 0 || DAYS.includes(item.day))
    .map((item) =>
      composePackDay(profile, content.id, item, assigned, `${START}T00:00:00.000Z`),
    );
}

/**
 * The month as words.
 *
 * The sheet answers whether the posters look designed. It cannot answer
 * whether the captions sound like a Malaysian running a kedai, so the copy is
 * written out beside it in the order an owner would scroll it.
 */
function transcript(profile: RestaurantProfile, items: readonly ContentItem[]): string {
  const emoji = /\p{Extended_Pictographic}/gu;
  const lines = [
    `# ${profile.name} — ${items.length} hari`,
    "",
    `${profile.cuisine} · ${profile.location} · mula ${START}`,
    "",
  ];
  for (const item of items) {
    const count = (item.caption.match(emoji) ?? []).length;
    lines.push(
      `## Hari ${String(item.day).padStart(2, "0")} · ${item.date} · ${item.category}` +
        (item.occasion ? ` · ${item.occasion.name} (${item.occasion.kind}/${item.occasion.role})` : ""),
      "",
      `**${item.hook}**`,
      "",
      item.caption,
      "",
      `_CTA:_ ${item.cta || "—"}`,
      `_Hashtags:_ ${item.hashtags.length ? item.hashtags.map((h) => `#${h}`).join(" ") : "—"}`,
      `_Emoji:_ ${count}`,
      "",
    );
  }
  return lines.join("\n");
}

/* ------------------------------- the browser ------------------------------ */

/**
 * The renderer, compiled for a browser.
 *
 * Only four files: `render.ts` and the three it imports. Compiling the whole
 * app would mean bundling React to look at a canvas.
 */
async function compile(): Promise<void> {
  await new Promise<void>((done, fail) => {
    const tsc = spawn(
      "npx",
      [
        "tsc",
        "lib/creative/render.ts",
        "--outDir", join(OUT, "js"),
        "--rootDir", ".",
        "--module", "esnext",
        "--moduleResolution", "bundler",
        "--target", "es2022",
        "--rewriteRelativeImportExtensions",
        "--skipLibCheck",
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
    tsc.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`tsc exited ${code}`)),
    );
  });
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>ContentKita — contact sheet</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #EDEBE7; font: 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
  .sheet { padding: 24px; }
  .grid { display: grid; grid-template-columns: repeat(${COLUMNS}, ${TILE}px); gap: 20px; }
  figure { margin: 0; }
  canvas { width: ${TILE}px; height: auto; display: block; background: #fff;
           box-shadow: 0 1px 2px rgba(0,0,0,.16), 0 8px 24px rgba(0,0,0,.08); }
  figcaption { padding-top: 6px; color: #5A554E; letter-spacing: .02em; }
</style>
<div class="sheet"><div class="grid" id="grid"></div></div>
<script type="module">
  import { drawCreative } from "./js/lib/creative/render.js";

  const creatives = await fetch("./creatives.json").then((r) => r.json());
  const paths = new Set();
  for (const c of creatives) {
    for (const el of c.elements) if (el.kind === "image" && el.source) paths.add(el.source.path);
  }
  const bank = {};
  await Promise.all([...paths].map(async (path) => {
    const url = creatives.flatMap((c) => c.elements)
      .find((el) => el.kind === "image" && el.source?.path === path).source.url;
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    bank[path] = { source: bitmap, width: bitmap.width, height: bitmap.height };
  }));

  const fonts = { display: "Georgia, 'Times New Roman', serif", body: "ui-sans-serif, system-ui, sans-serif" };
  const grid = document.getElementById("grid");
  for (const creative of creatives) {
    const scale = ${TILE} * 2 / creative.canvas.width;
    const figure = document.createElement("figure");
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(creative.canvas.width * scale);
    canvas.height = Math.round(creative.canvas.height * scale);
    drawCreative(canvas.getContext("2d"), creative, { scale, images: bank, fonts, showPlaceholders: true });
    const caption = document.createElement("figcaption");
    caption.textContent = "Hari " + String(creative.day).padStart(2, "0") + " · " + creative.template + " · " + creative.format;
    figure.append(canvas, caption);
    grid.append(figure);
  }
  window.__ready = true;
</script>
`;

/* ---------------------------------- run ----------------------------------- */

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const pool = await photos();
  const profile = await restaurant(pool);
  const content = await plan(profile);
  const creatives = pack(profile, content, pool);
  await writeFile(join(OUT, "creatives.json"), JSON.stringify(creatives, null, 2));
  await writeFile(join(OUT, "plan.json"), JSON.stringify(content, null, 2));
  await writeFile(join(OUT, "pack.md"), transcript(profile, content.items));
  await writeFile(join(OUT, "index.html"), PAGE);
  await compile();

  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = join(OUT, path === "/" ? "index.html" : path);
    try {
      const body = await readFile(file);
      const type =
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".json": "application/json",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".webp": "image/webp",
        }[extname(file).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  // `launch` attaches `close` to the page after construction, which the driver
  // documents but its inferred type does not carry.
  const page = (await launch({ port: 9337, headless: true })) as Awaited<
    ReturnType<typeof launch>
  > & { close: () => Promise<void> };
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: COLUMNS * (TILE + 20) + 40,
      height: 2000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitFor("return window.__ready === true", { timeout: 60_000 });

    const height = await page.eval("return document.body.scrollHeight");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: COLUMNS * (TILE + 20) + 40,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const shot = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    await writeFile(join(OUT, "sheet.png"), Buffer.from(shot.data, "base64"));

    for (const message of page.console) {
      if (message.type === "error" || message.type === "exception") {
        console.error(`page ${message.type}: ${message.text}`);
      }
    }
  } finally {
    await page.close();
    server.close();
  }

  console.log(
    `${creatives.length} creatives, ${pool.length} photographs, ` +
      `${REAL ? "real model" : "mock generator"}`,
  );
  console.log(join(OUT, "sheet.png"));
  console.log(join(OUT, "pack.md"));
}

await main();
