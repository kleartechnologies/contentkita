import { COVERAGE, EVENTS } from "./data.ts";
import { resolveState, stateLabel } from "./states.ts";
import type { CalendarBeat, CalendarEvent, MalaysiaState } from "./types.ts";

export type {
  BeatRole,
  CalendarBeat,
  CalendarEvent,
  EventKind,
  MalaysiaState,
} from "./types.ts";
export { MALAYSIA_STATES, STATE_LABEL } from "./types.ts";
export { resolveState, stateLabel } from "./states.ts";
export { COVERAGE, EVENTS } from "./data.ts";

/**
 * Turning a dataset into at most a handful of days that matter.
 *
 * Two failure modes this is written against. The first is a month that ignores
 * Raya. The second — much easier to fall into — is a month that is *about*
 * Raya: thirty posts counting down to one date, which is not a content pack,
 * it is a countdown. So the planner is deliberately stingy. It picks the few
 * biggest occasions in range, gives each one post (and, for the very big ones,
 * one post a few days ahead), and leaves the other twenty-odd days alone.
 *
 * `MAX_EVENTS` and `MAX_BEATS` are the whole dominance policy.
 */

/** No more than this many distinct occasions get a post in one pack. */
const MAX_EVENTS = 3;
/** No more than this many of the thirty days are calendar days. */
const MAX_BEATS = 4;
/** Weight at or above which an occasion also earns an anticipation post. */
const ANTICIPATE_ABOVE = 0.7;
/** How many days before the occasion the anticipation post lands. */
const ANTICIPATE_LEAD = 3;

/* --------------------------------- dates ---------------------------------- */

function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const DAY_MS = 86_400_000;

/** ISO date `days` after `iso`, in UTC so no timezone can shift a holiday. */
export function shiftDate(iso: string, days: number): string {
  return new Date(utc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/* -------------------------------- selection ------------------------------- */

/**
 * Whether this restaurant observes the event.
 *
 * An unresolved state means no state holidays at all. Guessing would be worse
 * than silence: a Kajang warung posting about Pesta Kaamatan reads as a
 * template, which is exactly the impression the product exists to avoid.
 */
export function appliesTo(event: CalendarEvent, state: MalaysiaState | null): boolean {
  if (event.states === null) return true;
  return state !== null && event.states.includes(state);
}

/**
 * Every event overlapping the pack's date range that this restaurant observes.
 *
 * Sorted by date. Includes seasons that started before the pack did — a pack
 * generated in the middle of Ramadan is still a Ramadan pack.
 */
export function eventsForRange(
  startDate: string,
  days: number,
  state: MalaysiaState | null,
): CalendarEvent[] {
  if (days <= 0) return [];
  const last = shiftDate(startDate, days - 1);
  return EVENTS.filter(
    (event) =>
      event.end >= startDate && event.start <= last && appliesTo(event, state),
  );
}

/** True when the whole range sits inside the verified dataset. */
export function withinCoverage(startDate: string, days: number): boolean {
  if (days <= 0) return false;
  const last = shiftDate(startDate, days - 1);
  return startDate >= COVERAGE.start && last <= COVERAGE.end;
}

export interface CalendarPlan {
  state: MalaysiaState | null;
  stateName: string | null;
  /** False when the range runs past the verified dataset — then `beats` is thin or empty. */
  covered: boolean;
  /** Everything in range, for showing our working. Not all of it gets a post. */
  events: CalendarEvent[];
  /** The days that become calendar posts, in day order. */
  beats: CalendarBeat[];
}

/**
 * The calendar days for one pack.
 *
 * Pure: the same start date, length and state always produce the same beats, so
 * regenerating a single day agrees with the pack it belongs to.
 */
export function planCalendar(
  startDate: string,
  days: number,
  state: MalaysiaState | null,
): CalendarPlan {
  const events = eventsForRange(startDate, days, state);
  const last = days - 1;

  // Strongest first, and for equal weight the earlier date, so the ranking is
  // total and does not depend on the order of the dataset.
  const ranked = [...events].sort(
    (a, b) => b.weight - a.weight || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0),
  );

  const beats: CalendarBeat[] = [];
  const usedDays = new Set<number>();
  const usedEvents = new Set<string>();

  for (const event of ranked) {
    if (usedEvents.size >= MAX_EVENTS || beats.length >= MAX_BEATS) break;
    if (usedEvents.has(event.id)) continue;

    // A season already under way lands on the first day of the pack.
    const onDay = Math.min(Math.max(daysBetween(startDate, event.start), 0), last) + 1;
    if (usedDays.has(onDay)) continue;

    usedEvents.add(event.id);
    usedDays.add(onDay);
    beats.push({
      day: onDay,
      date: shiftDate(startDate, onDay - 1),
      event,
      role: "on",
    });

    const leadDay = onDay - ANTICIPATE_LEAD;
    if (
      event.weight >= ANTICIPATE_ABOVE &&
      leadDay >= 1 &&
      !usedDays.has(leadDay) &&
      beats.length < MAX_BEATS
    ) {
      usedDays.add(leadDay);
      beats.push({
        day: leadDay,
        date: shiftDate(startDate, leadDay - 1),
        event,
        role: "before",
      });
    }
  }

  beats.sort((a, b) => a.day - b.day);

  return {
    state,
    stateName: stateLabel(state),
    covered: withinCoverage(startDate, days),
    events,
    beats,
  };
}

/** The same thing, starting from whatever the owner typed as their location. */
export function planCalendarForLocation(
  location: string | undefined | null,
  startDate: string,
  days: number,
): CalendarPlan {
  return planCalendar(startDate, days, resolveState(location));
}

/**
 * How the occasion should be described in a brief.
 *
 * The wording is not decoration. §19 of the product brief is explicit that a
 * commercial occasion must never be presented as a public holiday, and this is
 * the single place that distinction is turned into words.
 */
export function describeBeat(beat: CalendarBeat): string {
  const { event, role } = beat;
  const kind =
    event.kind === "holiday"
      ? event.states === null
        ? "cuti umum seluruh Malaysia"
        : "cuti umum negeri ini sahaja"
      : event.kind === "season"
        ? "musim, bukan cuti umum"
        : "sambutan, bukan cuti umum";
  const when =
    role === "before"
      ? `${ANTICIPATE_LEAD} hari sebelum ${event.name}`
      : `hari ${event.name}`;
  return `${event.name} (${kind}) — ${when}. ${event.angle}`;
}
