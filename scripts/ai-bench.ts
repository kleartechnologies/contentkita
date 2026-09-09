/**
 * Is the cheap model good enough?
 *
 *   node --conditions=react-server --env-file=.env.local scripts/ai-bench.ts
 *   node --conditions=react-server --env-file=.env.local scripts/ai-bench.ts --days=6
 *   node --conditions=react-server --env-file=.env.local scripts/ai-bench.ts --models=gpt-4.1-mini,gpt-4.1-nano
 *   node --conditions=react-server --env-file=.env.local scripts/ai-bench.ts --models=gpt-4.1-mini --repair=gpt-4.1
 *   node --conditions=react-server scripts/ai-bench.ts --report=.bench   # re-read a finished run, no API calls
 *
 * A controlled comparison, not a price-list argument. Every model here writes
 * the same restaurant, the same 30-day schedule, in the same five batches the
 * browser actually sends, carrying the same hooks forward between batches, and
 * is then asked to regenerate one day the way an owner would. The only thing
 * that differs between runs is the model name.
 *
 * It goes through `generateItems` — the real production path, with the real
 * deterministic validator and the real one-repair bound — rather than a
 * simplified copy, so what it measures is what a customer would get. The HTTP
 * route is skipped only because auth and rate limiting have nothing to do with
 * the question.
 *
 * `--conditions=react-server` is what lets a plain `node` process import the
 * `server-only`-guarded transport: that package exports an empty module under
 * that condition and a throwing one otherwise. The guard is doing its job.
 *
 * Both months are written to disk, because the numbers below cannot answer the
 * question on their own. "Thirty unique hooks" is satisfied by thirty bad
 * hooks. The counts say where to look; the files are what has to be read.
 *
 * Costs money — roughly $0.11 for the full two-model run at current rates.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generateItems, GenerationFailure, type GenerationOutcome } from "../lib/ai/generate.ts";
import { AiError } from "../lib/ai/openai.ts";
import { costOf, RATES, usd } from "../lib/ai/pricing.ts";
import { MAX_TARGET_DAYS } from "../lib/ai/request.ts";
import { addUsage, cacheHitRate, ZERO_USAGE, type Usage } from "../lib/ai/usage.ts";
import { buildBrief } from "../lib/content/brief.ts";
import { CATEGORY_META } from "../lib/content/categories.ts";
import { DEMO_RESTAURANT } from "../lib/content/demo.ts";
import { wantsVideo } from "../lib/content/schedule.ts";
import type { Violation } from "../lib/content/validate.ts";
import type { ContentItem } from "../lib/content/types.ts";

/** The same profile `scripts/ai-cost.ts` prices, so the two reports line up. */
const PROFILE = DEMO_RESTAURANT;
/** Fixed, so both models write the same calendar and neither gets a weekend the other did not. */
const START_DATE = "2026-10-01";
/** Hooks handed forward between batches — the browser's window, not a new one. */
const AVOID_WINDOW = 24;

function flag(name: string): string | null {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
}

const DAYS = Number(flag("days") ?? 30);
const MODELS = (flag("models") ?? "gpt-4.1,gpt-4.1-mini").split(",").map((m) => m.trim());
const OUT_DIR = flag("out") ?? ".bench";
/** Late enough in the month to have a full avoid list behind it. */
const REGEN_DAY = Math.min(14, DAYS);
/**
 * Who fixes a rejected day.
 *
 * Unset, the model under test repairs itself, which is what measures the model
 * on its own. Set, it measures a tier — a cheap writer with a strong model
 * behind it — which is the shape production actually ships.
 */
const REPAIR_WITH = flag("repair");

interface Attempt {
  label: string;
  days: number[];
  outcome: GenerationOutcome | null;
  /** What this attempt was billed, including one that then failed. */
  usage: Usage;
  /** The model that wrote it, so a tiered run can be priced attempt by attempt. */
  model: string;
  error: string | null;
}

interface Run {
  model: string;
  attempts: Attempt[];
  items: ContentItem[];
  regenerated: ContentItem | null;
  regeneratedFrom: string | null;
  usage: Usage;
  ms: number;
  calls: number;
  repairs: number;
  violations: Violation[];
  /** Batches that never produced a valid set of days. In production: no pack at all. */
  failures: string[];
}

/* ------------------------------ the generation ----------------------------- */

