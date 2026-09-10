import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import type { AssetRef, ContentItem, RestaurantProfile } from "../content/types.ts";
import {
  composeCreative,
  defaultName,
  dishInPost,
  formatFor,
  labelForPhoto,
  photoNamesDish,
  photoWordsInPost,
  templateFor,
} from "./compose.ts";
import { GRID, signatureFromGrid } from "./photo.ts";
import { CANVAS, isImage, isLogo, isText, type Creative } from "./types.ts";

const generator = new MockContentGenerator();

async function plan() {
  return generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-03-01",
  });
}

const PHOTO: AssetRef = {
  path: "restaurants/uid-1/creatives/ayam.jpg",
  url: "https://firebasestorage.googleapis.com/v0/b/bucket/o/x?alt=media&token=t",
  name: "ayam.jpg",
  contentType: "image/jpeg",
  size: 1024,
  uploadedAt: "2026-03-01T00:00:00.000Z",
};

function itemFor(patch: Partial<ContentItem>, base: ContentItem): ContentItem {
  return { ...base, ...patch };
}

/* --- format and template -------------------------------------------------- */

test("each platform gets the shape its feed actually publishes", async () => {
  const { items } = await plan();
  const base = items[0];

  assert.equal(formatFor(itemFor({ platform: "instagram", category: "promotion" }, base)), "square");
  assert.equal(formatFor(itemFor({ platform: "facebook", category: "promotion" }, base)), "square");
  assert.equal(formatFor(itemFor({ platform: "instagram", category: "reels" }, base)), "portrait");
  assert.equal(formatFor(itemFor({ platform: "tiktok", category: "reels" }, base)), "story");
  assert.equal(formatFor(itemFor({ platform: "whatsapp", category: "promotion" }, base)), "story");
});

test("the canvas matches the format, in real publishing pixels", async () => {
  const { items } = await plan();
  const creative = composeCreative(DEMO_RESTAURANT, "plan-1", items[0]);

  assert.deepEqual(creative.canvas, CANVAS[creative.format]);
  assert.equal(CANVAS.square.width, 1080);
  assert.equal(CANVAS.portrait.height, 1350);
  assert.equal(CANVAS.story.height, 1920);
});

test("the photo layout is only reachable once a real photo exists", async () => {
  const { items } = await plan();
  const item = itemFor({ platform: "instagram" }, items[0]);

  // No photograph means a typographic family, not a photo layout with a hole.
  assert.equal(templateFor(item, null), "bold-type");
  assert.equal(templateFor(item, PHOTO), "photo-band");
  // WhatsApp Status is read at arm's length; it stays text-first either way.
  assert.equal(templateFor(itemFor({ platform: "whatsapp" }, item), PHOTO), "text-first");
});

test("a fresh creative starts with an empty slot, never a stand-in photograph", async () => {
  const { items } = await plan();
  const creative = composeCreative(DEMO_RESTAURANT, "plan-1", items[0]);

  for (const el of creative.elements) {
    if (isImage(el)) assert.equal(el.source, null);
  }
});

/* --- what may appear on a poster ------------------------------------------ */

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The property that makes a creative safe: composition selects, it never
 * writes. If this fails, some string reached a poster that no validator saw.
 */
test("every word on the poster came from the plan or from the owner", async () => {
  const { id, items } = await plan();

  for (const item of items) {
    const creative = composeCreative(DEMO_RESTAURANT, id, item, { image: PHOTO });
    const allowed = normalise(
      [
        item.hook,
        item.cta,
        item.occasion?.name ?? "",
        DEMO_RESTAURANT.name,
        DEMO_RESTAURANT.location,
        ...DEMO_RESTAURANT.bestSellers,
      ].join(" "),
    );

    for (const el of creative.elements) {
      if (!isText(el)) continue;
      assert.ok(
        allowed.includes(normalise(el.text)),
        `day ${item.day}: "${el.text}" is not in the validated copy`,
      );
    }
  }
});

test("the caption never reaches the poster", async () => {
  const { items } = await plan();
  const item = items[0];
  const creative = composeCreative(DEMO_RESTAURANT, "plan-1", item);

  for (const el of creative.elements) {
    if (isText(el)) assert.notEqual(el.text, item.caption);
  }
});

