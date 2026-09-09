import assert from "node:assert/strict";
import test from "node:test";

import { buildBrief } from "../content/brief.ts";
import { DEMO_RESTAURANT } from "../content/demo.ts";
import type { RestaurantProfile } from "../content/types.ts";
import { ITEMS_SCHEMA, daysPrompt, systemPrompt } from "./prompt.ts";

/**
 * What the model is actually told.
 *
 * The prompt is the only place the anti-hallucination rules can be stated
 * before the fact, so the instructions that matter are asserted here rather
 * than assumed. Every check below corresponds to a fabrication the validator
 * would otherwise have to catch on the way back — cheaper to prevent than to
 * repair.
 */

const brief = (r: RestaurantProfile, days = 30) => buildBrief(r, days);

/**
 * Everything the model is sent for one request.
 *
 * The prompt is split across two messages so the stable half can be cached, but
 * a rule is no weaker for living in the system message — what matters is that
 * it reaches the model. Assertions about content therefore run against the
 * pair, and the tests that care *which* half a thing is in say so explicitly.
 */
function sent(b: ReturnType<typeof brief>, days?: number[]): string {
  const wanted = days ?? b.schedule.map((s) => s.day);
  return `${systemPrompt(b)}\n${daysPrompt(b, wanted)}`;
}

const NO_PROMO: RestaurantProfile = {
  ...DEMO_RESTAURANT,
  promotion: null,
  promotionDates: "",
  promotionConditions: "",
  menuNotes: "Masak harian. Tak guna premix.",
};

/* --- the truth rules ------------------------------------------------------ */

test("a restaurant with no promotion is told plainly that it has none", () => {
  const system = systemPrompt(brief(NO_PROMO));

  assert.match(system, /TIADA promosi/);
  assert.match(system, /Jangan tulis sebarang promosi/);
});

test("a restaurant with no price is forbidden from writing any ringgit amount", () => {
  const system = systemPrompt(brief(NO_PROMO));

  assert.match(system, /TIDAK memberi sebarang harga/);
});

test("a restaurant with a real promotion gets its exact wording, not a paraphrase", () => {
  const system = systemPrompt(brief(DEMO_RESTAURANT));

  assert.ok(system.includes("Set Lunch RM12.90"));
  assert.ok(system.includes("Dine-in sahaja"));
  assert.match(system, /Jangan tambah syarat, tarikh atau potongan/);
});

test("only the owner's own prices are named as allowed", () => {
  const system = systemPrompt(brief(DEMO_RESTAURANT));

  assert.ok(system.includes("rm12.90"));
  assert.match(system, /satu-satunya/);
});

test("the dishes the owner listed are the only ones nameable", () => {
  const system = systemPrompt(brief(DEMO_RESTAURANT));

  for (const dish of DEMO_RESTAURANT.bestSellers) assert.ok(system.includes(dish));
  assert.match(system, /Jangan cipta nama menu lain/);
});

test("a restaurant that listed no dishes is told not to name any", () => {
  const system = systemPrompt(brief({ ...DEMO_RESTAURANT, bestSellers: [] }));

  assert.match(system, /TIDAK memberi nama menu/);
});

test("every unlicensed subject is named as forbidden", () => {
  const system = systemPrompt(brief(NO_PROMO));

  for (const subject of [
    /testimoni/i,
    /anugerah/i,
    /nombor satu/i,
    /statistik/i,
    /stok terhad/i,
    /kalori/i,
    /jaminan/i,
    /halal/i,
    /delivery/i,
    /waktu operasi/i,
  ]) {
    assert.match(system, subject);
  }
});

test("subjects the owner did supply are not forbidden", () => {
  // This owner mentions halal and delivery, so the prompt must not tell the
  // writer those subjects are off limits.
  const licensed: RestaurantProfile = {
    ...NO_PROMO,
    menuNotes: "Semua bahan halal. Boleh order melalui GrabFood juga.",
  };
  const system = systemPrompt(brief(licensed));

  assert.ok(!/DILARANG[\s\S]*status halal atau sijil halal/.test(system));
  assert.ok(!/DILARANG[\s\S]*perkhidmatan delivery/.test(system));
});

