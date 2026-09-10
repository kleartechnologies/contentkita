/**
 * The house voice, as testable data.
 *
 * Everything in this file exists because a month of AI captions fails in the
 * same three ways every time, and none of them are caught by a JSON schema:
 *
 *  1. Every caption is *shaped* the same. Different words, identical rhythm —
 *     hook, two lines of praise, a call to action. Thirty of those read as one
 *     post printed thirty times, so the shape is assigned per day here rather
 *     than left to chance.
 *  2. The same handful of stock advertising phrases turn up over and over.
 *     `CLICHES` names them so `validate.ts` can reject them outright.
 *  3. Emoji multiply. A restaurant that puts four emoji in every caption looks
 *     like a spam account, and a restaurant that puts none in any looks like a
 *     bank.
 *
 * Shared by the prompt and the validator on purpose: an instruction the model
 * is given and a rule the output is checked against should be the same fact
 * written once.
 */

/* ------------------------------- hook shapes ------------------------------ */

export interface HookShape {
  id: string;
  /** Told to the writer, in Malay, as an instruction for that specific day. */
  guide: string;
}

/**
 * Eight ways to open a post.
 *
 * Not eight synonyms — eight different sentence structures. That is the part
 * that makes a feed feel written by a person over a month instead of generated
 * in one sitting.
 */
export const HOOK_SHAPES: readonly HookShape[] = [
  { id: "soalan", guide: "Buka dengan satu soalan pendek yang orang memang tanya sendiri." },
  { id: "kenyataan", guide: "Buka dengan satu kenyataan terus, tanpa bunga. Ayat penuh, noktah." },
  { id: "nombor", guide: "Buka dengan satu nombor atau masa yang konkrit — tetapi hanya nombor atau waktu yang pemilik sendiri sebut. Jangan reka waktu yang tepat, jangan sebut harga, jangan cipta statistik." },
  { id: "hidangan", guide: "Mulakan terus dengan nama hidangan atau bahan sebagai perkataan pertama." },
  { id: "babak", guide: "Buka dengan satu babak kecil — apa yang berlaku di kedai, satu ayat sahaja." },
  { id: "pengakuan", guide: "Buka dengan satu pengakuan jujur tentang kedai, walaupun ia tak sempurna." },
  { id: "arahan", guide: "Buka dengan satu arahan pendek kepada pembaca (dua hingga empat perkataan)." },
  { id: "perbandingan", guide: "Buka dengan satu perbandingan atau kontras yang mudah difahami." },
] as const;

/**
 * Which shape day N opens with.
 *
 * The stride is 3 against a list of 8. The two are coprime, so the whole list
 * is used before any shape repeats, and no two neighbouring days — or days two
 * apart — ever share a shape. Pure, so a regenerated day still gets the shape
 * its neighbours were written around.
 */
export function hookShapeFor(day: number): HookShape {
  const n = Math.max(Math.trunc(day), 1) - 1;
  return HOOK_SHAPES[(n * 3) % HOOK_SHAPES.length];
}

/* -------------------------------- CTA shapes ------------------------------ */

/**
 * The shapes a day's invitation may take.
 *
 * Longer than it needs to be for coverage, and deliberately so. A CTA is one
 * short line, so a shape has only so many natural phrasings: ask five days to
 * "ajak simpan post ini" and five posters come back reading "Simpan post ni
 * dulu." word for word — and the CTA is printed on the poster, so the owner
 * sees the repeat in their gallery rather than only in the captions.
 *
 * Ten shapes still returned each stock line three times a month. Fifteen over
 * thirty days means twice, fifteen days apart, and the ones most prone to a
 * single stock answer are split into distinct requests that cannot collapse
 * into each other.
 *
 * Every shape is something the restaurant can honestly ask for. None invites a
 * promotion, a deadline or a claim, because the CTA is printed on the poster
 * and is held to exactly the same truth rules as the caption.
 */
export const CTA_SHAPES: readonly string[] = [
  "Ajak simpan post ini.",
  "Ajak tanya di komen.",
  "Ajak share kepada seorang kawan.",
  "Ajak datang, sebut waktu secara umum sahaja.",
  "Ajak reply atau WhatsApp untuk tanya.",
  "Tutup dengan satu ayat yang tenang — ajakan lembut, bukan arahan.",
  "Ajak komen satu pilihan antara dua.",
  "Ajak tanya apa yang ada hari itu.",
  "Ajak bawa seorang yang mereka selalu makan bersama.",
  "Ajak singgah lain kali, tanpa sebut bila.",
  "Ajak tag seorang yang patut tahu.",
  "Ajak cerita pengalaman mereka sendiri di komen.",
  "Ajak jawab soalan yang ditanya dalam caption.",
  "Ajak follow untuk tengok apa yang keluar hari-hari.",
  "Ajakan paling lembut — satu ayat tenang yang beritahu kami ada di sini. Tetap tulis ayat itu.",
] as const;