test("a dish is named only when the post itself mentions it", async () => {
  const { items } = await plan();
  const base = items[0];

  assert.equal(
    dishInPost(itemFor({ hook: "Mee Goreng panas!", caption: "", visualIdea: "" }, base), [
      "Nasi Ayam Penyet",
      "Mee Goreng",
    ]),
    "Mee Goreng",
  );
  assert.equal(
    dishInPost(itemFor({ hook: "Datang hari ini", caption: "", visualIdea: "" }, base), [
      "Mee Goreng",
    ]),
    null,
  );
});

test("a dish mentioned in passing does not become the poster's subject", async () => {
  const { items } = await plan();
  const base = items[0];
  const menu = ["Nasi Lemak Ayam Berempah", "Roti Canai", "Teh Tarik"];

  // The post is plainly about the nasi lemak; roti canai is one item in a
  // list of what else is on the counter. A poster stamped ROTI CANAI over a
  // photograph of nasi lemak is the mismatch this guards against.
  assert.equal(
    dishInPost(
      itemFor(
        {
          hook: "Nak bungkus apa pagi ni?",
          caption:
            "Yang ramai ambil biasanya nasi lemak bungkus, tapi roti canai pun ada.",
          visualIdea: "",
        },
        base,
      ),
      menu,
    ),
    "Nasi Lemak Ayam Berempah",
  );

  // Named only in the third paragraph: mentioned, not featured.
  assert.equal(
    dishInPost(
      itemFor(
        {
          hook: "Pagi kami sibuk.",
          caption: "Meja depan penuh.\n\nOrang datang awal.\n\nPetang ada roti canai.",
          visualIdea: "",
        },
        base,
      ),
      menu,
    ),
    null,
  );
});

test("the hook decides the dish even when the caption lists others first", async () => {
  const { items } = await plan();
  const base = items[0];

  assert.equal(
    dishInPost(
      itemFor(
        {
          hook: "Teh tarik kami tarik sendiri.",
          caption: "Bukan premix. Sesuai dengan roti canai petang.",
          visualIdea: "",
        },
        base,
      ),
      ["Nasi Lemak Ayam Berempah", "Roti Canai", "Teh Tarik"],
    ),
    "Teh Tarik",
  );
});

test("a filename the owner typed says which dish the photograph is of", () => {
  assert.equal(photoNamesDish("Nasi-lemak.jpg", "Nasi Lemak Ayam Berempah"), true);
  assert.equal(photoNamesDish("teh_tarik_2.jpeg", "Teh Tarik"), true);
  assert.equal(photoNamesDish("IMG_4821.jpg", "Nasi Lemak Ayam Berempah"), false);
});

test("one common word in a filename does not claim half the menu", () => {
  // Every second dish in a Malaysian kitchen has "ayam" in it, so a file
  // called ayam.jpg is not evidence of any particular one.
  assert.equal(photoNamesDish("ayam.jpg", "Nasi Ayam Penyet"), false);
  assert.equal(photoNamesDish("nasi-ayam.jpg", "Nasi Ayam Penyet"), true);
});

test("no layout sets a headline in a column too narrow to read", async () => {
  const { id, items } = await plan();

  for (const item of items) {
    const creative = composeCreative(DEMO_RESTAURANT, id, item, {
      images: [PHOTO, PHOTO, PHOTO],
    });
    const headline = creative.elements.find((el) => el.id === "headline");
    assert.ok(headline, `day ${item.day} has a headline`);
    // In real pixels, not fractions: a column is narrow or wide relative to
    // the type in it, and the type is sized in pixels. 320px is roughly six
    // characters at headline size — below that a Malay sentence breaks into
    // two-word lines whichever way it is set.
    const px = headline.box.width * creative.canvas.width;
    assert.ok(
      px >= 320,
      `day ${item.day} (${creative.template}, ${creative.format}) sets its headline in ${Math.round(px)}px`,
    );
  }
});

test("promotions and prices are not copied onto the design", async () => {
  const withPromo: RestaurantProfile = {
    ...DEMO_RESTAURANT,
    promotion: "Set Lunch RM12.90",
  };
  const { items } = await plan();
  const creative = composeCreative(withPromo, "plan-1", items[0]);

  for (const el of creative.elements) {
    if (isText(el)) assert.ok(!el.text.includes("RM12.90"));
  }
});

/* --- brand ---------------------------------------------------------------- */

test("the owner's own colour wins over the style default", async () => {
  const { items } = await plan();
  const branded = composeCreative(
    { ...DEMO_RESTAURANT, brandColours: "#0F7A5A" },
    "plan-1",
    items[0],
  );

  assert.equal(branded.palette.accent.toUpperCase(), "#0F7A5A");
});