test("the missing-information rule tells the writer to work around gaps", () => {
  const system = systemPrompt(brief(NO_PROMO));

  assert.match(system, /JANGAN cuba isi tempat kosong/);
  assert.match(system, /tidak memerlukan maklumat tersebut/);
});

/* --- language ------------------------------------------------------------- */

test("a Malay plan names the Indonesian words that must not appear", () => {
  const system = systemPrompt(brief({ ...NO_PROMO, language: "ms" }));

  assert.match(system, /Bahasa Melayu Malaysia/);
  assert.match(system, /Bukan Bahasa Indonesia/);
  assert.ok(system.includes("banget"));
});

test("an English plan is instructed in English and keeps Malaysian food words", () => {
  const system = systemPrompt(brief({ ...NO_PROMO, language: "en" }));

  assert.match(system, /Write ALL captions/);
  assert.ok(system.includes("nasi lemak"));
});

test("a rojak plan is told to mix naturally, not to translate", () => {
  const system = systemPrompt(brief({ ...NO_PROMO, language: "rojak" }));

  assert.match(system, /campuran BM dan English/);
});

/* --- tone and framework --------------------------------------------------- */

test("the chosen brand tone reaches the prompt", () => {
  const premium = systemPrompt(brief({ ...NO_PROMO, tone: "premium" }));
  const kampung = systemPrompt(brief({ ...NO_PROMO, tone: "kampung" }));

  assert.match(premium, /NADA JENAMA: Kemas, tenang, yakin/);
  assert.match(kampung, /NADA JENAMA: Loghat santai/);
  assert.notEqual(premium, kampung);
});

test("an AIDA copy style puts the AIDA framework in the prompt", () => {
  const system = systemPrompt(brief({ ...NO_PROMO, copyStyles: ["menjual"] }));

  assert.match(system, /AIDA/);
  assert.match(system, /tarik perhatian/);
  assert.match(system, /tutup dengan satu ajakan/);
});

test("a storytelling style asks for a scene rather than a sales structure", () => {
  const system = systemPrompt(brief({ ...NO_PROMO, copyStyles: ["bercerita"] }));

  assert.match(system, /Cerita —/);
});

test("framework labels are explicitly banned from the caption itself", () => {
  const system = systemPrompt(brief({ ...NO_PROMO, copyStyles: ["menjual"] }));

  assert.match(system, /JANGAN tulis label rangka kerja/);
});

/* --- the whole-month request ---------------------------------------------- */

test("a whole-month request asks for exactly the number of days requested", () => {
  const b = brief(NO_PROMO, 30);

  assert.match(daysPrompt(b, b.schedule.map((s) => s.day)), /tepat 30 objek/);
  assert.match(systemPrompt(b), /Pelan penuh ialah 30 hari/);
});

test("the schedule is spelled out day by day and marked immutable", () => {
  const b = brief(NO_PROMO, 30);
  const prompt = sent(b);

  for (const day of b.schedule) {
    assert.ok(prompt.includes(`Hari ${day.day} | ${day.category} | ${day.platform}`), `day ${day.day}`);
  }
  assert.match(prompt, /Jangan tukar kategori atau platform/);
});

test("video days are marked so a video idea is actually written", () => {
  assert.match(sent(brief(NO_PROMO)), /\[perlukan videoIdea\]/);
});

test("only facts the owner supplied appear as confirmed facts", () => {
  const sparse: RestaurantProfile = {
    ...NO_PROMO,
    location: "",
    description: "",
    targetCustomers: "",
    menuNotes: "",
  };
  const prompt = sent(brief(sparse));

  assert.ok(!prompt.includes("Lokasi:"));
  assert.ok(!prompt.includes("Cerita kedai:"));
  assert.ok(prompt.includes("Nama restoran: Warung Kak Ina"));
});

