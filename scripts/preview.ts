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
 * `--plan path.json` re-renders the copy of an earlier run instead of writing
 * a new month, which is how a crop is changed and looked at again.
 *
 * `--real` spends money and needs OPENAI_API_KEY in the environment. The key
 * is read by the same server-side client the route uses and never reaches the
 * page, the sheet or the repository.
 *
 * `--full` also writes every day out at export resolution, into `days/`. The
 * contact sheet is for judging the month; those are for judging a poster —
 * a crop that survives a 340-pixel tile can still be soft at 1080, and a
 * headline that looks balanced small can be a line too long full size.
 *
 * ## Why Chrome runs before the composer
 *
 * A photograph's signature — see `lib/creative/photo.ts` — is read off the
 * decoded pixels, and in the product that happens in the browser at upload.
 * There is no image decoder in Node here and adding one to a development
 * script to avoid using the browser that is already being launched would be
 * two implementations of the same thirty-two-square sample. So the run goes:
 * launch, sample the photographs through the same `signatureFromGrid` the app
 * calls, hand the numbers to the composer, then render. Without that the
 * preview would compose against `null` signatures and show M6's art direction
 * rather than this one's.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { GRID, signatureFromGrid } from "../lib/creative/photo.ts";
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
/** `--plan .preview/plan.json` re-renders a month already written. */
const PLAN_PATH = arg("plan");
/** Also write every day at export resolution into `days/`. */
const FULL = process.argv.includes("--full");
/** `--days 3,4,18` to look closely at a few rather than at the month. */
const DAYS = (arg("days") ?? "")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

/* -------------------------------- the pack -------------------------------- */

/**
 * Read the source photographs into memory, before anything is deleted.
 *
 * Split from writing them out because the obvious place to keep a set of
 * pictures you are previewing against is inside the preview directory, and
 * the run starts by emptying that directory. Reading first makes pointing
 * `--photos` at `.preview/photos` survivable instead of destructive.
 */
interface SourcePhoto {
  name: string;
  body: Buffer;
}

async function readPhotos(): Promise<SourcePhoto[]> {
  if (!PHOTO_DIR) return [];
  const dir = resolve(PHOTO_DIR);
  const names = (await readdir(dir))
    .filter((name) => IMAGE_EXT.has(extname(name).toLowerCase()))
    .sort();
  const found: SourcePhoto[] = [];
  for (const name of names) {
    found.push({ name, body: await readFile(join(dir, name)) });
  }
  return found;
}

async function photos(source: readonly SourcePhoto[]): Promise<AssetRef[]> {
  if (source.length === 0) return [];
  await mkdir(join(OUT, "photos"), { recursive: true });
  const refs: AssetRef[] = [];
  for (const [i, photo] of source.entries()) {
    await writeFile(join(OUT, "photos", photo.name), photo.body);
    refs.push({
      path: `preview/photos/${photo.name}`,
      url: `/photos/${encodeURIComponent(photo.name)}`,
      name: photo.name,
      contentType: "image/jpeg",
      size: photo.body.byteLength,
      // Ordered, so the pool below deals them out in the order they are listed.
      uploadedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    });
  }
  await writeFile(
    join(OUT, "photos.json"),
    JSON.stringify(refs.map((r) => ({ name: r.name, url: r.url }))),
  );
  return refs;
}

/**
 * The same thirty-two-square sample the app takes at upload, taken in Chrome.
 *
 * Returned keyed by filename and folded onto the pool, so from here on the
 * preview's `AssetRef`s carry exactly what a real upload would have carried.
 * A photograph the page failed to decode is simply left without one, which is
 * the same state as a photograph uploaded before M6.5 — the composer has a
 * defined answer for it and the run continues.
 */
interface Sample {
  width: number;
  height: number;
  rgb: number[];
}

