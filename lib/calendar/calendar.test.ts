import assert from "node:assert/strict";
import test from "node:test";

import { COVERAGE, EVENTS } from "./data.ts";
import { resolveState } from "./states.ts";
import {
  appliesTo,
  daysBetween,
  describeBeat,
  eventsForRange,
  planCalendar,
  planCalendarForLocation,
  shiftDate,
  withinCoverage,
} from "./index.ts";
import { MALAYSIA_STATES } from "./types.ts";

/**
 * The calendar is the one part of ContentKita that is allowed to state a fact
 * about the world, so it is the one part that has to be provably right.
 *
 * These tests do two jobs. They pin the dates that were read off the gazette,
 * so a careless edit to the dataset fails loudly rather than wishing somebody a
 * happy Deepavali in July. And they pin the *policy*: state gating, the
 * holiday/occasion distinction, and the rule that no single festival is allowed
 * to eat the month.
 */

/* --------------------------------- dates ---------------------------------- */

test("date arithmetic is UTC and does not drift across a month boundary", () => {
  assert.equal(shiftDate("2026-09-10", 29), "2026-10-09");
  assert.equal(shiftDate("2026-02-28", 1), "2026-03-01");
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-09-10", "2026-09-16"), 6);
  assert.equal(daysBetween("2026-09-16", "2026-09-10"), -6);
});

/* -------------------------------- dataset --------------------------------- */

test("every event is well formed and inside the coverage window", () => {
  assert.ok(EVENTS.length > 0);
  for (const event of EVENTS) {
    assert.match(event.start, /^\d{4}-\d{2}-\d{2}$/, event.id);
    assert.match(event.end, /^\d{4}-\d{2}-\d{2}$/, event.id);
    assert.ok(event.end >= event.start, `${event.id} ends before it starts`);
    assert.ok(event.start >= COVERAGE.start, `${event.id} precedes coverage`);
    assert.ok(event.end <= COVERAGE.end, `${event.id} exceeds coverage`);
    assert.ok(event.weight > 0 && event.weight <= 1, event.id);
    assert.ok(event.name.trim().length > 0, event.id);
    assert.ok(event.angle.trim().length > 0, event.id);
    if (event.states) {
      assert.ok(event.states.length > 0, `${event.id} has an empty state list`);
      for (const state of event.states) {
        assert.ok(MALAYSIA_STATES.includes(state), `${event.id} names ${state}`);
      }
    }
  }
});

test("the gazetted national holiday dates are the ones we verified", () => {
  const on = (id: string, year: string) =>
    EVENTS.filter((e) => e.id === id && e.start.startsWith(year)).map((e) => e.start);

  assert.deepEqual(on("tahun-baru-cina", "2026"), ["2026-02-17"]);
  assert.deepEqual(on("hari-raya-aidilfitri", "2026"), ["2026-03-21"]);
  assert.deepEqual(on("hari-raya-aidiladha", "2026"), ["2026-05-27"]);
  assert.deepEqual(on("wesak", "2026"), ["2026-05-31"]);
  assert.deepEqual(on("awal-muharram", "2026"), ["2026-06-17"]);
  assert.deepEqual(on("maulidur-rasul", "2026"), ["2026-08-25"]);
  assert.deepEqual(on("hari-merdeka", "2026"), ["2026-08-31"]);
  assert.deepEqual(on("hari-malaysia", "2026"), ["2026-09-16"]);
  assert.deepEqual(on("deepavali", "2026"), ["2026-11-08"]);
  assert.deepEqual(on("krismas", "2026"), ["2026-12-25"]);

  assert.deepEqual(on("tahun-baru-cina", "2027"), ["2027-02-06"]);
  assert.deepEqual(on("hari-raya-aidilfitri", "2027"), ["2027-03-10"]);
  assert.deepEqual(on("hari-raya-aidiladha", "2027"), ["2027-05-17"]);
  assert.deepEqual(on("deepavali", "2027"), ["2027-10-28"]);
  assert.deepEqual(on("hari-malaysia", "2027"), ["2027-09-16"]);
});

test("only real public holidays are labelled as public holidays", () => {
  const kinds = new Map(EVENTS.map((e) => [e.id, e.kind]));
  assert.equal(kinds.get("hari-kekasih"), "occasion");
  assert.equal(kinds.get("hari-ibu"), "occasion");
  assert.equal(kinds.get("hari-bapa"), "occasion");
  assert.equal(kinds.get("hari-guru"), "occasion");
  assert.equal(kinds.get("ramadan"), "season");
  assert.equal(kinds.get("cuti-sekolah-b"), "season");
  assert.equal(kinds.get("hari-raya-aidilfitri"), "holiday");
  assert.equal(kinds.get("hari-malaysia"), "holiday");
});

/* ------------------------------ state gating ------------------------------ */

test("free-text locations resolve to a state, and unknown ones to null", () => {
  assert.equal(resolveState("Kajang, Selangor"), "selangor");
  assert.equal(resolveState("Kajang"), "selangor");
  assert.equal(resolveState("kota bharu"), "kelantan");
  assert.equal(resolveState("Jalan Gasing, Petaling Jaya"), "selangor");
  assert.equal(resolveState("George Town, Pulau Pinang"), "penang");
  assert.equal(resolveState("Kuching"), "sarawak");
  assert.equal(resolveState("Bukit Bintang, KL"), "kuala-lumpur");
  assert.equal(resolveState("Johor Bahru"), "johor");
  assert.equal(resolveState(""), null);
  assert.equal(resolveState(undefined), null);
  assert.equal(resolveState("somewhere nice"), null);
});