test("an uploaded menu is described as unread so nothing is inferred from it", () => {
  const withMenu: RestaurantProfile = {
    ...NO_PROMO,
    menuFile: {
      path: "restaurants/u/menus/m.pdf",
      url: "https://example.com/m.pdf",
      name: "m.pdf",
      contentType: "application/pdf",
      size: 1,
      uploadedAt: "2026-01-01T00:00:00.000Z",
    },
  };
  const prompt = sent(brief(withMenu));

  assert.match(prompt, /TIDAK dibaca/);
  assert.match(prompt, /Jangan andaikan apa-apa daripadanya/);
  // The file itself never reaches the provider.
  assert.ok(!prompt.includes("example.com"));
  assert.ok(!prompt.includes("restaurants/u/menus"));
});

test("brand colours and design references steer the design direction", () => {
  const branded: RestaurantProfile = {
    ...NO_PROMO,
    brandColours: "Hijau tua dan krim",
    referenceDesigns: "Macam kedai kopi moden",
  };
  const prompt = sent(brief(branded));

  assert.ok(prompt.includes("Hijau tua dan krim"));
  assert.ok(prompt.includes("Macam kedai kopi moden"));
  assert.match(prompt, /designDirection/);
});

test("an example caption is used as a voice sample, not as a source of facts", () => {
  const withExample: RestaurantProfile = {
    ...NO_PROMO,
    exampleCaption: "Petang ni kami buka macam biasa, jom singgah.",
  };
  const prompt = sent(brief(withExample));

  assert.ok(prompt.includes("Petang ni kami buka macam biasa"));
  assert.match(prompt, /jangan ambil fakta daripadanya/);
});

/* --- the days prompt ------------------------------------------------------ */

test("a single-day rewrite asks for exactly that day", () => {
  const prompt = daysPrompt(brief(NO_PROMO), [12]);

  assert.match(prompt, /tepat 1 objek/);
  assert.ok(prompt.includes("Hari 12 |"));
  assert.ok(!prompt.includes("Hari 13 |"));
});

test("hooks already on screen are listed so a rewrite comes back different", () => {
  const prompt = daysPrompt(brief(NO_PROMO), [12], {
    avoid: ["Bau kicap panas tu memang tak boleh tipu."],
  });

  assert.ok(prompt.includes("Bau kicap panas tu memang tak boleh tipu."));
  assert.match(prompt, /jelas berbeza/);
});

test("a repair quotes the validator's own reason back at the model", () => {
  const prompt = daysPrompt(brief(NO_PROMO), [3], {
    reasons: ["Buang semua harga. Pemilik tidak memberi sebarang harga."],
  });

  assert.match(prompt, /DITOLAK/);
  assert.ok(prompt.includes("Buang semua harga."));
});

test("a rewrite of several days asks for all of them and no others", () => {
  const prompt = daysPrompt(brief(NO_PROMO), [2, 5, 9]);

  assert.match(prompt, /tepat 3 objek/);
  for (const day of [2, 5, 9]) assert.ok(prompt.includes(`Hari ${day} |`));
});

/* --- the output contract -------------------------------------------------- */

test("the schema requires every field the product renders", () => {
  const props = ITEMS_SCHEMA.properties.items.items;

  const required: readonly string[] = props.required;

  for (const field of [
    "day",
    "hook",
    "caption",
    "cta",
    "visualIdea",
    "videoIdea",
    "designDirection",
    "hashtags",
  ]) {
    assert.ok(required.includes(field), field);
    assert.ok(field in props.properties, field);
  }
});

test("the schema does not ask for anything the app already knows", () => {
  const props = ITEMS_SCHEMA.properties.items.items;
  // `objective` is one sentence per category, written by hand in
  // `CATEGORY_META` and already handed to the writer inside the schedule.
  // Asking for it back would be paying output tokens for a paraphrase.
  assert.ok(!("objective" in props.properties));
  assert.ok(!(props.required as readonly string[]).includes("objective"));
});

test("the schema refuses fields nobody asked for", () => {
  assert.equal(ITEMS_SCHEMA.additionalProperties, false);
  assert.equal(ITEMS_SCHEMA.properties.items.items.additionalProperties, false);
});
