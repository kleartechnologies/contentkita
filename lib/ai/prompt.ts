import { ALWAYS_FORBIDDEN, scheduleLines, type RestaurantBrief } from "../content/brief.ts";
import { TONE_OPTIONS } from "../content/demo.ts";
import { CLICHES, MAX_EMOJI, openingWord } from "../content/voice.ts";
import type { CopyFramework } from "../content/types.ts";

/**
 * Prompt construction.
 *
 * Pure string building with no SDK import, so every instruction the model
 * receives can be asserted in a unit test. Nothing here reads a Firestore
 * document directly — it only ever renders a `RestaurantBrief`, which has
 * already decided what is a fact and what is a gap.
 *
 * ## Why it is laid out in three blocks
 *
 * A month is written in five batches, so whatever is repeated is paid for five
 * times. The prompt is therefore ordered by how often it changes, most stable
 * first, because OpenAI's prompt cache only ever discounts a *prefix*:
 *
 *   1. `HOUSE` — byte-identical in every request ContentKita will ever send.
 *      The role, the voice rules, the output contract and the fabrications that
 *      are out of bounds for every restaurant.
 *   2. The restaurant block — identical for all five batches of one pack: the
 *      owner's facts, their tone and language, what they may be quoted on, and
 *      the gaps they left that must not be filled in.
 *   3. The user message — the only part that changes between batches: which
 *      days to write, which hooks are already taken, and why a previous attempt
 *      was rejected.
 *
 * Blocks 1 and 2 are the system message, so the identical prefix is as long as
 * it can honestly be, and moving the facts out of every batch and into the
 * prefix removes the repetition rather than merely discounting it.
 *
 * ## What the cache actually does here
 *
 * It works, and an earlier note in this file said it did not. That note was
 * written from a probe that changed the prefix between calls, so it measured a
 * cold cache five times and read the zeros as a floor. Redone properly — one
 * never-before-sent prefix, a constant `prompt_cache_key`, five *different*
 * suffixes — 1,408 of a 1,536-token prefix came back cached from the second
 * call onward on gpt-4.1, and 1,280 of 1,546 on gpt-5.4-mini, holding across a
 * repeat pass and five brand-new suffixes. The documented 1,024-token minimum
 * is the real one; ContentKita's ~1,670-token prefix clears it. A benchmarked
 * month confirms it end to end: one pack logged 8,960 of 13,448 input tokens
 * cached, 67%.
 *
 * An occasional 0 in the middle of a warm run is a routing miss, not a floor.
 * Nothing is built to depend on the discount arriving.
 *
 * The discount is real but small, because input is the cheap side of this
 * product: batch one always pays full price to fill the cache, and two owners
 * share only the `HOUSE` block. Four cached prefixes are worth roughly a tenth
 * of a cent a pack against an output bill twenty times larger. So the ordering
 * below still earns its place mainly by stating the facts once instead of five
 * times — the cache discount on top is free, not the reason.
 */

const TONE_GUIDE: Record<string, string> = {
  friendly: "Mesra dan hangat, macam jiran yang dah lama kenal. Sopan tapi tak formal.",
  casual: "Selamba dan santai. Bahasa harian, ayat pendek, macam hantar WhatsApp.",
  funny: "Ada jenaka ringan. Kelakar yang natural, bukan cuba-cuba lawak.",
  premium: "Kemas, tenang, yakin. Ayat lebih pendek dan bersih. Tiada emoji berlebihan.",
  family: "Hangat dan inklusif. Sesuai dibaca oleh mak ayah dan anak-anak.",
  kampung: "Loghat santai dan rasa rumah. Perkataan harian, tak berlagak.",
};

const FRAMEWORK_GUIDE: Record<CopyFramework, string> = {
  aida:
    "AIDA — mula dengan satu ayat yang tarik perhatian, bina minat dengan detail sebenar, timbulkan rasa nak makan, tutup dengan satu ajakan yang jelas.",
  pas:
    "PAS — sebut satu situasi yang pembaca memang alami, biar dia rasa, kemudian tunjuk makanan ini sebagai jalan keluar yang senang.",
  story:
    "Cerita — buka dengan satu babak kecil yang benar, bawa ke makanan, tinggalkan satu perasaan, baru ajak.",
  fab:
    "Terangkan satu perkara konkrit tentang makanan itu (bahan, cara masak, tekstur) dan kenapa ia penting kepada orang yang makan.",
  direct:
    "Terus terang — satu idea sahaja, ayat pendek, tiada bunga-bunga. Cakap apa yang ada dan ajak.",
};