test("a logo is placed only when the owner uploaded one", async () => {
  const { items } = await plan();

  const without = composeCreative(DEMO_RESTAURANT, "plan-1", items[0]);
  assert.equal(without.elements.filter(isLogo).length, 0);

  const logo: AssetRef = { ...PHOTO, path: "restaurants/uid-1/logo/mark.png" };
  const with_ = composeCreative({ ...DEMO_RESTAURANT, logo }, "plan-1", items[0]);
  const placed = with_.elements.filter(isLogo);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].source?.path, logo.path);
});

/* --- identity ------------------------------------------------------------- */

test("composing the same day twice produces the same creative", async () => {
  const { items } = await plan();
  const a = composeCreative(DEMO_RESTAURANT, "plan-1", items[3], { now: "2026-03-01T00:00:00.000Z" });
  const b = composeCreative(DEMO_RESTAURANT, "plan-1", items[3], { now: "2026-03-01T00:00:00.000Z" });

  assert.deepEqual(a, b);
});

test("the creative is filed against the day it was built from", async () => {
  const { id, items } = await plan();
  const item = items[5];
  const creative: Creative = composeCreative(DEMO_RESTAURANT, id, item);

  assert.equal(creative.itemId, item.id);
  assert.equal(creative.id, item.id);
  assert.equal(creative.planId, id);
  assert.equal(creative.day, item.day);
  assert.equal(creative.edited, false);
});

test("the default name carries the day, zero-padded so it sorts", async () => {
  const { items } = await plan();
  const name = defaultName(itemFor({ day: 7 }, items[0]), "Nasi Ayam Penyet");

  assert.equal(name, "Nasi Ayam Penyet — Hari 07");
});

/* --- drawings, and what a poster claims about them ------------------------ */

/** A GRID×GRID sample, built by a function of cell position. */
function grid(paint: (x: number, y: number) => [number, number, number]): number[] {
  const out: number[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) out.push(...paint(x / (GRID - 1), y / (GRID - 1)));
  }
  return out;
}

/** The owner's line drawing of a glass of tea, as `photo.ts` reads it. */
const DRAWING: AssetRef = {
  ...PHOTO,
  path: "restaurants/uid-1/creatives/Teh-tarik.jpg",
  name: "Teh-tarik.jpg",
  signature: signatureFromGrid(
    grid((x, y) =>
      x > 0.4 && x < 0.6 && y > 0.35 && y < 0.65 ? [20, 20, 20] : [252, 252, 252],
    ),
    1920,
    2560,
  ),
};

test("a drawing is classified as one and never treated as a photograph", () => {
  assert.equal(DRAWING.signature?.kind, "graphic");
});

test("a drawing never becomes the page it was uploaded to illustrate", async () => {
  const { id, items } = await plan();
  const pictureLed = new Set(["photo-band", "closeup", "local", "festive", "split", "menu-card"]);

  for (const item of items) {
    const template = templateFor(item, DRAWING);
    assert.ok(
      !pictureLed.has(template),
      `day ${item.day} put the drawing behind a full-bleed layout (${template})`,
    );
    // And the pack builder is told the same thing the composer will do.
    const creative = composeCreative(DEMO_RESTAURANT, id, item, { images: [DRAWING] });
    assert.equal(creative.template, template, `day ${item.day} disagreed with the deal`);
  }
});

test("a drawing sits on its own panel rather than under a dark wash", async () => {
  const { id, items } = await plan();
  for (const item of items) {
    const creative = composeCreative(DEMO_RESTAURANT, id, item, { images: [DRAWING] });
    const canvas = creative.canvas;
    // Some families are all type and take no picture at all; they are not the
    // ones this is about.
    for (const el of creative.elements
      .filter(isImage)
      .filter((el) => el.source?.path === DRAWING.path)) {
      assert.ok(!el.scrim, `day ${item.day} washed a drawing`);
      // The slot is cut to the file's own proportions, so filling it crops
      // nothing but the margin the drawing was exported on. That is the whole
      // reason a drawing may be `cover` at all: were the box any other shape,
      // `cover` would slice the artwork itself.
      const shape =
        (el.box.width * canvas.width) / (el.box.height * canvas.height);
      const file = 1920 / 2560;
      assert.ok(
        Math.abs(shape - file) < 0.01,
        `day ${item.day} put a ${file.toFixed(2)} drawing in a ${shape.toFixed(2)} box`,
      );
      assert.ok(
        el.focal.zoom <= 2,
        `day ${item.day} magnified a drawing ${el.focal.zoom}x`,
      );
    }
  }
});