function batchesOf(days: number): number[][] {
  const out: number[][] = [];
  for (let first = 1; first <= days; first += MAX_TARGET_DAYS) {
    const batch: number[] = [];
    for (let d = first; d < first + MAX_TARGET_DAYS && d <= days; d++) batch.push(d);
    out.push(batch);
  }
  return out;
}

async function runModel(model: string): Promise<Run> {
  // Both writing and repair go to the model under test. Production tiers them,
  // but the question here is what *this* model does on its own — including how
  // often it needs a second try and whether it can fix its own mistake. Pricing
  // a mixed tier is arithmetic afterwards; measuring a model's own failure rate
  // is not.
  process.env.OPENAI_MODEL = model;
  process.env.OPENAI_REPAIR_MODEL = REPAIR_WITH ?? model;

  const run: Run = {
    model,
    attempts: [],
    items: [],
    regenerated: null,
    regeneratedFrom: null,
    usage: ZERO_USAGE,
    ms: 0,
    calls: 0,
    repairs: 0,
    violations: [],
    failures: [],
  };

  /** A failed attempt spent real calls and real tokens; none of it is dropped. */
  const recordFailure = (label: string, days: number[], error: unknown) => {
    const detail =
      error instanceof AiError ? `${error.code}: ${error.message}` : String(error);
    const spent = error instanceof AiError ? (error.usage ?? ZERO_USAGE) : ZERO_USAGE;
    run.attempts.push({
      label,
      days,
      outcome: null,
      usage: spent,
      model: (error instanceof GenerationFailure && error.models[0]) || model,
      error: detail,
    });
    run.failures.push(`${label} — ${detail}`);
    if (error instanceof GenerationFailure) {
      run.usage = addUsage(run.usage, error.usage ?? ZERO_USAGE);
      run.ms += error.durationMs;
      run.calls += error.calls;
      run.repairs += error.repairs;
      run.violations.push(...error.violations);
    } else if (error instanceof AiError && error.usage) {
      run.usage = addUsage(run.usage, error.usage);
    }
    return detail;
  };

  const record = (label: string, days: number[], outcome: GenerationOutcome) => {
    run.attempts.push({ label, days, outcome, usage: outcome.usage, model: outcome.models[0] ?? model, error: null });
    run.usage = addUsage(run.usage, outcome.usage);
    run.ms += outcome.durationMs;
    run.calls += outcome.calls;
    run.repairs += outcome.repairs;
    run.violations.push(...outcome.violations);
  };

  const written: string[] = [];

  for (const [index, targetDays] of batchesOf(DAYS).entries()) {
    const label = `batch ${index + 1} (days ${targetDays[0]}-${targetDays[targetDays.length - 1]})`;
    process.stdout.write(`  ${model}  ${label} … `);
    try {
      const outcome = await generateItems({
        mode: "days",
        restaurant: PROFILE,
        days: DAYS,
        startDate: START_DATE,
        targetDays,
        avoid: written.slice(-AVOID_WINDOW),
      });
      record(label, targetDays, outcome);
      run.items.push(...outcome.items);
      for (const item of outcome.items) written.push(item.hook);
      console.log(
        `${(outcome.durationMs / 1000).toFixed(1)}s, ${outcome.repairs} repair(s), ${outcome.violations.length} violation(s)`,
      );
    } catch (error) {
      // Deliberately keeps going. A model that fails one batch in five is a
      // model that ships no pack at all, and how often that happens is the
      // finding — stopping at the first would only ever report "once".
      console.log(`FAILED — ${recordFailure(label, targetDays, error)}`);
    }
  }

  // One regeneration, the way the "Regenerate" button asks for it: a single day,
  // with every hook already in the plan handed over so the rewrite has to be
  // genuinely different rather than a paraphrase of what the owner is looking at.
  const before = run.items.find((i) => i.day === REGEN_DAY) ?? null;
  process.stdout.write(`  ${model}  regenerate day ${REGEN_DAY} … `);
  try {
    const outcome = await generateItems({
      mode: "days",
      restaurant: PROFILE,
      days: DAYS,
      startDate: START_DATE,
      targetDays: [REGEN_DAY],
      avoid: run.items.map((i) => i.hook),
    });
    record(`regenerate day ${REGEN_DAY}`, [REGEN_DAY], outcome);
    run.regenerated = outcome.items[0] ?? null;
    run.regeneratedFrom = before?.hook ?? null;
    console.log(`${(outcome.durationMs / 1000).toFixed(1)}s`);
  } catch (error) {
    console.log(`FAILED — ${recordFailure(`regenerate day ${REGEN_DAY}`, [REGEN_DAY], error)}`);
  }

  return run;
}

