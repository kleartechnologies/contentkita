import { scheduleLines, type RestaurantBrief } from "../content/brief.ts";
import { TONE_OPTIONS } from "../content/demo.ts";
import type { CopyFramework } from "../content/types.ts";

/**
 * Prompt construction.
 *
 * Pure string building with no SDK import, so every instruction the model
 * receives can be asserted in a unit test. Nothing here reads a Firestore
 * document directly — it only ever renders a `RestaurantBrief`, which has
 * already decided what is a fact and what is a gap.
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

/** The house style. Everything here is about *not* sounding like an ad robot. */
const VOICE_RULES = `CARA MENULIS:
- Tulis macam manusia yang kerja di kedai itu, bukan agensi iklan.
- Hook mesti satu ayat yang buat orang berhenti scroll. Jangan mula dengan nama restoran.
- Caption 2 hingga 5 perenggan pendek. Guna baris kosong antara perenggan.
- Emoji: paling banyak dua satu post, dan hanya kalau ia memang membantu. Banyak post patut tiada emoji langsung.
- Tanda seru: paling banyak satu satu post. Jangan sekali-kali "!!!".
- CTA mesti satu tindakan yang senang dan spesifik (save post, komen, share, tanya, datang). Jangan ulang CTA yang sama hari ke hari.
- Setiap hari mesti ada hook yang berbeza. Jangan guna corak ayat yang sama berulang kali sepanjang 30 hari.
- JANGAN tulis label rangka kerja seperti "Attention:", "Interest:", "Problem:" dalam caption. Rangka kerja itu untuk struktur sahaja, bukan untuk dibaca.
- JANGAN guna bahasa iklan yang menyampah: "jangan lepaskan peluang keemasan", "sangat lazat sekali", "wajib cuba sekarang juga".
- JANGAN letak sebarang ayat dalam tanda petik seolah-olah ada orang menyebutnya — pelanggan, pekerja atau pemilik. Kami tiada kata-kata sebenar sesiapa. Tanda petik hanya boleh untuk teks yang dicadangkan pada gambar (dalam medan visual/design).
- JANGAN reka nama sesiapa. Guna nama orang HANYA kalau pemilik sendiri menyebutnya dalam fakta di bawah. Kalau tidak, rujuk mereka secara umum: "staf dapur", "orang belakang tabir".
- Elakkan ayat terjemahan literal daripada English.`;

/** The rule that matters most. Repeated deliberately — it is the product promise. */
function truthRules(brief: RestaurantBrief): string {
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

  return `PERATURAN KEBENARAN — INI PALING PENTING:
Anda menulis untuk perniagaan sebenar. Apa-apa yang anda reka akan dibaca oleh pelanggan sebenar sebagai fakta.
Anda hanya boleh menyatakan perkara yang tersenarai dalam "FAKTA YANG DISAHKAN" di bawah.

${allowed.map((a) => `- ${a}`).join("\n")}

DILARANG SAMA SEKALI dalam mana-mana medan:
${brief.forbidden.map((f) => `- ${f}`).join("\n")}

Kalau sesuatu maklumat tiada, JANGAN cuba isi tempat kosong itu.
Tulis content yang memang tidak memerlukan maklumat tersebut.
Contoh: tiada promosi, maka tulis behind-the-scenes, cerita kedai atau soalan engagement.
Lebih baik post yang jujur dan biasa, daripada post menarik yang mengandungi satu ayat rekaan.`;
}

export function systemPrompt(brief: RestaurantBrief): string {
  const tone =
    TONE_GUIDE[brief.toneLabel] ??
    TONE_GUIDE[TONE_OPTIONS[0].value];

  return `Anda penulis content social media untuk restoran kecil dan sederhana di Malaysia.
Anda menulis untuk pemilik kedai yang sibuk: mereka akan salin caption anda dan terus post.

${LANGUAGE_GUIDE[brief.language] ?? LANGUAGE_GUIDE.ms}

NADA JENAMA: ${tone}

RANGKA KERJA PENULISAN (guna secara berselang-seli sepanjang bulan, pilih yang sesuai dengan kategori hari itu):
${brief.frameworks.map((f) => `- ${FRAMEWORK_GUIDE[f]}`).join("\n")}

${VOICE_RULES}

${truthRules(brief)}`;
}