test("a month of the same drawing is not the same poster twice", async () => {
  // Not "not often": not once. A photograph varies by crop, so two hero days
  // on one plate are two pictures; a drawing has no crop, so placement and
  // size have to carry the whole month. Three placements, five sizes and the
  // two-day arrangement flip come to thirty, which is the length of a pack.
  const { id, items } = await plan();
  const seen = new Map<string, number>();
  for (const item of items) {
    const creative = composeCreative(DEMO_RESTAURANT, id, item, { images: [DRAWING] });
    const key = `${creative.template}/${creative.elements
      .map((el) => `${el.id}@${el.box.x},${el.box.y},${el.box.width},${el.box.height}`)
      .join(" ")}`;
    const first = seen.get(key);
    if (first !== undefined) {
      assert.ok(
        item.day - first >= 30,
        `days ${first} and ${item.day} are the same poster (${creative.template})`,
      );
    } else {
      seen.set(key, item.day);
    }
  }
});

test("a photograph is put in the big frame and the drawing behind it", async () => {
  const { id, items } = await plan();
  const collage = items.find(
    (item) => templateFor(item, PHOTO) === "collage",
  );
  assert.ok(collage, "the month has a collage");

  const creative = composeCreative(DEMO_RESTAURANT, id, collage, {
    images: [DRAWING, PHOTO, PHOTO],
  });
  const frames = creative.elements.filter(isImage).filter((el) => el.source !== null);
  assert.ok(frames.length > 1, "the collage drew more than one frame");
  const biggest = frames.reduce((a, b) =>
    a.box.width * a.box.height >= b.box.width * b.box.height ? a : b,
  );
  assert.equal(biggest.source?.path, PHOTO.path, "the drawing took the dominant frame");
});

test("the collage drops to two frames rather than mount a drawing in a sliver", async () => {
  const { id, items } = await plan();
  const day = items.find((item) => templateFor(item, PHOTO) === "collage");
  assert.ok(day, "the month has a collage");

  // The third frame of the collage grid is the small one, and a tall drawing
  // cut to its own proportions inside it comes out a sliver a fraction of the
  // width of the frame above it — day 14 of the M6.5 acceptance pack. Two
  // photographs in a grid that holds together is the better poster.
  const creative = composeCreative(DEMO_RESTAURANT, id, day, {
    images: [PHOTO, PHOTO, DRAWING],
  });
  const frames = creative.elements.filter(isImage).filter((el) => el.source !== null);
  assert.equal(frames.length, 2, "the collage still mounted three pictures");
  for (const frame of frames) {
    assert.notEqual(frame.source?.path, DRAWING.path, "a drawing was mounted anyway");
  }
  // And the two that remain fill the grid: nothing narrower than half the page
  // margin's worth of the frame beside it.
  const widest = Math.max(...frames.map((frame) => frame.box.width));
  for (const frame of frames) {
    assert.ok(
      frame.box.width >= widest / 2,
      `a frame ${frame.box.width.toFixed(2)} wide sits beside one ${widest.toFixed(2)} wide`,
    );
  }
});

test("the poster does not name a dish its own picture contradicts", () => {
  const menu = ["Nasi Ayam Penyet", "Teh Tarik", "Mee Goreng Mamak"];
  // The owner's filename names a different dish on the menu: say nothing.
  assert.equal(labelForPhoto("Nasi Ayam Penyet", "Teh-tarik.jpg", menu), null);
  // The filename names this dish: say it.
  assert.equal(labelForPhoto("Teh Tarik", "teh-tarik-2.jpg", menu), "Teh Tarik");
  // The filename names nothing at all, so it is no evidence either way and the
  // caption's own dish stands.
  assert.equal(labelForPhoto("Nasi Ayam Penyet", "IMG_4821.jpg", menu), "Nasi Ayam Penyet");
  // Nothing to say, or nothing to check it against.
  assert.equal(labelForPhoto(null, "Teh-tarik.jpg", menu), null);
  assert.equal(labelForPhoto("Teh Tarik", null, menu), "Teh Tarik");
});