/* -------------------------------- the reading ------------------------------- */

const EMOJI = /\p{Extended_Pictographic}/gu;
const WORD = /[\p{L}\p{N}']+/gu;

function normalise(text: string): string {
  return (text.toLowerCase().match(WORD) ?? []).join(" ");
}

/** The first four words of a hook, which is where template spam shows itself. */
function opener(hook: string): string {
  return (hook.toLowerCase().match(WORD) ?? []).slice(0, 4).join(" ");
}

function distinct(values: string[]): number {
  return new Set(values.map(normalise)).size;
}

/**
 * Hooks that are not the same string but are the same sentence.
 *
 * "Unique hooks: 30/30" is satisfied by thirty rewordings of one idea, which is
 * exactly the failure this product cannot ship. Word overlap catches what
 * string equality misses: "Kenapa teh ais Warung Kak Ina lain dari yang lain?"
 * and "Kenapa teh ais Warung Kak Ina rasa lain dari biasa?" are two hooks by
 * the counter and one hook to a reader.
 */
/**
 * Malay glue. Dropped from both sides before phrases are compared, so a shared
 * "untuk" or "yang" cannot break a run that is otherwise word-for-word ours.
 */
const GLUE = new Set(
  ("untuk yang dan dengan supaya apa nak ni je kalau ada itu ke di pada dari " +
    "dalam atau tapi kita korang kami anda satu sebab bila lagi lah pun sini")
    .split(" "),
);

function content(text: string): string[] {
  return text.split(/\s+/).filter((w) => w && !GLUE.has(w));
}

/**
 * True when `text` quotes `phrase` rather than merely rhyming with it.
 *
 * Four content words in a row, glue words ignored on both sides. Malay
 * marketing copy shares two- and three-word runs constantly without anyone
 * having copied anything, and the glue is what makes an otherwise identical
 * phrase look different — "cara paling murah untuk jumpa orang baru" reappearing
 * as "cara paling murah jumpa orang baru" is a quotation, not a coincidence.
 */
function sharesPhrase(text: string, phrase: string, run = 4): boolean {
  const words = content(phrase);
  const body = content(text).join(" ");
  for (let i = 0; i + run <= words.length; i++) {
    if (body.includes(words.slice(i, i + run).join(" "))) return true;
  }
  return false;
}

function nearDuplicates(hooks: string[]): [string, string][] {
  const sets = hooks.map((h) => new Set((h.toLowerCase().match(WORD) ?? [])));
  const pairs: [string, string][] = [];
  for (let i = 0; i < hooks.length; i++) {
    for (let j = i + 1; j < hooks.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (a.size === 0 || b.size === 0) continue;
      let shared = 0;
      for (const word of a) if (b.has(word)) shared += 1;
      const jaccard = shared / (a.size + b.size - shared);
      if (jaccard >= 0.5) pairs.push([hooks[i], hooks[j]]);
    }
  }
  return pairs;
}

/** The value repeated most, and how often, so "29/30 unique" can be read properly. */
function commonest(values: string[]): { value: string; count: number } {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = { value: "", count: 0 };
  for (const [value, count] of counts) if (count > best.count) best = { value, count };
  return best;
}

/**
 * The word this month leans on, counted across whole hooks rather than first
 * words.
 *
 * `favouriteFirstWord` alone is a metric a model can satisfy without fixing
 * anything, and one did: told not to open more than twice with the same word,
 * gpt-5.4-mini dropped "Kalau" from 11 openings to 4 and moved the same tic
 * into the middle of the sentence, where "memang" went from 8 hooks to 15.
 * Every hook was still unique, every opener still different, and the month
 * still read like one sentence written thirty times. This is the measure that
 * catches that, so counting hooks that contain the word — twice in one hook is
 * one hook's worth of monotony to a reader scrolling a month.
 */
function crutchWord(hooks: string[]): { value: string; count: number } {
  return commonest(hooks.flatMap((h) => [...new Set(content(normalise(h)))]));
}

interface Quality {
  days: number;
  uniqueHooks: number;
  /** Hooks that lean on the restaurant's name instead of saying something. */
  namesTheShop: number;
  /** Days whose customer-facing copy quotes the schedule's internal strategy note. */
  purposeLeaks: number;
  /** The word the most hooks begin with, and how many. */
  favouriteFirstWord: { value: string; count: number };
  /** The commonest content word anywhere in a hook. See `crutchWord`. */
  favouriteWord: { value: string; count: number };
  /** Pairs of hooks that are different strings but the same sentence. */
  nearDuplicates: [string, string][];
  uniqueCtas: number;
  uniqueOpeners: number;
  repeatedOpener: { value: string; count: number };
  captionChars: { avg: number; min: number; max: number };
  mentionsDish: number;
  mentionsPlace: number;
  emojiOk: number;
  bangOk: number;
  readsRight: number;
  videoWanted: number;
  videoPresent: number;
  hashtagsPerPost: number;
  distinctHashtags: number;
  frameworkLabels: number;
}

/** Framework labels the voice rules forbid in a caption. Leaking one is a tell. */
const LABELS = /\b(attention|interest|desire|action|problem|agitate|solution|feature|advantage|benefit)\s*:/i;

function read(items: ContentItem[]): Quality {
  const brief = buildBrief(PROFILE, DAYS);
  const dishes = brief.quotable.dishes.map((d) => normalise(d)).filter(Boolean);
  const place = [PROFILE.location, PROFILE.name].map(normalise).filter(Boolean);
  const captions = items.map((i) => i.caption);
  const lengths = captions.map((c) => c.length);
  const openers = items.map((i) => opener(i.hook));
  const hashtags = items.flatMap((i) => i.hashtags.map((h) => h.toLowerCase()));

  let mentionsDish = 0;
  let mentionsPlace = 0;
  let emojiOk = 0;
  let bangOk = 0;
  let readsRight = 0;
  let videoWanted = 0;
  let videoPresent = 0;
  let frameworkLabels = 0;
  let namesTheShop = 0;
  let purposeLeaks = 0;
  const shopName = normalise(PROFILE.name);

  for (const item of items) {
    // The house rules say a hook must not open with the restaurant's name, and
    // a hook that needs the name to be interesting is usually not interesting.
    if (shopName && normalise(item.hook).includes(shopName)) namesTheShop += 1;
    const body = normalise(`${item.hook} ${item.caption}`);
    const raw = `${item.hook} ${item.caption} ${item.cta}`;
    if (dishes.some((d) => body.includes(d))) mentionsDish += 1;
    if (place.some((p) => body.includes(p))) mentionsPlace += 1;
    if ((raw.match(EMOJI) ?? []).length <= 2) emojiOk += 1;
    if ((raw.match(/!/g) ?? []).length <= 1) bangOk += 1;
    // The validator already rejects a day written wholesale in the wrong
    // language, so on a clean run this is 30/30 by construction. It is reported
    // anyway: a model that needed a repair to get there is not the same as one
    // that never slipped.
    if (!/\b(banget|nggak|gak|udah|gimana|kalian|aja|yuk|bikin|doang|kuliner|lho|deh)\b/.test(body)) {
      readsRight += 1;
    }
    if (LABELS.test(item.caption)) frameworkLabels += 1;
    const slot = brief.schedule.find((s) => s.day === item.day);
    // Each scheduled day carries a `tujuan:` note explaining to the writer why
    // the post exists. It is addressed to us, not to a customer — "cara paling
    // murah untuk jumpa orang baru" is a marketing rationale, and a model that
    // paraphrases it into a hook has published our own strategy memo. Measured
    // on the longest run of words the note and the copy share.
    if (slot && sharesPhrase(body, normalise(CATEGORY_META[slot.category].purpose))) {
      purposeLeaks += 1;
    }
    if (slot && wantsVideo(slot.category, slot.platform)) {
      videoWanted += 1;
      if (item.videoIdea && item.videoIdea.trim()) videoPresent += 1;
    }
  }

  return {
    days: items.length,
    uniqueHooks: distinct(items.map((i) => i.hook)),
    namesTheShop,
    purposeLeaks,
    // `uniqueOpeners` compares the first several words, so thirty hooks can all
    // be "unique" while a third of them start with the same conjunction. A month
    // where ten hooks open "Kalau …" reads as one voice with one habit, however
    // distinct the sentences are after that.
    favouriteFirstWord: commonest(items.map((i) => normalise(i.hook).split(/\s+/)[0] ?? "")),
    favouriteWord: crutchWord(items.map((i) => i.hook)),
    nearDuplicates: nearDuplicates(items.map((i) => i.hook)),
    uniqueCtas: distinct(items.map((i) => i.cta)),
    uniqueOpeners: new Set(openers).size,
    repeatedOpener: commonest(openers),
    captionChars: {
      avg: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
      min: lengths.length ? Math.min(...lengths) : 0,
      max: lengths.length ? Math.max(...lengths) : 0,
    },
    mentionsDish,
    mentionsPlace,
    emojiOk,
    bangOk,
    readsRight,
    videoWanted,
    videoPresent,
    hashtagsPerPost: items.length ? Number((hashtags.length / items.length).toFixed(1)) : 0,
    distinctHashtags: new Set(hashtags).size,
    frameworkLabels,
  };
}

/* -------------------------------- the report -------------------------------- */

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function fraction(part: number, whole: number): string {
  return `${part}/${whole}`;
}

/**
 * What one attempt cost, at the rate of whichever model actually ran it.
 *
 * A failed attempt is priced too. It produced nothing and was billed anyway,
 * which is the whole reason a model that gives up is expensive.
 */
function attemptCost(attempt: Attempt): number {
  return costOf(attempt.model, attempt.usage);
}

function reportRun(run: Run) {
  const q = read(run.items);
  // A tier bills two rate cards. Attempts are priced by the model that made
  // them rather than by the one the run is named after.
  const cost = run.attempts.reduce((sum, a) => sum + attemptCost(a), 0);
  const batchMs = run.attempts.filter((a) => a.outcome).map((a) => a.outcome!.durationMs);
  const rejectedDays = new Set(run.violations.map((v) => v.day)).size;

  console.log(`\n  ── ${run.model} ${"─".repeat(Math.max(0, 44 - run.model.length))}`);
  for (const failure of run.failures) console.log(`     INCOMPLETE — ${failure}`);

  console.log(
    `\n     pack        ${fraction(run.items.length, DAYS)} days, ${run.calls} call(s), ${run.repairs} repair(s)` +
      (run.failures.length ? `, ${run.failures.length} attempt(s) gave up` : ""),
  );
  console.log(
    `     tokens      in ${run.usage.input} (cached ${run.usage.cachedInput}, ${(cacheHitRate(run.usage) * 100).toFixed(0)}%)  out ${run.usage.output}  total ${run.usage.input + run.usage.output}`,
  );
  console.log(`     cost        ${usd(cost)}  for the pack and the regeneration together`);
  console.log(
    `     latency     ${(run.ms / 1000).toFixed(1)}s total, ${batchMs.length ? (Math.max(...batchMs) / 1000).toFixed(1) : "0"}s slowest call`,
  );
  console.log(
    `     validator   ${run.violations.length} violation(s) across ${rejectedDays} day(s)` +
      (run.violations.length
        ? `: ${[...new Set(run.violations.map((v) => v.code))].join(", ")}`
        : " — nothing fabricated, nothing malformed"),
  );

  const regen = run.regenerated;
  console.log(
    `     regenerate  day ${REGEN_DAY}: ` +
      (regen
        ? `hook ${normalise(regen.hook) === normalise(run.regeneratedFrom ?? "") ? "IDENTICAL to the one it replaced" : "changed"}`
        : "did not complete"),
  );

  console.log(`\n     variety and voice:`);
  console.log(`       unique hooks        ${pad(fraction(q.uniqueHooks, q.days), 7)}`);
  console.log(
    `       near-duplicate hooks${pad(q.nearDuplicates.length, 7)}` +
      (q.nearDuplicates.length ? `  e.g. "${q.nearDuplicates[0][0]}" / "${q.nearDuplicates[0][1]}"` : ""),
  );
  console.log(`       hooks naming the shop ${pad(fraction(q.namesTheShop, q.days), 5)}  (a hook should not need the name)`);
  console.log(
    `       commonest first word${pad(q.favouriteFirstWord.count, 7)}  ` +
      `"${q.favouriteFirstWord.value}" opens ${q.favouriteFirstWord.count} of ${q.days} hooks`,
  );
  console.log(
    `       commonest word${pad(q.favouriteWord.count, 13)}  ` +
      `"${q.favouriteWord.value}" appears in ${q.favouriteWord.count} of ${q.days} hooks`,
  );
  console.log(`       unique CTAs         ${pad(fraction(q.uniqueCtas, q.days), 7)}`);
  console.log(
    `       unique openers      ${pad(fraction(q.uniqueOpeners, q.days), 7)}` +
      (q.repeatedOpener.count > 1 ? `  most repeated: "${q.repeatedOpener.value}" ×${q.repeatedOpener.count}` : ""),
  );
  console.log(`       caption length      ${pad(q.captionChars.avg, 7)} chars avg (${q.captionChars.min}-${q.captionChars.max})`);
  console.log(`       names a dish        ${pad(fraction(q.mentionsDish, q.days), 7)}`);
  console.log(`       names the place     ${pad(fraction(q.mentionsPlace, q.days), 7)}`);
  console.log(`       within emoji rule   ${pad(fraction(q.emojiOk, q.days), 7)}  (house rule: at most 2)`);
  console.log(`       within "!" rule     ${pad(fraction(q.bangOk, q.days), 7)}  (house rule: at most 1)`);
  console.log(`       free of Indonesian  ${pad(fraction(q.readsRight, q.days), 7)}`);
  console.log(`       no framework labels ${pad(fraction(q.days - q.frameworkLabels, q.days), 7)}`);
  console.log(
    `       no strategy leak    ${pad(fraction(q.days - q.purposeLeaks, q.days), 7)}  (the schedule's "tujuan" is for the writer, not the customer)`,
  );
  console.log(`       video days covered  ${pad(fraction(q.videoPresent, q.videoWanted), 7)}`);
  console.log(`       hashtags            ${pad(q.hashtagsPerPost, 7)} per post, ${q.distinctHashtags} distinct across the plan`);

  return { q, cost };
}

/* --------------------------------- the files -------------------------------- */

function markdown(run: Run): string {
  const brief = buildBrief(PROFILE, DAYS);
  const lines: string[] = [
    `# ${PROFILE.name} — ${DAYS} days, written by ${run.model}`,
    "",
    `Generated ${new Date().toISOString()} from the profile in \`lib/content/demo.ts\`, starting ${START_DATE}.`,
    "",
  ];
  for (const item of run.items) {
    const slot = brief.schedule.find((s) => s.day === item.day);
    lines.push(`## Hari ${item.day} — ${slot?.category ?? "?"} · ${slot?.platform ?? "?"}`);
    lines.push("");
    lines.push(`**Objektif.** ${item.objective}`);
    lines.push("");
    lines.push(`**Hook.** ${item.hook}`);
    lines.push("");
    lines.push(item.caption);
    lines.push("");
    lines.push(`**CTA.** ${item.cta}`);
    lines.push("");
    lines.push(`**Visual.** ${item.visualIdea}`);
    if (item.videoIdea) lines.push("", `**Video.** ${item.videoIdea}`);
    lines.push("", `**Design.** ${item.designDirection}`);
    lines.push("", item.hashtags.length ? `\`${item.hashtags.map((h) => `#${h}`).join(" ")}\`` : "_tiada hashtag_");
    lines.push("");
  }
  if (run.regenerated) {
    lines.push(`## Regenerated day ${REGEN_DAY}`);
    lines.push("", `**Was.** ${run.regeneratedFrom ?? "—"}`);
    lines.push("", `**Now.** ${run.regenerated.hook}`);
    lines.push("", run.regenerated.caption, "");
  }
  return lines.join("\n");
}

/** The two months interleaved day by day — the only view that answers "is it worse?". */
function comparison(runs: Run[]): string {
  const brief = buildBrief(PROFILE, DAYS);
  const lines: string[] = [
    `# Day by day, ${runs.map((r) => r.model).join(" vs ")}`,
    "",
    "Same restaurant, same schedule, same batch boundaries. Read the captions, not the counts.",
    "",
  ];
  for (let day = 1; day <= DAYS; day++) {
    const slot = brief.schedule.find((s) => s.day === day);
    lines.push(`## Hari ${day} — ${slot?.category ?? "?"} · ${slot?.platform ?? "?"}`);
    for (const run of runs) {
      const item = run.items.find((i) => i.day === day);
      lines.push("", `### ${run.model}`);
      if (!item) {
        lines.push("", "_not generated_");
        continue;
      }
      lines.push("", `**${item.hook}**`, "", item.caption, "", `_${item.cta}_`, "", `Visual: ${item.visualIdea}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/* ---------------------------------- the run --------------------------------- */

/**
 * Re-reads a finished run from disk.
 *
 * A benchmark is expensive and a question about it usually arrives afterwards.
 * This re-applies the current measures to months that have already been paid
 * for, so improving how the output is read never costs another generation.
 */
function reread(dir: string): Run[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((file) => {
      const saved = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      // A run saved before attempts were recorded can still be priced, just not
      // split by model. Reporting $0.0000 would be worse than reporting a whole.
      const attempts = (saved.attempts as Attempt[] | undefined) ?? [
        {
          label: "whole run",
          days: [],
          outcome: null,
          usage: saved.usage as Usage,
          model: String(saved.model),
          error: null,
        },
      ];
      return {
        model: String(saved.model),
        attempts: attempts.map((a) => ({ ...a, days: [], outcome: null })),
        items: saved.items as ContentItem[],
        regenerated: (saved.regenerated as ContentItem | null) ?? null,
        regeneratedFrom: (saved.regeneratedFrom as string | null) ?? null,
        usage: saved.usage as Usage,
        ms: Number(saved.durationMs ?? 0),
        calls: Number(saved.calls ?? 0),
        repairs: Number(saved.repairs ?? 0),
        violations: (saved.violations as Violation[]) ?? [],
        failures: (saved.failures as string[]) ?? [],
      } satisfies Run;
    });
}

async function main() {
  const saved = flag("report");
  if (saved) {
    console.log(`\nContentKita — re-reading ${saved}, no API calls\n`);
    for (const run of reread(saved)) reportRun(run);
    console.log("");
    return;
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is not set — run with --env-file=.env.local");
  }
  for (const model of MODELS) {
    if (!RATES[model]) {
      throw new Error(`No rate for "${model}" in lib/ai/pricing.ts — add it before benchmarking it`);
    }
  }

  console.log(`\nContentKita — model benchmark`);
  console.log(`  ${DAYS} days × ${MODELS.length} model(s), same brief, same schedule, plus one regeneration each`);
  console.log(
    REPAIR_WITH
      ? `  writing goes to the model under test, repairs go to ${REPAIR_WITH}\n`
      : `  writing and repair both go to the model under test\n`,
  );

  const runs: Run[] = [];
  for (const model of MODELS) {
    runs.push(await runModel(model));
  }

  const summaries = runs.map((run) => ({ run, ...reportRun(run) }));

  console.log(`\n  ── side by side ────────────────────────────────`);
  const cheapest = Math.min(...summaries.map((s) => s.cost));
  for (const { run, cost } of summaries) {
    const perPack = cost;
    console.log(
      `     ${run.model.padEnd(14)} ${usd(perPack).padStart(9)}` +
        (cost > cheapest ? `  ${(cost / cheapest).toFixed(1)}× the cheapest` : "  ← cheapest") +
        `   ${fraction(run.items.length, DAYS)} days, ${run.repairs} repair(s), ${run.violations.length} violation(s), ${run.failures.length} gave up`,
    );
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const run of runs) {
    const stem = join(OUT_DIR, run.model);
    writeFileSync(
      `${stem}.json`,
      JSON.stringify(
        {
          model: run.model,
          days: DAYS,
          startDate: START_DATE,
          usage: run.usage,
          repairModel: REPAIR_WITH ?? run.model,
          // Kept so `--report` can re-price a finished run without re-running it.
          attempts: run.attempts.map((a) => ({
            label: a.label,
            model: a.model,
            usage: a.usage,
            repairs: a.outcome?.repairs ?? 0,
            error: a.error,
          })),
          cost: run.attempts.reduce((sum, a) => sum + attemptCost(a), 0),
          calls: run.calls,
          repairs: run.repairs,
          durationMs: run.ms,
          violations: run.violations,
          quality: read(run.items),
          items: run.items,
          regenerated: run.regenerated,
          regeneratedFrom: run.regeneratedFrom,
          failures: run.failures,
        },
        null,
        2,
      ),
    );
    writeFileSync(`${stem}.md`, markdown(run));
  }
  writeFileSync(join(OUT_DIR, "compare.md"), comparison(runs));

  console.log(`\n  written to ${OUT_DIR}/ — read compare.md before trusting any number above.\n`);
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