test("a two-letter hint does not fire inside a longer word", () => {
  // "kl" must not match "Kluang", which is in Johor.
  assert.equal(resolveState("Kluang"), "johor");
  // "n9" must not match a street number.
  assert.equal(resolveState("Lot 9, Kuantan"), "pahang");
});

test("a state holiday only reaches the states that observe it", () => {
  const kaamatan = EVENTS.find((e) => e.id === "pesta-kaamatan");
  assert.ok(kaamatan);
  assert.equal(appliesTo(kaamatan, "sabah"), true);
  assert.equal(appliesTo(kaamatan, "selangor"), false);
  // Unknown location: no state holidays at all, rather than a guess.
  assert.equal(appliesTo(kaamatan, null), false);

  const malaysiaDay = EVENTS.find((e) => e.id === "hari-malaysia");
  assert.ok(malaysiaDay);
  assert.equal(appliesTo(malaysiaDay, null), true);
});

test("a Selangor restaurant never sees a Sarawak or Sabah holiday", () => {
  const year = eventsForRange("2026-01-01", 365, "selangor");
  const ids = new Set(year.map((e) => e.id));
  assert.ok(!ids.has("gawai-dayak"));
  assert.ok(!ids.has("pesta-kaamatan"));
  assert.ok(!ids.has("hari-sarawak"));
  assert.ok(ids.has("hari-jadi-sultan-selangor"));
  assert.ok(ids.has("hari-malaysia"));
});

test("cuti sekolah follows the school group, not the whole country", () => {
  const kelantan = eventsForRange("2026-08-20", 30, "kelantan").filter((e) =>
    e.id.startsWith("cuti-sekolah"),
  );
  const selangor = eventsForRange("2026-08-20", 30, "selangor").filter((e) =>
    e.id.startsWith("cuti-sekolah"),
  );
  assert.deepEqual(kelantan.map((e) => e.start), ["2026-08-28"]);
  assert.deepEqual(selangor.map((e) => e.start), ["2026-08-29"]);
});

/* -------------------------------- planning -------------------------------- */

test("a September pack in Selangor lands Hari Malaysia on the right day", () => {
  const plan = planCalendarForLocation("Kajang, Selangor", "2026-09-10", 30);
  assert.equal(plan.state, "selangor");
  assert.equal(plan.covered, true);

  const onDay = plan.beats.find(
    (b) => b.event.id === "hari-malaysia" && b.role === "on",
  );
  assert.ok(onDay, "Hari Malaysia should get a post");
  assert.equal(onDay.day, 7);
  assert.equal(onDay.date, "2026-09-16");

  const lead = plan.beats.find(
    (b) => b.event.id === "hari-malaysia" && b.role === "before",
  );
  assert.ok(lead, "a national day of that size earns an anticipation post");
  assert.equal(lead.day, 4);
});

test("no festival is allowed to take over the month", () => {
  // A pack that opens the week before Raya, in a state with plenty in range.
  const plan = planCalendar("2026-03-10", 30, "selangor");
  assert.ok(plan.beats.length <= 4, `too many calendar days: ${plan.beats.length}`);
  const byEvent = new Map<string, number>();
  for (const beat of plan.beats) {
    byEvent.set(beat.event.id, (byEvent.get(beat.event.id) ?? 0) + 1);
  }
  for (const [id, count] of byEvent) {
    assert.ok(count <= 2, `${id} occupies ${count} days`);
  }
  assert.ok(byEvent.size <= 3, "at most three occasions per pack");
});

test("every beat falls inside the pack and no two share a day", () => {
  for (const start of ["2026-01-05", "2026-05-01", "2026-09-10", "2026-12-01"]) {
    for (const state of MALAYSIA_STATES) {
      const plan = planCalendar(start, 30, state);
      const days = new Set<number>();
      for (const beat of plan.beats) {
        assert.ok(beat.day >= 1 && beat.day <= 30, `${start}/${state}: ${beat.day}`);
        assert.equal(beat.date, shiftDate(start, beat.day - 1));
        assert.ok(!days.has(beat.day), `${start}/${state}: two beats on ${beat.day}`);
        days.add(beat.day);
      }
    }
  }
});

test("planning is pure", () => {
  const a = planCalendar("2026-03-10", 30, "selangor");
  const b = planCalendar("2026-03-10", 30, "selangor");
  assert.deepEqual(a.beats, b.beats);
});

test("a range outside the dataset produces a plain month, not a wrong one", () => {
  const plan = planCalendar("2029-04-01", 30, "selangor");
  assert.equal(plan.covered, false);
  assert.deepEqual(plan.beats, []);
  assert.equal(withinCoverage("2026-09-10", 30), true);
  assert.equal(withinCoverage("2027-12-20", 30), false);
});

test("the brief line says what kind of date it is", () => {
  const plan = planCalendar("2026-09-10", 30, "selangor");
  const beat = plan.beats.find((b) => b.event.id === "hari-malaysia" && b.role === "on");
  assert.ok(beat);
  assert.match(describeBeat(beat), /cuti umum seluruh Malaysia/);

  const valentine = planCalendar("2026-02-12", 5, "selangor").beats.find(
    (b) => b.event.id === "hari-kekasih",
  );
  assert.ok(valentine);
  assert.match(describeBeat(valentine), /bukan cuti umum/);
});