/**
 * Which shape day N closes with.
 *
 * Stride 4 against a list of 15: coprime, so all fifteen are used before any
 * repeats, and no two days within four of each other close the same way. Pure,
 * so a regenerated day still gets the shape its neighbours were written
 * around.
 */
export function ctaShapeFor(day: number): string {
  const n = Math.max(Math.trunc(day), 1) - 1;
  return CTA_SHAPES[(n * 4) % CTA_SHAPES.length];
}

/* --------------------------------- cliches -------------------------------- */

/**
 * Phrases that mark a caption as written by a machine or a 2009 brochure.
 *
 * Matched case-insensitively against the whole day, so a rejection is specific
 * and repairable. Kept to phrases that are genuinely dead — ordinary Malaysian
 * words like "sedap", "best" and "rugi" are not here and never should be.
 */
export const CLICHES: readonly string[] = [
  "jangan lepaskan peluang",
  "peluang keemasan",
  "nikmati hidangan kami",
  "sesuai untuk keluarga dan rakan-rakan",
  "sesuai untuk keluarga dan rakan",
  "tunggu apa lagi",
  "wajib cuba",
  "sangat lazat",
  "amat lazat",
  "tiada tandingan",
  "menggamit selera",
  "menggugah selera",
  "memanjakan tekak",
  "memanjakan lidah",
  "syurga makanan",
  "surga makanan",
  "kepuasan pelanggan",
  "berkualiti tinggi",
  "servis terbaik",
  "pengalaman yang tidak dapat dilupakan",
  "hidangan istimewa untuk anda",
  "kelazatan yang",
  "don't miss out",
  "dont miss out",
  "must try",
  "mouthwatering",
  "mouth-watering",
  "we pride ourselves",
  "unforgettable experience",
  "satisfy your cravings",
  "food heaven",
  "second to none",
  "one of a kind experience",
] as const;

/** The first cliché found in a piece of text, or null. */
export function findCliche(text: string): string | null {
  const hay = text.toLowerCase();
  for (const phrase of CLICHES) {
    if (hay.includes(phrase)) return phrase;
  }
  return null;
}

/* ---------------------------------- emoji --------------------------------- */

/**
 * Emoji, counted the way a reader counts them.
 *
 * A flag or a family is one emoji to a human even though it is several code
 * points, so joiners, variation selectors and regional indicator pairs are
 * folded into the glyph they belong to.
 */
const EMOJI = /\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*/gu;
const FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;

export function countEmoji(text: string): number {
  const flags = text.match(FLAG)?.length ?? 0;
  const rest = text.replace(FLAG, "").match(EMOJI)?.length ?? 0;
  return flags + rest;
}

/** The most emoji one caption may carry. Many days should have none at all. */
export const MAX_EMOJI = 3;

/**
 * How many emoji day N is allowed.
 *
 * Told to the writer per day, for the same reason the hook shape is. Asked
 * once, in general, for "zero to three, and many of the best captions have
 * none", a model writes thirty captions with none — which is not what was
 * asked for and reads exactly as uniform as thirty captions with three. A real
 * restaurant's feed has a smile on some posts and nothing on most.
 *
 * Nine days in thirty are allowed one, three of those two, and the other
 * twenty-one none. The cycle is ten days rather than seven, so the allowance
 * never lands on the same weekday twice running in the week the posts are
 * actually read in.
 *
 * It is a ceiling, not a quota — a day allowed one and written without is
 * perfectly fine, which is why the validator only ever checks `MAX_EMOJI`.
 */
export function emojiBudgetFor(day: number): number {
  const n = Math.max(Math.trunc(day), 1) - 1;
  return [0, 1, 0, 0, 0, 2, 0, 0, 1, 0][n % 10];
}

/**
 * The longest a call to action may be.
 *
 * Not a style preference — a physical limit. The CTA is printed on the poster
 * inside a badge the width of the design, and a sentence that does not fit is
 * left off it entirely rather than cut in half. So a CTA written too long is
 * a CTA the owner paid for and does not get, and the writer is asked for a
 * shorter one while there is still a repair left to ask with.
 *
 * The prompt asks for under forty characters. This sits well above that, so
 * ordinary variation costs nothing and only the genuinely unusable is sent
 * back.
 */
export const MAX_CTA = 64;

/* ------------------------------- repetition ------------------------------- */

const NOISE = new Set(["", "dan", "atau", "yang", "di", "ke", "dari", "the", "a", "an"]);

/** The first meaningful word of a line, lower-cased and stripped of punctuation. */
export function openingWord(text: string): string {
  for (const raw of text.trim().split(/\s+/)) {
    const word = raw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (!NOISE.has(word)) return word;
  }
  return "";
}

/**
 * Openings that have been leaned on too hard.
 *
 * `limit` is the number of times one opening word may appear before it counts
 * as a tic. Used both to review a finished pack and to tell the next batch what
 * the earlier batches already wore out.
 */
export function overusedOpenings(
  lines: readonly string[],
  limit = 2,
): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const word = openingWord(line);
    if (!word) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > limit)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