const LANGUAGE_GUIDE: Record<string, string> = {
  ms: `Tulis SEMUA caption, hook dan CTA dalam Bahasa Melayu Malaysia.
Bukan Bahasa Indonesia. Jangan sekali-kali guna: banget, nggak, gak, udah, gimana, kalian, aja, yuk, bikin, doang, kuliner, lho, deh, sih.
Bukan BM formal karangan sekolah. Tulis macam orang Malaysia betul-betul menaip di Instagram.
Perkataan harian dibenarkan dan digalakkan: tak, dah, ni, tu, memang, boleh tahan, sedap, jom, korang.
Perkataan English yang memang biasa dipakai orang Malaysia boleh masuk secara semula jadi (order, share, save, lunch, best) — tapi ayat asas kekal BM.`,
  en: `Write ALL captions, hooks and CTAs in English.
Natural social-media English as a Malaysian small business would write it — warm, direct, not corporate.
Short sentences. No exclamation-mark stacking. Do not translate Malay idioms literally.
Malaysian food words stay as they are (nasi lemak, teh ais, kopitiam) and are never translated or italicised.`,
  rojak: `Tulis dalam campuran BM dan English yang natural — gaya yang orang Malaysia memang guna online.
Ayat asas BM, perkataan English masuk di tempat yang memang orang guna English.
Jangan tukar bahasa di tengah-tengah ayat sampai jadi janggal. Bukan Bahasa Indonesia.`,
};

/**
 * The house style.
 *
 * Rewritten for M6 around one test: read the caption out loud. If it sounds
 * like a person who works at the shop said it, it passes. If it sounds like an
 * agency, a brochure or a language model being helpful, it fails.
 *
 * The banned-phrase list is not duplicated here in prose — it is generated from
 * `CLICHES` in `lib/content/voice.ts`, which is the same list the validator
 * rejects against. An instruction and its enforcement should be one fact.
 */
