import { MALAYSIA_STATES, STATE_LABEL, type MalaysiaState } from "./types.ts";

/**
 * Turning "Kajang, Selangor" — or just "Kajang" — into a state.
 *
 * The owner types their location in free text on the onboarding form, because
 * asking a warung owner to pick from a dropdown of sixteen states is one more
 * form field than the product deserves. State-specific holidays are gated on
 * the answer, so the resolution has to be conservative: when we cannot tell,
 * the answer is `null` and the pack simply gets no state holidays. A missing
 * Sultan's birthday costs an owner nothing. A Sarawak holiday on a Kedah
 * warung's feed costs them their credibility.
 *
 * The town list is not exhaustive and never will be. It covers the places most
 * likely to be typed, and every state name and its common spellings.
 */

/** Alternate spellings and the towns that imply a state. Longest match wins. */
const HINTS: Record<MalaysiaState, readonly string[]> = {
  johor: [
    "johor",
    "johore",
    "johor bahru",
    "jb",
    "iskandar puteri",
    "skudai",
    "kulai",
    "batu pahat",
    "muar",
    "kluang",
    "segamat",
    "pontian",
    "pasir gudang",
    "mersing",
    "tangkak",
  ],
  kedah: [
    "kedah",
    "alor setar",
    "sungai petani",
    "kulim",
    "langkawi",
    "jitra",
    "baling",
    "yan",
    "pendang",
  ],
  kelantan: [
    "kelantan",
    "kota bharu",
    "pasir mas",
    "tanah merah",
    "machang",
    "gua musang",
    "bachok",
    "tumpat",
  ],
  melaka: ["melaka", "malacca", "ayer keroh", "alor gajah", "jasin", "masjid tanah"],
  "negeri-sembilan": [
    "negeri sembilan",
    "n9",
    "seremban",
    "nilai",
    "port dickson",
    "rembau",
    "kuala pilah",
    "bahau",
  ],
  pahang: [
    "pahang",
    "kuantan",
    "temerloh",
    "bentong",
    "raub",
    "cameron highlands",
    "jerantut",
    "pekan",
    "genting highlands",
  ],
  perak: [
    "perak",
    "ipoh",
    "taiping",
    "teluk intan",
    "sitiawan",
    "lumut",
    "kampar",
    "batu gajah",
    "kuala kangsar",
    "manjung",
  ],
  perlis: ["perlis", "kangar", "arau", "padang besar"],
  penang: [
    "penang",
    "pulau pinang",
    "georgetown",
    "george town",
    "bayan lepas",
    "butterworth",
    "bukit mertajam",
    "balik pulau",
    "seberang perai",
  ],
  sabah: [
    "sabah",
    "kota kinabalu",
    "sandakan",
    "tawau",
    "lahad datu",
    "keningau",
    "papar",
    "semporna",
  ],
  sarawak: [
    "sarawak",
    "kuching",
    "miri",
    "sibu",
    "bintulu",
    "samarahan",
    "sri aman",
    "limbang",
  ],
  selangor: [
    "selangor",
    "shah alam",
    "petaling jaya",
    "pj",
    "subang jaya",
    "klang",
    "kajang",
    "bangi",
    "puchong",
    "cyberjaya",
    "rawang",
    "sepang",
    "ampang",
    "cheras",
    "seri kembangan",
    "damansara",
    "sungai buloh",
    "kuala selangor",
    "banting",
    "semenyih",
  ],
  terengganu: [
    "terengganu",
    "kuala terengganu",
    "kemaman",
    "dungun",
    "chukai",
    "marang",
    "besut",
  ],
  "kuala-lumpur": [
    "kuala lumpur",
    "kl",
    "bukit bintang",
    "bangsar",
    "mont kiara",
    "setapak",
    "wangsa maju",
    "kepong",
    "sentul",
    "titiwangsa",
    "brickfields",
  ],
  labuan: ["labuan"],
  putrajaya: ["putrajaya"],
};

/** Every hint paired with its state, longest first so "johor bahru" beats "johor". */
const LOOKUP: readonly (readonly [string, MalaysiaState])[] = MALAYSIA_STATES.flatMap(
  (state) => HINTS[state].map((hint) => [hint, state] as const),
).sort((a, b) => b[0].length - a[0].length);

/** Lower-cases and flattens punctuation so "Johor Bahru," matches "johor bahru". */
function normalise(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * The state a location belongs to, or `null` when it cannot be told.
 *
 * Matching is on whole words: "Sepang" must not match inside a longer word, and
 * a two-letter hint like "kl" must not fire on "Kluang".
 */
export function resolveState(location: string | undefined | null): MalaysiaState | null {
  if (!location) return null;
  const haystack = normalise(location);
  if (haystack.trim() === "") return null;
  for (const [hint, state] of LOOKUP) {
    if (haystack.includes(` ${hint} `)) return state;
  }
  return null;
}

/** Human label for a resolved state, for anywhere we show our working. */
export function stateLabel(state: MalaysiaState | null): string | null {
  return state ? STATE_LABEL[state] : null;
}
