/**
 * The Malaysia calendar, as data.
 *
 * A restaurant's month is shaped by real dates: Raya, Deepavali, Merdeka, the
 * school holidays, the Sultan's birthday in their own state. Getting those
 * dates right is not a writing problem, it is a data problem — so none of it is
 * left to a language model. Every date in `data.ts` was read off a published
 * gazette list and is checked in as a literal. The writer is told which
 * occasion applies and never asked when it falls.
 *
 * Three distinctions this file exists to keep straight:
 *
 *  1. National versus state. A Sabah holiday is not a Selangor holiday. Showing
 *     a Kajang warung a Kaamatan post would be worse than showing them nothing.
 *  2. Gazetted holidays versus everything else. Valentine's Day is not a public
 *     holiday and must never be described as one.
 *  3. A day versus a season. Ramadan is a month, the school break is a week,
 *     Deepavali is a date. They are all `start`..`end` here so the same code
 *     can ask "does this overlap the pack?".
 */

/** The thirteen states and three federal territories. */
export type MalaysiaState =
  | "johor"
  | "kedah"
  | "kelantan"
  | "melaka"
  | "negeri-sembilan"
  | "pahang"
  | "perak"
  | "perlis"
  | "penang"
  | "sabah"
  | "sarawak"
  | "selangor"
  | "terengganu"
  | "kuala-lumpur"
  | "labuan"
  | "putrajaya";

export const MALAYSIA_STATES: readonly MalaysiaState[] = [
  "johor",
  "kedah",
  "kelantan",
  "melaka",
  "negeri-sembilan",
  "pahang",
  "perak",
  "perlis",
  "penang",
  "sabah",
  "sarawak",
  "selangor",
  "terengganu",
  "kuala-lumpur",
  "labuan",
  "putrajaya",
];

export const STATE_LABEL: Record<MalaysiaState, string> = {
  johor: "Johor",
  kedah: "Kedah",
  kelantan: "Kelantan",
  melaka: "Melaka",
  "negeri-sembilan": "Negeri Sembilan",
  pahang: "Pahang",
  perak: "Perak",
  perlis: "Perlis",
  penang: "Pulau Pinang",
  sabah: "Sabah",
  sarawak: "Sarawak",
  selangor: "Selangor",
  terengganu: "Terengganu",
  "kuala-lumpur": "Kuala Lumpur",
  labuan: "Labuan",
  putrajaya: "Putrajaya",
};

/**
 * What kind of date this is. Load-bearing: the copy is allowed to call a
 * `holiday` a cuti umum and is never allowed to call anything else one.
 */
export type EventKind =
  /** Gazetted public holiday — a real day off, nationally or in named states. */
  | "holiday"
  /** A real season or religious observance that is not a day off (Ramadan, cuti sekolah). */
  | "season"
  /** A celebration people mark but the government does not (Valentine's, Mother's Day). */
  | "occasion";

export interface CalendarEvent {
  /** Stable across years: `raya-aidilfitri`, not `raya-aidilfitri-2026`. */
  id: string;
  /** What the owner and the writer see. Malay, because the product is Malay. */
  name: string;
  kind: EventKind;
  /** `null` means everywhere. Otherwise only these states observe it. */
  states: readonly MalaysiaState[] | null;
  /** Inclusive ISO dates. A single-day event has `start === end`. */
  start: string;
  end: string;
  /**
   * How much this date is worth to a restaurant, 0-1. Ranking, not truth:
   * it decides which two or three occasions in a month get a post, so that a
   * Sultan's birthday never crowds out Raya.
   */
  weight: number;
  /** One line of guidance for the writer. Never a fact about the restaurant. */
  angle: string;
}

/** Where a pack day sits relative to its occasion. */
export type BeatRole = "before" | "on";

export interface CalendarBeat {
  /** 1-based day within the pack. */
  day: number;
  /** ISO date of that pack day. */
  date: string;
  event: CalendarEvent;
  role: BeatRole;
}