const VOICE_RULES = `CARA MENULIS — INI YANG MEMBEZAKAN CONTENT INI DARIPADA CONTENT AI:

Suara:
- Tulis macam orang yang memang kerja di kedai itu sedang bercakap dengan pelanggan Malaysia. Bukan agensi, bukan robot, bukan brosur.
- Ayat pendek. Perenggan pendek (satu hingga tiga ayat). Baris kosong antara perenggan.
- Panjang berubah-ubah. Ada hari caption tiga baris sahaja. Ada hari lima perenggan. Jangan semua hari sama panjang.
- Benarkan personaliti: jujur, mesra, sikit jenaka kalau nada jenama membenarkan. Kedai kecil tak sempurna — itu yang buat orang percaya.
- Buatkan orang rasa lapar. Cakap tentang bau, bunyi, tekstur, panas, waktu — perkara yang boleh dilihat dalam gambar sendiri.

Hook:
- Setiap hari diberi SATU bentuk hook dalam jadual di bawah. Ikut bentuk itu. Itu yang buat sebulan content tak berbunyi sama.
- Jangan mula dengan nama restoran.
- Jangan lebih daripada satu hook bermula dengan "Jom" dalam permintaan ini, dan elakkan "Jom" sepenuhnya kalau boleh.
- Jangan dua hook dalam permintaan ini bermula dengan perkataan pertama yang sama.

Emoji dan tanda baca:
- Emoji: jadual memberi had untuk setiap hari — ikut had itu, jangan lebih. Kebanyakan hari memang tiada emoji langsung, dan itu betul. Hari yang dibenarkan satu, letak satu sahaja dan letak dalam ayat, bukan di hujung setiap perenggan dan bukan sebagai bullet. Tidak pernah lebih daripada ${MAX_EMOJI} satu caption.
- Tanda seru: paling banyak satu satu post. "!!!" tak pernah dibenarkan.
- Jangan tulis HURUF BESAR SEMUA untuk menjerit.

CTA:
- Satu ajakan sahaja, dan jadual memberi bentuknya untuk hari itu. Ada hari tak perlu ajakan kuat — hari macam tu tulis ajakan yang lembut ("Tengok petang nanti.", "Simpan dulu."), tapi medan cta MESTI ada isi. Jangan hantar kosong.
- PENDEK. Satu ayat, di bawah 40 aksara kalau boleh. CTA ini DICETAK ATAS POSTER, dalam kotak kecil — ayat panjang tak muat dan terpaksa ditinggalkan. "Simpan post ni dulu." muat. "Kalau korang sekitar sini, reply atau WhatsApp kalau nak tanya apa yang ada pagi ni." tak muat.
- Kalau ada ajakan yang panjang atau bersyarat, letak di perenggan akhir caption. Medan cta ini untuk baris pendek sahaja.
- Jangan ulang ayat CTA yang sama dari hari ke hari.

Yang DILARANG kerana ia bunyi macam iklan lama:
${CLICHES.map((c) => `- "${c}"`).join("\n")}
- Sebarang desakan palsu: "terhad", "hari ini sahaja", "sementara stok masih ada" — melainkan pemilik memang memberitahu kami syarat itu.
- Label rangka kerja dalam caption: "Attention:", "Problem:", "Solution:".
- Ayat "tujuan" daripada jadual. Itu nota strategi untuk anda sahaja; pelanggan tidak sepatutnya membacanya.
- Ayat dalam tanda petik seolah-olah ada orang menyebutnya — pelanggan, pekerja atau pemilik. Kami tiada kata-kata sebenar sesiapa. Tanda petik hanya untuk teks yang dicadangkan pada gambar (medan visual/design).
- Nama orang yang direka. Guna nama HANYA kalau pemilik menyebutnya. Kalau tidak: "staf dapur", "orang belakang tabir".
- Terjemahan literal daripada English.

Contoh perbezaan (gaya sahaja — JANGAN salin ayat ini):
- Lemah: "Nikmati hidangan kami yang lazat, sesuai untuk keluarga dan rakan-rakan!"
- Lebih baik: "Pukul 12.30 meja penuh. Pukul 2 dah senyap. Kalau nak duduk selesa, datang lambat sikit."
- Lemah: "Jangan lepaskan peluang keemasan untuk merasai kelazatan yang tiada tandingan!"
- Lebih baik: "Kuah ni direbus dari pagi. Tak ada jalan pintas untuk rasa macam tu."`;

/** The output contract, described in words as well as enforced by the schema. */
const FIELD_SPEC = `Untuk setiap hari yang diminta, pulangkan:
- day: nombor hari (ikut jadual, jangan tukar)
- hook: satu ayat pembuka yang hentikan scroll
- caption: caption penuh yang boleh terus dipost (2-5 perenggan pendek, guna \\n\\n antara perenggan)
- cta: satu ajakan yang jelas dan senang dibuat
- visualIdea: gambar apa yang perlu diambil — sudut, cahaya, apa yang ada dalam frame
- videoIdea: untuk hari yang ditanda [perlukan videoIdea], terangkan shot demi shot secara ringkas. Untuk hari lain, hantar string kosong.
- designDirection: arahan reka bentuk — warna, susunan, teks atas gambar (kalau ada). Ringkas dan boleh dilaksanakan.
- hashtags: 3 hingga 8 hashtag tanpa simbol #, relevan dengan makanan dan tempat. Untuk WhatsApp, hantar array kosong.

Pulangkan JSON dengan medan "items" — satu objek bagi setiap hari yang diminta, dan tiada hari lain.`;

/**
 * The rule that matters most, in the half that does not depend on the
 * restaurant. Every sentence here is true of every profile, so it is stated
 * once at the front of the prefix rather than rebuilt per pack.
 */
const TRUTH_DOCTRINE = `PERATURAN KEBENARAN — INI PALING PENTING:
Anda menulis untuk perniagaan sebenar. Apa-apa yang anda reka akan dibaca oleh pelanggan sebenar sebagai fakta.
Anda hanya boleh menyatakan perkara yang tersenarai dalam "FAKTA YANG DISAHKAN" dan "APA YANG BOLEH DISEBUT" di bawah.
Kalau sesuatu maklumat tiada, JANGAN cuba isi tempat kosong itu.
Tulis content yang memang tidak memerlukan maklumat tersebut.
Contoh: tiada promosi, maka tulis behind-the-scenes, cerita kedai atau soalan engagement.
Lebih baik post yang jujur dan biasa, daripada post menarik yang mengandungi satu ayat rekaan.

DILARANG SAMA SEKALI dalam mana-mana medan, untuk mana-mana restoran:
${ALWAYS_FORBIDDEN.map((f) => `- ${f}`).join("\n")}`;

