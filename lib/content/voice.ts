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
  { id: "nombor", guide: "Buka dengan satu nombor atau masa yang konkrit (bukan harga, bukan statistik rekaan)." },
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

export const CTA_SHAPES: readonly string[] = [
  "Ajak simpan post ini.",
  "Ajak tanya di komen.",
  "Ajak share kepada seorang kawan.",
  "Ajak datang, sebut waktu secara umum sahaja.",
  "Ajak reply atau WhatsApp untuk tanya.",
  "Tiada ajakan kuat — tutup dengan satu ayat yang tenang.",
] as const;

export function ctaShapeFor(day: number): string {
  const n = Math.max(Math.trunc(day), 1) - 1;
  return CTA_SHAPES[(n * 5) % CTA_SHAPES.length];
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