function withSignatures(
  pool: readonly AssetRef[],
  samples: Record<string, Sample>,
): AssetRef[] {
  return pool.map((ref) => {
    const sample = samples[ref.name];
    if (!sample) return ref;
    return {
      ...ref,
      signature: signatureFromGrid(sample.rgb, sample.width, sample.height),
    };
  });
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

/**
 * The month's copy — written, or read back from a previous run.
 *
 * `--plan .preview/plan.json` re-renders a month that has already been paid
 * for. Looking at thirty posters, moving a crop and looking again is the whole
 * of the art-direction loop, and doing it against freshly written copy changes
 * two things at once: you cannot tell whether the day improved or merely got a
 * shorter headline. Held still, the sheet answers the only question being
 * asked of it.
 */
async function plan(
  profile: RestaurantProfile,
  saved: ContentPlan | null,
): Promise<ContentPlan> {
  if (saved) return saved;
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

/**
 * Georgia for display, the system stack for body.
 *
 * The app's own resolved families. Named here rather than left to the default
 * so the sheet is set in the type an exported poster is set in — a contact
 * sheet in a different face is a contact sheet of a different design.
 */
const FONTS =
  `{ display: "Georgia, 'Times New Roman', serif", ` +
  `body: "ui-sans-serif, system-ui, sans-serif" }`;

/** The photo sampler. No imports: it is thirty lines of canvas. */
const SAMPLE_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>ContentKita — photo signatures</title>
<script type="module">
  const G = ${GRID};
  const list = await fetch("./photos.json").then((r) => r.json());
  const out = {};
  for (const photo of list) {
    try {
      const bitmap = await createImageBitmap(await (await fetch(photo.url)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = G;
      canvas.height = G;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, G, G);
      const data = ctx.getImageData(0, 0, G, G).data;
      const rgb = new Array(G * G * 3);
      for (let i = 0; i < G * G; i++) {
        rgb[i * 3] = data[i * 4];
        rgb[i * 3 + 1] = data[i * 4 + 1];
        rgb[i * 3 + 2] = data[i * 4 + 2];
      }
      out[photo.name] = { width: bitmap.width, height: bitmap.height, rgb };
      bitmap.close?.();
    } catch (error) {
      console.error("sample failed for " + photo.name + ": " + error);
    }
  }
  window.__samples = out;
</script>
`;

/**
 * One poster at export resolution, on demand.
 *
 * Rendered one at a time and handed back as a data URL rather than screenshot
 * from the contact sheet, because the sheet draws at tile scale and a crop
 * that survives 340 pixels can still be soft at 1080.
 */
const FULL_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>ContentKita — full size</title>
<script type="module">
  import { drawCreative } from "./js/lib/creative/render.js";

  const creatives = await fetch("./creatives.json").then((r) => r.json());
  const bank = {};
  const sources = new Map();
  for (const c of creatives) {
    for (const el of c.elements) {
      if (el.kind === "image" && el.source) sources.set(el.source.path, el.source.url);
    }
  }
  await Promise.all([...sources].map(async ([path, url]) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    bank[path] = { source: bitmap, width: bitmap.width, height: bitmap.height };
  }));

  const fonts = ${FONTS};
  window.__render = (day) => {
    const creative = creatives.find((c) => c.day === day);
    if (!creative) return null;
    const canvas = document.createElement("canvas");
    canvas.width = creative.canvas.width;
    canvas.height = creative.canvas.height;
    drawCreative(canvas.getContext("2d"), creative, {
      scale: 1,
      images: bank,
      fonts,
      showPlaceholders: true,
    });
    return canvas.toDataURL("image/png");
  };
  window.__ready = true;
</script>
`;

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

  const fonts = ${FONTS};
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
  const source = await readPhotos();
  // Both read before the directory is emptied: the obvious place to keep the
  // plan you are re-rendering is the one the last run wrote it to.
  const saved = PLAN_PATH
    ? (JSON.parse(await readFile(resolve(PLAN_PATH), "utf8")) as ContentPlan)
    : null;
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const found = await photos(source);
  await writeFile(join(OUT, "sample.html"), SAMPLE_PAGE);
  await writeFile(join(OUT, "full.html"), FULL_PAGE);
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
  const origin = `http://127.0.0.1:${port}`;

  // `launch` attaches `close` to the page after construction, which the driver
  // documents but its inferred type does not carry.
  const page = (await launch({ port: 9337, headless: true })) as Awaited<
    ReturnType<typeof launch>
  > & { close: () => Promise<void> };

  let creatives: Creative[] = [];
  let pool = found;
  try {
    /* 1. What the photographs are. Before anything is composed. */
    if (found.length > 0) {
      await page.goto(`${origin}/sample.html`);
      const samples = (await page.waitFor("return window.__samples", {
        timeout: 60_000,
      })) as Record<string, Sample>;
      pool = withSignatures(found, samples);
      for (const ref of pool) {
        const sig = ref.signature;
        console.log(
          `  ${ref.name}: ` +
            (sig
              ? `${sig.width}x${sig.height} ${sig.kind}` +
                `${sig.monochrome ? " mono" : ""}` +
                ` · brightness ${sig.brightness.toFixed(2)}` +
                ` · detail ${sig.detail.toFixed(3)}` +
                ` · focus ${sig.focus.x.toFixed(2)},${sig.focus.y.toFixed(2)}` +
                ` · quiet ${sig.quiet ?? "none"}`
              : "no signature"),
        );
      }
    }

    /* 2. The month, written and composed against those numbers. */
    const profile = await restaurant(pool);
    const content = await plan(profile, saved);
    creatives = pack(profile, content, pool);
    await writeFile(join(OUT, "creatives.json"), JSON.stringify(creatives, null, 2));
    await writeFile(join(OUT, "plan.json"), JSON.stringify(content, null, 2));
    await writeFile(join(OUT, "pack.md"), transcript(profile, content.items));

    /* 3. The contact sheet: the month as the owner will scroll it. */
    const width = COLUMNS * (TILE + 20) + 40;
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 2000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.goto(`${origin}/`);
    await page.waitFor("return window.__ready === true", { timeout: 60_000 });

    const height = await page.eval("return document.body.scrollHeight");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const shot = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    await writeFile(join(OUT, "sheet.png"), Buffer.from(shot.data, "base64"));

    /* 4. Each poster at the size it is actually published. */
    if (FULL) {
      await mkdir(join(OUT, "days"), { recursive: true });
      await page.goto(`${origin}/full.html`);
      await page.waitFor("return window.__ready === true", { timeout: 60_000 });
      for (const creative of creatives) {
        const url = (await page.eval(
          `return window.__render(${creative.day});`,
        )) as string | null;
        if (!url) continue;
        const name =
          `hari-${String(creative.day).padStart(2, "0")}` +
          `-${creative.template}-${creative.format}.png`;
        await writeFile(
          join(OUT, "days", name),
          Buffer.from(url.slice(url.indexOf(",") + 1), "base64"),
        );
      }
    }

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
      `${PLAN_PATH ? "saved plan" : REAL ? "real model" : "mock generator"}`,
  );
  console.log(join(OUT, "sheet.png"));
  console.log(join(OUT, "pack.md"));
  if (FULL) console.log(join(OUT, "days"));
}

await main();