/**
 * Block 1: the part of the prompt that never varies.
 *
 * A module constant rather than a function on purpose — if it took an argument
 * it could stop being identical, and the prefix would stop being cacheable
 * without anyone noticing.
 */
export const HOUSE = `Anda penulis content social media untuk restoran kecil dan sederhana di Malaysia.
Anda menulis untuk pemilik kedai yang sibuk: mereka akan salin caption anda dan terus post.

${VOICE_RULES}

${FIELD_SPEC}

${TRUTH_DOCTRINE}`;

/** The restaurant-specific half of the truth rules: what this owner may be quoted on. */
function quotableRules(brief: RestaurantBrief): string {
  const q = brief.quotable;
  const allowed: string[] = [];

  if (q.dishes.length) {
    allowed.push(`Nama menu yang WUJUD dan boleh disebut: ${q.dishes.join(", ")}. Jangan cipta nama menu lain.`);
  } else {
    allowed.push(
      "Pemilik TIDAK memberi nama menu. Jangan sebut nama hidangan yang spesifik langsung. Tulis tentang kedai, orang dan suasana.",
    );
  }

  if (q.promotion) {
    const parts = [`Promosi sebenar: "${q.promotion}"`];
    if (q.promotionDates) parts.push(`Tarikh/waktu: "${q.promotionDates}"`);
    if (q.promotionConditions) parts.push(`Syarat: "${q.promotionConditions}"`);
    allowed.push(
      `${parts.join(". ")}. Sebut promosi ini HANYA pada hari yang berkategori "promotion" atau "urgency", dan tulis butirannya betul-betul seperti di atas. Jangan tambah syarat, tarikh atau potongan yang tidak tersenarai.`,
    );
  } else {
    allowed.push(
      "Restoran ini TIADA promosi. Jangan tulis sebarang promosi, diskaun, tawaran, harga istimewa atau apa-apa yang percuma pada mana-mana hari.",
    );
  }

  allowed.push(
    q.prices.length
      ? `Harga yang dibenarkan, satu-satunya: ${q.prices.join(", ")}. Sebarang nombor ringgit lain adalah rekaan dan akan ditolak.`
      : "Pemilik TIDAK memberi sebarang harga. Jangan tulis sebarang jumlah ringgit, RM, atau harga dalam mana-mana medan.",
  );

  return allowed.map((a) => `- ${a}`).join("\n");
}

/**
 * Blocks 1 and 2 together: everything that is the same for all five batches of
 * one pack.
 *
 * The owner's facts live here rather than in the per-batch message, which is
 * the single biggest reason a month got cheaper: they used to be restated in
 * full five times, and they are the largest variable-length thing in the
 * prompt.
 */
export function systemPrompt(brief: RestaurantBrief): string {
  const tone = TONE_GUIDE[brief.toneLabel] ?? TONE_GUIDE[TONE_OPTIONS[0].value];

  return `${HOUSE}

${LANGUAGE_GUIDE[brief.language] ?? LANGUAGE_GUIDE.ms}

NADA JENAMA: ${tone}

RANGKA KERJA PENULISAN (guna secara berselang-seli sepanjang bulan, pilih yang sesuai dengan kategori hari itu):
${brief.frameworks.map((f) => `- ${FRAMEWORK_GUIDE[f]}`).join("\n")}

GAYA PENULISAN YANG DIPILIH PEMILIK: ${brief.styleLabels.join(", ")}

GAYA VISUAL YANG DIPILIH PEMILIK: ${brief.visualStyleLabel}${brief.brandColours ? `\nWARNA JENAMA: ${brief.brandColours}` : ""}${brief.referenceDesigns ? `\nRUJUKAN DESIGN: ${brief.referenceDesigns}` : ""}
Gunakan ini dalam setiap "designDirection".
${brief.exampleCaption ? `\nCONTOH SUARA PEMILIK (tiru gaya dan panjangnya, jangan salin ayatnya, jangan ambil fakta daripadanya):\n"""${brief.exampleCaption}"""\n` : ""}
FAKTA YANG DISAHKAN (hanya ini yang anda tahu):
${brief.known.map((k) => `- ${k.label}: ${k.value}`).join("\n")}

APA YANG BOLEH DISEBUT TENTANG RESTORAN INI:
${quotableRules(brief)}

DILARANG untuk restoran ini kerana pemilik tidak memberitahu kami:
${brief.forbidden.map((f) => `- ${f}`).join("\n")}

Pelan penuh ialah ${brief.days} hari. Setiap permintaan di bawah meminta sebahagian daripadanya sahaja.`;
}