test("a headline does not end mid-breath", async () => {
  const { id, items } = await plan();
  // Day 3 of an acceptance pack was written "Tengok sini," and printed the
  // comma, 96pt across the top of the page.
  const creative = composeCreative(
    DEMO_RESTAURANT,
    id,
    itemFor({ hook: "Tengok sini," }, items[0]),
    { images: [PHOTO] },
  );
  const headline = creative.elements.filter(isText).find((el) => el.role === "headline");
  assert.equal(headline?.text, "Tengok sini");
  // The writer's own full stop, question mark and words are left alone.
  for (const hook of ["Dah sarapan belum?", "Sambal ni pekat sikit.", "Cuba yang ni"]) {
    const el = composeCreative(DEMO_RESTAURANT, id, itemFor({ hook }, items[0]), {
      images: [PHOTO],
    })
      .elements.filter(isText)
      .find((e) => e.role === "headline");
    assert.equal(el?.text, hook);
  }
});

test("a day is given the photograph its own words name", async () => {
  const { items } = await plan();
  const post = (hook: string, caption = hook): ContentItem =>
    itemFor({ hook, caption }, items[0]);

  // The case that failed: the menu says "Nasi Lemak Ayam Berempah", so the
  // dish search never sees a day about the chicken on its own.
  assert.ok(photoWordsInPost("Ayam-goreng-berempah.jpg", post("Ayam berempah kami direndam semalaman.")) >= 2);
  assert.equal(photoWordsInPost("Roti-canai.jpg", post("Ayam berempah kami direndam semalaman.")), 0);
  // Every word, in order, in the caption's opening paragraph.
  assert.equal(
    photoWordsInPost("Sambal-ikan-bilis.jpg", post("Pagi ni penuh.", "Sambal ikan bilis ni tak dibuat main.\n\nDatang awal.")),
    3,
  );
  // One word is not a claim, and a claim cannot be made out of nothing.
  assert.equal(photoWordsInPost("Sambal-ikan-bilis.jpg", post("Sambal ni tengah naik atas api.")), 0);
  assert.equal(photoWordsInPost("IMG_4821.jpg", post("Nasi lemak pagi ni masih hangat.")), 0);
  // Words the copy says three sentences apart are a coincidence.
  assert.equal(
    photoWordsInPost("Nasi-lemak.jpg", post("Nasi kami masak pagi-pagi, santan lemak sikit hari ni.")),
    0,
  );
  // A day whose subject is further down the caption is mentioning, not
  // featuring — the same rule the dish label follows.
  assert.equal(
    photoWordsInPost("Teh-tarik.jpg", post("Pagi ni sibuk.", "Pagi ni sibuk.\n\nTeh tarik pun laju keluar.")),
    0,
  );
});

test("no poster prints one line through another", async () => {
  // Day 18 of an acceptance pack read "Bawa seorang yang biasa makan sama."
  // straight across "NASI LEMAK MAK YAH", because the festive footer gave the
  // call 0.07..0.67 and the name 0.55..0.93 and nobody had ever laid the two
  // boxes over each other. Four layouts had the same fault. A sweep is cheap:
  // every day, both formats, with and without an occasion, every pair of text
  // boxes.
  const { id, items } = await plan();
  for (const item of items) {
    const days: ContentItem[] = [
      item,
      itemFor(
        {
          occasion: {
            id: "hari-raya-aidilfitri",
            name: "Hari Raya Aidilfitri",
            kind: "holiday",
            role: "on",
          },
        },
        item,
      ),
    ];
    for (const day of days) {
      for (const images of [[], [PHOTO], [PHOTO, PHOTO, PHOTO]]) {
        const creative = composeCreative(DEMO_RESTAURANT, id, day, { images });
        const lines = creative.elements.filter(isText);
        for (let i = 0; i < lines.length; i += 1) {
          for (let j = i + 1; j < lines.length; j += 1) {
            const a = lines[i].box;
            const b = lines[j].box;
            const across = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const down = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            assert.ok(
              across <= 1e-6 || down <= 1e-6,
              `day ${day.day} ${creative.template}/${creative.format} laid ` +
                `${lines[i].id} over ${lines[j].id}`,
            );
          }
        }
      }
    }
  }
});

test("no poster runs its type off the edge of the page", async () => {
  const { id, items } = await plan();
  for (const item of items) {
    for (const images of [[], [PHOTO], [DRAWING], [PHOTO, PHOTO, PHOTO]]) {
      const creative = composeCreative(DEMO_RESTAURANT, id, item, { images });
      for (const el of creative.elements) {
        const { x, y, width, height } = el.box;
        assert.ok(x >= -0.001 && y >= -0.001, `day ${item.day} placed ${el.id} off the top or left`);
        assert.ok(
          x + width <= 1.001 && y + height <= 1.001,
          `day ${item.day} ran ${el.id} past the edge`,
        );
      }
    }
  }
});