/** The output contract, described in words as well as enforced by the schema. */
const FIELD_SPEC = `Untuk setiap hari, pulangkan:
- day: nombor hari (ikut jadual, jangan tukar)
- objective: satu ayat pendek — apa yang post ini cuba capai
- hook: satu ayat pembuka yang hentikan scroll
- caption: caption penuh yang boleh terus dipost (2-5 perenggan pendek, guna \\n\\n antara perenggan)
- cta: satu ajakan yang jelas dan senang dibuat
- visualIdea: gambar apa yang perlu diambil — sudut, cahaya, apa yang ada dalam frame
- videoIdea: untuk hari yang ditanda [perlukan videoIdea], terangkan shot demi shot secara ringkas. Untuk hari lain, hantar string kosong.
- designDirection: arahan reka bentuk — warna, susunan, teks atas gambar (kalau ada). Ringkas dan boleh dilaksanakan.
- hashtags: 3 hingga 8 hashtag tanpa simbol #, relevan dengan makanan dan tempat. Untuk WhatsApp, hantar array kosong.`;

export function planPrompt(brief: RestaurantBrief): string {
  return `Sediakan pelan content ${brief.days} hari untuk restoran ini.

FAKTA YANG DISAHKAN (hanya ini yang anda tahu):
${brief.known.map((k) => `- ${k.label}: ${k.value}`).join("\n")}

GAYA VISUAL YANG DIPILIH PEMILIK: ${brief.visualStyleLabel}${brief.brandColours ? `\nWARNA JENAMA: ${brief.brandColours}` : ""}${brief.referenceDesigns ? `\nRUJUKAN DESIGN: ${brief.referenceDesigns}` : ""}
Gunakan ini dalam setiap "designDirection".

GAYA PENULISAN YANG DIPILIH PEMILIK: ${brief.styleLabels.join(", ")}
${brief.exampleCaption ? `\nCONTOH SUARA PEMILIK (tiru gaya dan panjangnya, jangan salin ayatnya, jangan ambil fakta daripadanya):\n"""${brief.exampleCaption}"""\n` : ""}
JADUAL — tulis untuk setiap hari mengikut kategori dan platform yang ditetapkan. Jangan tukar kategori atau platform:
${scheduleLines(brief)}

${FIELD_SPEC}

Pulangkan JSON dengan medan "items" yang mengandungi tepat ${brief.days} objek, satu untuk setiap hari 1 hingga ${brief.days}.`;
}

/**
 * The prompt for rewriting a subset of days.
 *
 * Used both for regenerating a single day at the owner's request and for
 * repairing days that failed validation. Only the named days are asked for, so
 * a repair never costs a second full month.
 */
export function daysPrompt(
  brief: RestaurantBrief,
  days: number[],
  options: { reasons?: string[]; avoid?: string[] } = {},
): string {
  const wanted = brief.schedule.filter((s) => days.includes(s.day));

  const reasons = options.reasons?.length
    ? `\nCUBAAN SEBELUM INI DITOLAK. Betulkan perkara berikut dan jangan ulanginya:\n${options.reasons
        .map((r) => `- ${r}`)
        .join("\n")}\n`
    : "";

  const avoid = options.avoid?.length
    ? `\nHOOK berikut sudah digunakan dalam pelan ini. Tulis sesuatu yang jelas berbeza:\n${options.avoid
        .map((h) => `- ${h}`)
        .join("\n")}\n`
    : "";

  return `Tulis semula ${wanted.length === 1 ? "hari" : "hari-hari"} berikut sahaja untuk restoran ini.

FAKTA YANG DISAHKAN (hanya ini yang anda tahu):
${brief.known.map((k) => `- ${k.label}: ${k.value}`).join("\n")}

GAYA VISUAL: ${brief.visualStyleLabel}${brief.brandColours ? ` | WARNA JENAMA: ${brief.brandColours}` : ""}
GAYA PENULISAN: ${brief.styleLabels.join(", ")}
${reasons}${avoid}
HARI YANG DIMINTA:
${wanted
  .map((s) => {
    const line = scheduleLines({ ...brief, schedule: [s] });
    return line;
  })
  .join("\n")}

${FIELD_SPEC}

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
          "objective",
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
          objective: { type: "string" },
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