/**
 * Block 3: the only part that differs between one batch and the next.
 *
 * Used for every request — a whole month is asked for in batches, a single day
 * is asked for on its own, and a repair asks only for the days that failed.
 * Deliberately short: the facts, the styles and the output contract are already
 * in the prefix, so restating them here would be paying five times for the same
 * words and would risk the two copies disagreeing.
 */
/**
 * The words earlier batches already opened with.
 *
 * A month is written in five separate requests, so without this the model
 * cheerfully starts day 7, day 13 and day 19 with the same word — each batch is
 * varied within itself and the pack is not. Naming the worn-out openings costs
 * a handful of tokens and is the cheapest variety we buy.
 */
function usedOpenings(avoid: readonly string[]): string {
  const words = [...new Set(avoid.map(openingWord).filter(Boolean))];
  if (words.length === 0) return "";
  return `Perkataan pembuka yang sudah dipakai dalam pelan ini: ${words.join(", ")}. Pilih pembuka yang lain.\n`;
}

export function daysPrompt(
  brief: RestaurantBrief,
  days: number[],
  options: { reasons?: string[]; avoid?: string[]; avoidCtas?: string[] } = {},
): string {
  const wanted = brief.schedule.filter((s) => days.includes(s.day));

  const reasons = options.reasons?.length
    ? `\nCUBAAN SEBELUM INI DITOLAK. Betulkan perkara berikut dan jangan ulanginya:\n${options.reasons
        .map((r) => `- ${r}`)
        .join("\n")}\n`
    : "";

  const avoid = options.avoid?.length
    ? `\nHOOK berikut sudah digunakan dalam pelan ini. Tulis sesuatu yang jelas berbeza — bukan ayat yang sama dengan satu dua perkataan ditukar, dan bukan ayat yang sama tentang hidangan yang sama:\n${options.avoid
        .map((h) => `- ${h}`)
        .join("\n")}\n${usedOpenings(options.avoid)}`
    : "";

  // Short CTAs repeat far more readily than hooks do — there are only so many
  // ways to say "save this" — and a month with "Simpan post ni dulu." on five
  // of its posters is a month that looks stamped out. Each batch is written
  // blind to the others, so the ones already used are named.
  const usedCtas = options.avoidCtas?.length
    ? `\nCTA berikut sudah dipakai dalam pelan ini. Guna ajakan yang lain:\n${[
        ...new Set(options.avoidCtas),
      ]
        .map((c) => `- ${c}`)
        .join("\n")}\n`
    : "";

  return `Tulis ${wanted.length === 1 ? "hari" : "hari-hari"} berikut sahaja. Jangan tukar kategori atau platform:
${scheduleLines({ ...brief, schedule: wanted })}
${reasons}${avoid}${usedCtas}
Pulangkan JSON dengan medan "items" yang mengandungi tepat ${wanted.length} objek — hanya hari yang disenaraikan di atas.`;
}

/**
 * The JSON Schema the provider is held to.
 *
 * Structural correctness is enforced here so the validator can spend its effort
 * on claims rather than on missing braces.
 */
export const ITEMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "day",
          "hook",
          "caption",
          "cta",
          "visualIdea",
          "videoIdea",
          "designDirection",
          "hashtags",
        ],
        properties: {
          day: { type: "integer" },
          hook: { type: "string" },
          caption: { type: "string" },
          cta: { type: "string" },
          visualIdea: { type: "string" },
          videoIdea: { type: "string" },
          designDirection: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
