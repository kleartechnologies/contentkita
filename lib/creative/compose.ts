import { CATEGORY_META } from "../content/categories.ts";
import type {
  AssetRef,
  BrandTone,
  ContentCategory,
  ContentItem,
  Platform,
  RestaurantProfile,
} from "../content/types.ts";
import {
  chooseBrandTreatment,
  chooseCardPlacement,
  chooseCardScale,
  chooseComposition,
  chooseCtaTreatment,
  chooseGround,
  chooseHeadlineTreatment,
  ctaLimit,
  fitCropToBox,
  fitToMeasure,
  isGraphic,
  keepClearFor,
  leadingFor,
  LETTERED_BRAND,
  orderImages,
  redirectForGraphic,
  trackingFor,
  typedRegion,
  washFor,
  type Arrangement,
  type CardPlacement,
  type CtaTreatment,
  type Ground,
} from "./direction.ts";
import { familyFor, focalFor } from "./families.ts";
import { accentField, accentTint, buildPalette } from "./palette.ts";
import { signatureOf, type Signature } from "./photo.ts";
import { ctaLine } from "./text.ts";
import {
  CANVAS,
  CREATIVE_VERSION,
  DEFAULT_FOCAL,
  type Background,
  type Box,
  type Creative,
  type CreativeElement,
  type CreativeFormat,
  type Focal,
  type ImageElement,
  type LogoElement,
  type Palette,
  type Scrim,
  type ScrimDirection,
  type ShapeElement,
  type TemplateId,
  type TextElement,
  type TextStyle,
} from "./types.ts";

/**
 * Turning one finished content day into one finished creative.
 *
 * ## Why there is no AI call in this file
 *
 * Every word that reaches a poster here was written by the generator and then
 * checked by `lib/content/validate.ts` — the hook, the CTA — or typed by the
 * owner themselves: the restaurant name, the dish names, the logo. Composition
 * selects and arranges; it never writes.
 *
 * That is not a shortcut, it is the safety property. The anti-hallucination
 * work in M1-M3 guards the text the generator produces. A second model asked to
 * "design a poster" would produce new text that had never been through any of
 * it, and the first invented price would appear on an image the owner posts
 * rather than in a caption they read first. Keeping the poster's words a strict
 * subset of already-validated words means a creative *cannot* claim anything
 * the plan does not already claim.
 *
 * It is also the reason a thirty-day pack costs exactly what it costs today.
 * Composition is arithmetic: no tokens, no request, no rate limit.
 *
 * The AI still makes the creative decisions — which dish the day is about, what
 * the hook says, which category and platform the day serves, what the visual
 * should show. Those decisions arrive as fields on `ContentItem`. This file
 * reads them and picks a layout; it does not second-guess them.
 */

/* --------------------------------- format --------------------------------- */

/**
 * Categories whose poster leads with one hero dish.
 *
 * A plate fills a 4:5 frame better than a square one, and a taller post simply
 * occupies more of a phone screen as it goes past — which is the whole job of a
 * food photograph in a feed. Everything else stays square, so the month reads
 * as a deliberate mix of shapes rather than one canvas stamped thirty times.
 */
const PORTRAIT_CATEGORIES: readonly ContentCategory[] = [
  "produk",
  "best_seller",
  "perayaan",
] as const;

/**
 * The shape this post should be published in.
 *
 * Platform first, because that is what decides the aspect ratio a feed will
 * crop to: WhatsApp Status and TikTok are full-screen vertical, so anything
 * else is letterboxed. Within a feed the category decides, per above.
 */
export function formatFor(item: ContentItem): CreativeFormat {
  if (item.platform === "whatsapp" || item.platform === "tiktok") return "story";
  if (item.category === "reels") return "portrait";
  return PORTRAIT_CATEGORIES.includes(item.category) ? "portrait" : "square";
}

/**
 * Which layout to use.
 *
 * Thin on purpose: the decision is `familyFor`, which is where the month's
 * whole distribution lives. This keeps the old two-argument shape so callers
 * that only know whether a photograph exists — the pack builder, the studio —
 * do not have to care how the wheel turns.
 */
export function templateFor(item: ContentItem, image: AssetRef | null): TemplateId {
  const family = familyFor(item, image !== null);
  // A drawing cannot be the page. See `redirectForGraphic`: the picture-led
  // families all fail the same way on one, and every replacement takes exactly
  // one image, so the pack builder's deal is unaffected.
  return redirectForGraphic(family, signatureOf(image), item.day, item.hook);
}

/* ---------------------------------- text ---------------------------------- */

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The ways a dish can be named, longest first.
 *
 * An owner writes "Nasi Lemak Ayam Berempah" on their menu and then writes
 * "nasi lemak" in the caption, because that is what anyone calls it. Matching
 * only the full string means the dish the post is plainly about is never
 * found, and some other dish mentioned in passing wins the label instead.
 *
 * Leading words only, and never fewer than two: "Nasi Lemak Ayam Berempah"
 * may be recognised by "Nasi Lemak Ayam" or "Nasi Lemak", never by "Ayam" —
 * a single common word would match half the menu.
 */
function dishNames(dish: string): string[] {
  const words = normalise(dish).split(" ").filter(Boolean);
  if (words.length < 2) return words.length ? [words.join(" ")] : [];
  const names: string[] = [];
  for (let length = words.length; length >= 2; length--) {
    names.push(words.slice(0, length).join(" "));
  }
  return names;
}

/**
 * The hook, set as a headline.
 *
 * A headline is one line standing on its own, and a line standing on its own
 * does not end mid-breath: day 3 of an M6.5 acceptance pack was written
 * "Tengok sini," and printed exactly that, comma and all, in 96pt across the
 * top of the page — a sentence the poster promises to finish and never does.
 *
 * The words are the writer's and are not touched. What goes is a dangling
 * comma, semicolon or dash, which is punctuation for a sentence that
 * continues, and this one has nowhere to continue to. The caption below keeps
 * the line as it was written.
 */
function headlineFrom(hook: string): string {
  return hook.trim().replace(/[,;:\u2013\u2014-]+$/, "").trim();
}

/**
 * The dish this day is about, in the owner's own words — or null.
 *
 * "About" is the whole difficulty. A caption that opens on the nasi lemak and
 * happens to mention roti canai in a list of what else is on the counter is a
 * post about nasi lemak, and a poster stamped ROTI CANAI over a photograph of
 * nasi lemak is a post the owner will not publish — the sort of mismatch
 * nobody notices until a customer orders the wrong thing.
 *
 * So the search runs where a post declares its subject and nowhere else: the
 * hook, and failing that the caption's opening paragraph. A dish named further
 * down is being mentioned, not featured, and the poster stays silent rather
 * than promote it. Within a tier the earliest mention wins, and a tie goes to
 * the longer name, which is the more specific one.
 *
 * The list searched is `bestSellers`, which the owner typed. Nothing here can
 * produce a dish name that was not already on their menu.
 */
export function dishInPost(
  item: ContentItem,
  bestSellers: readonly string[],
): string | null {
  for (const tier of subjectTiers(item)) {
    const dish = dishInText(tier, bestSellers);
    if (dish) return dish;
  }
  return null;
}

/**
 * The two places a post declares its subject, strongest first.
 *
 * The hook is the line the day is about. The caption's opening paragraph is
 * the next best thing. Anything below that is being mentioned, not featured.
 * Exported because the picture and the label have to read the same evidence
 * in the same order — see `assignPhotos`.
 */
export function subjectTiers(item: ContentItem): string[] {
  return [item.hook, item.caption.split(/\n\s*\n/)[0] ?? ""];
}

/** The best seller named earliest in one piece of text, or null. */
export function dishInText(
  text: string,
  bestSellers: readonly string[],
): string | null {
  const haystack = normalise(text);
  if (!haystack) return null;

  let best: { dish: string; at: number; length: number } | null = null;
  for (const dish of bestSellers) {
    for (const name of dishNames(dish)) {
      const at = haystack.indexOf(name);
      if (at < 0) continue;
      if (!best || at < best.at || (at === best.at && name.length > best.length)) {
        best = { dish: dish.trim(), at, length: name.length };
      }
      break;
    }
  }
  return best?.dish ?? null;
}

/**
 * True when the owner's own filename says this picture is of this dish.
 *
 * The only thing in the product that knows what a photograph contains, and it
 * knows it because the owner typed it: `Nasi-lemak.jpg` is a file they named,
 * uploaded and can see in their own library. Nothing is inspected, inferred or
 * guessed at — a photograph called `IMG_4821.jpg` matches nothing and falls
 * through to the ordinary rotation, which is the honest answer.
 *
 * Matched with the same leading-word rule the dish label uses, so a day about
 * "Nasi Lemak Ayam Berempah" recognises a file called `nasi-lemak.jpg` for the
 * same reason a caption saying "nasi lemak" recognises the dish.
 */
export function photoNamesDish(filename: string, dish: string): boolean {
  const hay = normalise(filename);
  if (!hay) return false;
  return dishNames(dish).some((name) => hay.includes(name));
}

/** Words a filename carries that say nothing about what is in the picture. */
const FILE_NOISE = new Set([
  "jpg", "jpeg", "png", "webp", "heic", "img", "image", "photo", "final", "copy", "edit",
]);

/**
 * How many of the words in a photograph's filename the day's own copy uses.
 *
 * `photoNamesDish` only sees food the owner listed as a best seller, and a
 * month of copy is not confined to four dishes. Day 4 of the M6.5 acceptance
 * pack opened "Ayam berempah kami direndam semalaman." over a photograph of a
 * man flipping roti canai dough, while `Ayam-goreng-berempah.jpg` sat unused
 * in the same pool; day 10 said "Sambal ikan bilis ni tak dibuat main." and
 * was dealt the nasi lemak instead of `Sambal-ikan-bilis.jpg`. In both cases
 * the owner had already written down what the picture is of and the day had
 * already written down what it is about, in the same words, and nothing was
 * looking.
 *
 * So this looks — at the two places a post declares its subject, the hook and
 * the caption's opening paragraph, exactly as `dishInPost` does. The words
 * must appear in the filename's own order and no more than one word apart, so
 * "ayam ... berempah" recognises `Ayam-goreng-berempah.jpg` while a caption
 * that happens to say "ayam" in one sentence and "berempah" in the next does
 * not. Two words is the floor: one common word — "nasi", "ayam" — would hand
 * half the library to half the month.
 *
 * The count is returned rather than a yes, so a day that names two files can
 * be given the one it names more fully. Still nothing but the owner's typing:
 * `IMG_4821.jpg` has no words in it and claims nothing.
 */
export function photoWordsInPost(filename: string, item: ContentItem): number {
  for (const tier of subjectTiers(item)) {
    const words = photoWordsInText(filename, tier);
    if (words > 0) return words;
  }
  return 0;
}

/** The same count, taken against one piece of text. See `photoWordsInPost`. */
export function photoWordsInText(filename: string, text: string): number {
  const words = normalise(filename.replace(/\.[a-z0-9]+$/i, ""))
    .split(" ")
    .filter((word) => word.length > 2 && !FILE_NOISE.has(word) && !/^[0-9]+$/.test(word));
  if (words.length < 2) return 0;

  const said = normalise(text).split(" ").filter(Boolean);
  let best = 0;
  for (const [start, word] of said.entries()) {
    const first = words.indexOf(word);
    if (first < 0) continue;
    let run = 1;
    let at = start;
    for (let next = first + 1; next < words.length; next += 1) {
      const found = said.indexOf(words[next], at + 1);
      // A word the copy skipped is free; a word it says three sentences later
      // is a coincidence, not a caption about this photograph.
      if (found >= 0 && found - at <= 2) {
        run += 1;
        at = found;
      }
    }
    if (run > best) best = run;
  }
  return best >= 2 ? best : 0;
}

/**
 * The dish label, unless the picture on the page contradicts it.
 *
 * A poster captioned "Nasi Ayam Penyet" over a drawing of a glass of teh tarik
 * is not a design problem, it is the poster saying something untrue — and the
 * one case where the product can *know* it is untrue is the case the owner
 * told it about: they named the file. `Teh-tarik.jpg` on a Nasi Ayam Penyet
 * day is the owner's own evidence that the two do not match.
 *
 * The label goes rather than the picture. A day dealt a mismatched photograph
 * still has a photograph of this restaurant's food on it, which is true; a day
 * with the slot emptied has a hole in it, which helps nobody. And a filename
 * that names nothing — `IMG_4821.jpg` — is not evidence either way and is left
 * alone, exactly as it is everywhere else.
 */
export function labelForPhoto(
  dish: string | null,
  filename: string | null,
  menu: readonly string[],
): string | null {
  if (!dish || !filename) return dish;
  if (photoNamesDish(filename, dish)) return dish;
  const contradicts = menu.some(
    (other) => other.trim() !== dish.trim() && photoNamesDish(filename, other),
  );
  return contradicts ? null : dish;
}

/**
 * The name the creative is filed under, e.g. "Nasi Lemak — Hari 01".
 *
 * The dish when the post is about one, the category otherwise. Editable by the
 * owner afterwards; this is only the starting point.
 */
export function defaultName(item: ContentItem, dish: string | null): string {
  const subject = dish ?? CATEGORY_META[item.category].label;
  return `${subject} — Hari ${String(item.day).padStart(2, "0")}`;
}

/* ------------------------------- typography ------------------------------- */

/**
 * How the type behaves for each brand tone.
 *
 * The tone is something the owner chose in onboarding, so this is their
 * decision expressed in type rather than a style we picked for them. `premium`
 * is the one that genuinely differs: lighter weight, wider letterspacing and
 * capitals, because that is what the look is.
 */
interface ToneType {
  weight: number;
  headline: number;
  tracking: number;
  transform: "none" | "uppercase";
}

const TONE_TYPE: Record<BrandTone, ToneType> = {
  friendly: { weight: 800, headline: 0.085, tracking: -0.015, transform: "none" },
  casual: { weight: 800, headline: 0.088, tracking: -0.02, transform: "none" },
  funny: { weight: 900, headline: 0.095, tracking: -0.025, transform: "none" },
  premium: { weight: 500, headline: 0.07, tracking: 0.03, transform: "uppercase" },
  family: { weight: 700, headline: 0.082, tracking: -0.01, transform: "none" },
  kampung: { weight: 700, headline: 0.082, tracking: -0.01, transform: "none" },
};

/**
 * The type this poster's headline is set in.
 *
 * The tone decides the voice — weight, capitals, whether the tracking runs
 * positive — and `chooseHeadlineTreatment` decides the size, the leading and
 * how hard to pull the letters in, from the length of the sentence itself.
 * `factor` is the family's own idea of scale: a wall-of-type poster asks for
 * 1.45, a caption under a close-up for 0.85.
 *
 * The tracked tones keep their own tracking. `premium` is set in wide capitals
 * on purpose — that *is* the look the owner chose — and pulling it in because
 * the type got big would quietly cancel their answer.
 */
function headlineStyle(parts: Parts, factor = 1): TextStyle {
  const t = TONE_TYPE[parts.tone];
  const chosen = chooseHeadlineTreatment(parts.headline, t.headline * factor);
  return {
    family: "display",
    weight: t.weight,
    size: chosen.size,
    lineHeight: chosen.lineHeight,
    letterSpacing: t.tracking > 0 ? t.tracking : chosen.tracking,
    transform: t.transform,
  };
}

const LABEL_STYLE: TextStyle = {
  family: "body",
  weight: 700,
  size: 0.026,
  lineHeight: 1.2,
  letterSpacing: 0.08,
  transform: "uppercase",
};

const CTA_STYLE: TextStyle = {
  family: "body",
  weight: 700,
  size: 0.032,
  lineHeight: 1.2,
  letterSpacing: 0,
  transform: "none",
};

/**
 * The headline, sized for the column it is actually going in.
 *
 * `headlineStyle` decides the size from the sentence; only the box knows the
 * measure, so the correction is applied here rather than at each of the two
 * dozen places a family sets a headline — a family that forgot to pass its own
 * width would silently get the old behaviour back.
 */
function setForMeasure(style: TextStyle, width: number): TextStyle {
  const size = fitToMeasure(style.size, width);
  if (size === style.size) return style;
  return {
    ...style,
    size,
    lineHeight: leadingFor(size),
    letterSpacing: style.letterSpacing > 0 ? style.letterSpacing : trackingFor(size),
  };
}

/* -------------------------------- elements -------------------------------- */

/**
 * Element ids are the role they play.
 *
 * Roles are unique within a template, so this is unique within a creative — and
 * being derived rather than generated keeps composition pure: the same day
 * composed twice produces byte-identical elements, which is what makes a saved
 * creative comparable with a freshly composed one.
 */
function text(
  role: TextElement["role"],
  value: string,
  box: Box,
  style: TextStyle,
  extra: Partial<Omit<TextElement, "kind" | "role" | "text" | "box" | "style">> = {},
): TextElement {
  return {
    kind: "text",
    id: role,
    order: 0,
    role,
    text: value,
    box,
    style: role === "headline" ? setForMeasure(style, box.width) : style,
    colour: "ink",
    align: "left",
    valign: "top",
    autoFit: true,
    plate: null,
    rule: null,
    ...extra,
  };
}

/* --------------------------------- layout --------------------------------- */

const M = 0.07; // Page margin, as a fraction of the width.

/**
 * The small, deterministic differences between one day's poster and the next.
 *
 * A month composed by one template set is thirty posters that look the same,
 * and an owner scrolling their own grid notices that before they notice
 * anything else. So each day gets a *treatment*: the same elements, arranged
 * one of a few known-good ways.
 *
 * Three things this deliberately is not:
 *
 *   - It is not an anti-repetition rule. Nothing here rejects a day for being
 *     the same category, the same dish or the same template as the day before.
 *     M4A tried strict repetition rules on the copy and the writing got worse,
 *     not more varied; there is no reason to expect layout to behave better.
 *   - It is not random. The treatment is a function of the day number, so a
 *     creative composed twice is the same creative — which is what lets a saved
 *     design be compared with a freshly composed one.
 *   - It is not a licence to make a poster harder to read. Every variant is a
 *     rearrangement within the same palette and the same contrast guarantees.
 *     Where moving the type would have put it on the part of a photograph the
 *     scrim does not cover, the photograph moves instead of the type.
 *
 * The periods are 2, 4 and 3, so they come back into phase every twelfth day
 * rather than every second one.
 */
export interface Treatment {
  /** Lay the page on the slightly deeper surface tone rather than the base. */
  deeper: boolean;
  /** Centre the CTA pill on the page instead of aligning it to the margin. */
  centreCta: boolean;
  /** Move the type block. What that means is each template's own business. */
  alternate: boolean;
}

export function treatmentFor(item: ContentItem): Treatment {
  const n = Math.max(Math.trunc(item.day), 1) - 1;
  // Every period below is odd-stepped against the fifteen-day family wheel, so
  // the two days a month that share a family never share a treatment. An
  // earlier version used `n % 3`, which divides fifteen exactly — the second
  // hero day was the first hero day again, and half the compositions in this
  // file were never rendered at all.
  return {
    deeper: n % 4 >= 2,
    centreCta: n % 6 >= 3,
    alternate: n % 2 === 1,
  };
}

/** Whether this day takes the family's first arrangement or its second. */
function primary(parts: Parts): boolean {
  return parts.arrangement === "primary";
}

/** How the CTA's own words align inside the box `ctaBox` gave it. */
function ctaAlign(t: Treatment): TextElement["align"] {
  return t.centreCta ? "center" : "left";
}

/**
 * Where the CTA pill sits, given the treatment. The same size either way.
 *
 * Tall enough for two lines. A call to action written by a person is a
 * sentence — "Save post ni untuk rujukan bila datang nanti" — not a button
 * label, and a pill sized for one line squeezes it until it looks like a
 * mistake.
 */
function ctaBox(t: Treatment, y: number): Box {
  const width = 0.68;
  return { x: t.centreCta ? (1 - width) / 2 : M, y, width, height: 0.088 };
}

/**
 * The page colour for this day.
 *
 * Three grounds rather than M6's two, all derived from the one colour the
 * owner gave us, all of which carry `ink` at full contrast. See `chooseGround`
 * — the whole argument for the third one is that a month alternating between
 * exactly two grounds reads as two posters.
 */
function pageColour(parts: Parts): string {
  const role = parts.ground;
  if (role === "surface") return parts.palette.surface;
  if (role === "tint") return accentTint(parts.palette);
  return parts.palette.base;
}

/* -------------------------------- templates ------------------------------- */

/**
 * The placeholder every empty slot carries.
 *
 * One string, because it is an instruction to the owner rather than design, and
 * it is never exported — see `paintImage`.
 */
const PHOTO_SLOT = "Letak gambar makanan anda di sini";

interface Parts {
  headline: string;
  /** The dish, or null. Rendered as the small label above the headline. */
  label: string | null;
  cta: string;
  brand: string;
  logo: AssetRef | null;
  /** As many photographs as this family asked for. May be shorter. */
  images: readonly AssetRef[];
  /** How each slot frames its picture, indexed the same way. */
  focals: readonly Focal[];
  /** The occasion this day belongs to, for the festive family. */
  occasion: string | null;
  /** The day number, which is what every rotation in `direction.ts` walks. */
  day: number;
  /**
   * What `photo.ts` read off the first picture, or null.
   *
   * Only the first: every family but the collage has one slot, and the collage
   * treats its three frames alike. A family that needs slot two's signature
   * asks `signatureOf(parts.images[1])` itself.
   */
  signature: Signature | null;
  /** Which of the family's two arrangements this day gets. */
  arrangement: Arrangement;
  /** The page colour role for this day. See `chooseGround`. */
  ground: Ground;
  /** The town, for the family that is about the neighbourhood. */
  location: string;
  tone: BrandTone;
  palette: Palette;
  treatment: Treatment;
  /**
   * The shape of the page, because some arrangements only work on some shapes.
   *
   * A layout that divides the page down the middle is a different proposition
   * on a 1080x1080 square than on a 1080x1920 story: the same fraction of the
   * width is a comfortable column on one and a gutter on the other. Families
   * that care read this; the rest ignore it.
   */
  format: CreativeFormat;
}

interface Built {
  background: Background;
  elements: CreativeElement[];
}

/* ------------------------------ small pieces ------------------------------ */

/**
 * One photo slot.
 *
 * Slot zero keeps the id `photo`, which is what the studio's "replace picture"
 * control has always looked for and what every creative already saved uses.
 */
function frame(
  parts: Parts,
  index: number,
  box: Box,
  extra: Partial<Pick<ImageElement, "radius" | "scrim" | "order" | "fit">> = {},
): ImageElement {
  const source = parts.images[index] ?? null;
  // A drawing is fitted inside its box rather than cropped to fill it, and it
  // is never washed. `contain` keeps the artwork whole; a scrim over a flat
  // graphic reads as a printing fault rather than as a design. A caller that
  // has already cut the box to the artwork's own proportions says so — see
  // `panel` — and gets the trim instead.
  const signature = signatureOf(source);
  const graphic = isGraphic(signature);
  // The box is only known here, which is the one place the crop the day asked
  // for can be reconciled with the crop the slot's shape has already taken.
  // See `fitCropToBox`.
  const focal = fitCropToBox(
    parts.focals[index] ?? DEFAULT_FOCAL,
    box,
    signature,
    parts.format,
  );
  return {
    kind: "image",
    id: index === 0 ? "photo" : `photo-${index + 1}`,
    order: extra.order ?? 0,
    box,
    source,
    fit: extra.fit ?? (graphic ? "contain" : "cover"),
    radius: extra.radius ?? 0,
    focal,
    scrim: graphic ? null : settle(extra.scrim ?? null, signature, box, focal, parts.format),
    placeholder: PHOTO_SLOT,
  };
}

/**
 * The wash, finally priced, now that the crop is known.
 *
 * `wash` asks for a depth; this is where the picture answers. The part of the
 * photograph that ends up under the type is worked out from the slot's shape
 * and the crop pointed at it, and *that* is what sets the opacity — so a dark
 * photograph with a mound of white rice exactly where the headline goes is
 * washed for the rice rather than for the wood.
 */
function settle(
  scrim: Scrim | null,
  signature: Signature | null,
  box: Box,
  focal: Focal,
  format: CreativeFormat,
): Scrim | null {
  if (!scrim) return null;
  const canvas = CANVAS[format];
  const slot = { width: box.width * canvas.width, height: box.height * canvas.height };
  return {
    ...scrim,
    opacity: washFor(signature, scrim.opacity, typedRegion(signature, slot, focal, scrim.direction)),
  };
}

/** True when this day's nth picture is a drawing rather than a photograph. */
function drawingAt(parts: Parts, index: number): boolean {
  return isGraphic(signatureOf(parts.images[index] ?? null));
}

/**
 * A picture slot, plus the panel a drawing needs behind it.
 *
 * `contain` fits artwork inside its box without cropping, which leaves the
 * page colour showing on two sides — and a drawing exported on white, floating
 * on a cream page with a hard white edge of its own, is the single most
 * obviously assembled thing on a poster. A panel in the brand tint behind it
 * turns that edge into a deliberate one: the artwork sits *in* something, the
 * way a menu illustration sits in a printed box.
 *
 * Photographs get nothing extra — `cover` fills the box, so there is nothing
 * to sit behind — and the whole branch is invisible unless `photo.ts` was
 * confident enough to call the file a graphic.
 */
function panel(
  parts: Parts,
  index: number,
  box: Box,
  extra: Partial<Pick<ImageElement, "radius" | "scrim" | "order" | "fit">> = {},
): CreativeElement[] {
  const signature = signatureOf(parts.images[index] ?? null);
  if (!signature || !isGraphic(signature)) return [frame(parts, index, box, extra)];

  // The panel is cut to the artwork's own proportions rather than the slot's,
  // so `contain` fills it exactly and there is no letterbox at all. Sizing the
  // panel to the slot instead left a tall drawing in a wide frame sitting
  // between two tinted bars, which does not read as a card — it reads as an
  // image that failed to load.
  const cut = hang(
    toAspect(box, signature, parts.format),
    box,
    chooseCardPlacement(parts.day),
    chooseCardScale(parts.day),
  );
  // `cover` rather than `contain`, now that the box is the artwork's own
  // shape: `contain` ignores the focal point, so `graphicCrop`'s trim never
  // reached the canvas and the card was filled with the white margin the
  // drawing was exported on — a mug at half size in the middle of a white
  // rectangle. Cutting the box to the file's proportions and cropping into it
  // by exactly that trim fills the card with the drawing and leaves a tenth of
  // it as air, which is what mounting a picture means.
  const picture = frame(parts, index, cut, { ...extra, fit: "cover" });
  return [
    block(`${picture.id}-panel`, mount(cut, parts.format), "tint", {
      order: picture.order,
      radius: extra.radius ?? 0.02,
    }),
    { ...picture, order: picture.order + 1 },
  ];
}

/** A box shrunk about its own centre. Keeps the shape, changes the size. */
function shrink(box: Box, k: number): Box {
  return {
    x: box.x + (box.width * (1 - k)) / 2,
    y: box.y + (box.height * (1 - k)) / 2,
    width: box.width * k,
    height: box.height * k,
  };
}

/**
 * Where in its slot a mounted drawing actually hangs, and how big.
 *
 * A photograph varies by crop: the same plate at a different zoom pointed at a
 * different part of itself is a different picture, which is what `chooseCrop`
 * and `chooseCropShift` are for. A drawing has no crop — it is trimmed to its
 * own edges and that is the only version of it there is — so if a month gives
 * the same drawing six days, six identical cards is what the arithmetic
 * produces unless something else moves. Placement and size are what a person
 * moves: hang it left of the measure on one page, mount it small in the middle
 * of the next.
 *
 * It never leaves the slot the layout gave it, so a family that put type beside
 * the picture keeps its type: the card slides within the space it already had,
 * and stops a page margin short of the page edge so a left-hung card reads as
 * ranged rather than as fallen off.
 */
function hang(cut: Box, slot: Box, place: CardPlacement, scale: number): Box {
  const small = shrink(cut, scale);
  const free = slot.width - small.width;
  const centre = slot.x + free / 2;
  if (free <= 0) return small;
  const lo = Math.max(slot.x, M);
  const hi = Math.min(slot.x + free, 1 - M - small.width);
  if (hi <= lo) return { ...small, x: centre };
  if (place === "left") return { ...small, x: lo };
  if (place === "right") return { ...small, x: hi };
  return { ...small, x: centre };
}

/**
 * The panel, grown by an even margin on every side: a mount, not a backing.
 *
 * Sized to the artwork exactly, the panel is invisible — the drawing covers it
 * — and what the page then shows is the drawing's own white edge against a
 * cream ground, which is the hard rectangle that reads as a screenshot pasted
 * onto a poster. A few millimetres of brand tint all round turns the same edge
 * into a mounted print. The margin is equal in *ink*, not in fractions: the
 * canvas is not square in two of the three formats, so the vertical padding is
 * the horizontal one converted through the aspect.
 */
function mount(box: Box, format: CreativeFormat): Box {
  const canvas = CANVAS[format];
  const padX = 0.028;
  const padY = (padX * canvas.width) / canvas.height;
  const left = Math.max(0, box.x - padX);
  const right = Math.min(1, box.x + box.width + padX);
  const top = Math.max(0, box.y - padY);
  const bottom = Math.min(1, box.y + box.height + padY);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The largest box of the picture's shape that fits inside `box`, centred.
 *
 * Boxes are fractions of two different dimensions, so a box is only square
 * when the canvas is; the format has to come into it. See the note at the top
 * of `types.ts`.
 */
function toAspect(box: Box, signature: Signature, format: CreativeFormat): Box {
  const canvas = CANVAS[format];
  if (signature.width <= 0 || signature.height <= 0) return box;
  const wanted = signature.width / signature.height;
  const has = (box.width * canvas.width) / (box.height * canvas.height);
  if (has <= 0) return box;
  if (wanted > has) {
    const height = box.height * (has / wanted);
    return { ...box, y: box.y + (box.height - height) / 2, height };
  }
  const width = box.width * (wanted / has);
  return { ...box, x: box.x + (box.width - width) / 2, width };
}

/**
 * A dark wash over a photograph. The only safe ground for type on a picture.
 *
 * The opacity asked for is a starting point, not the answer: `washFor` moves
 * it by how bright the picture actually is. A dark kitchen shot keeps its mood
 * under a light wash; a bright overexposed plate needs a heavy one. M6 used
 * `0.55` for both and got the worst of each — the dark ones flattened to grey,
 * the bright ones still barely holding their type.
 */
function wash(base: number, direction: ScrimDirection = "bottom"): Scrim {
  // The opacity here is the request, not the answer. What the picture actually
  // needs depends on the crop, and the crop is not settled until the slot has
  // a box — so `frame` finishes this off. See `typedRegion`.
  return { colour: "photoScrim", opacity: base, direction };
}

/**
 * The call to action, drawn the way this day's art direction says.
 *
 * One helper rather than the two M6 had — a pill and a plain line — because
 * the choice between them was being made by whichever function the layout
 * happened to call, which is how sixteen of thirty posters ended up with the
 * identical green button. Here the layout says what it *is* — where the words
 * go, what colour they are, whether they are sitting on a photograph — and
 * `chooseCtaTreatment` says what they look like.
 *
 * Returns a list because "no call to action on the poster" is a real answer.
 * The sentence is still the last line of the caption the owner copies, so
 * nothing is lost, and a poster that ends on its headline is a design rather
 * than an omission.
 */
interface CtaOptions {
  /** The colour of the words when they are not on a plate. */
  ink: keyof Palette;
  align?: TextElement["align"];
  /** The plate, when the treatment turns out to be a pill. */
  plate?: keyof Palette;
  plateInk?: keyof Palette;
  /** The rule, when the treatment turns out to be an underline. */
  ruleColour?: keyof Palette;
  /** A structural preference this layout has. Overridden only for fit. */
  prefer?: CtaTreatment;
  /** True when these words sit over a photograph. */
  onPhoto?: boolean;
}

function cta(parts: Parts, box: Box, options: CtaOptions): TextElement[] {
  const treatment = chooseCtaTreatment({
    day: parts.day,
    text: parts.cta,
    room: box.width,
    prefer: options.prefer,
    onPhoto: options.onPhoto,
  });
  if (treatment === "none") return [];

  const value = ctaLine(parts.cta, ctaLimit(treatment, box.width));
  if (!value) return [];

  const align = options.align ?? "left";

  if (treatment === "pill") {
    return [
      text("cta", value, box, CTA_STYLE, {
        order: 40,
        colour: options.plateInk ?? "accentInk",
        align: "center",
        valign: "middle",
        plate: { colour: options.plate ?? "accent", radius: 0.5, padding: 0.03 },
      }),
    ];
  }

  if (treatment === "underline") {
    return [
      text("cta", value, box, CTA_STYLE, {
        order: 40,
        colour: options.ink,
        align,
        valign: "middle",
        // Just under a third of the type's size below the baseline, a
        // fourteenth of it thick. Both are fractions of the font size, so a
        // call to action `autoFit` had to shrink keeps its rule in proportion.
        rule: { colour: options.ruleColour ?? "accent", thickness: 0.07, offset: 0.3 },
      }),
    ];
  }

  return [
    text("cta", value, box, CTA_STYLE, {
      order: 40,
      colour: options.ink,
      align,
      valign: "middle",
    }),
  ];
}

/**
 * Whether `cta` would draw nothing here.
 *
 * Asked by the families that reserve a band for the call to action: on the
 * days the wheel says "none", or the sentence will not fit any treatment, the
 * band is empty and the signature below it is stranded at the foot of a poster
 * with a fifth of its page blank. Cheaper to ask `cta` than to restate its
 * rules, and it cannot fall out of step with them.
 */
function ctaAbsent(parts: Parts, box: Box, options: CtaOptions): boolean {
  return cta(parts, box, options).length === 0;
}

/**
 * The restaurant signing its own poster.
 *
 * The size, weight and case come from `chooseBrandTreatment` rather than from
 * one constant, because one constant is what turned the name into a watermark:
 * the same small bold line in the same corner on twenty-eight of thirty days.
 * A restaurant that sets its name three or four different ways across a month
 * is behaving like a brand; one that stamps it identically is behaving like a
 * free tool's footer.
 */
function brandLine(
  parts: Parts,
  box: Box,
  colour: keyof Palette,
  align: TextElement["align"] = "left",
  lettered = false,
): TextElement {
  const b = lettered ? LETTERED_BRAND : chooseBrandTreatment(parts.day);
  return text(
    "brand",
    parts.brand,
    box,
    {
      family: "body",
      weight: b.weight,
      size: b.size,
      lineHeight: 1.2,
      letterSpacing: b.tracking,
      transform: b.transform,
    },
    { order: 20, colour, align, valign: "middle" },
  );
}

/** The small line of capitals above a headline. Absent when there is nothing true to put there. */
function eyebrow(
  value: string,
  box: Box,
  colour: keyof Palette,
  align: TextElement["align"] = "left",
): TextElement {
  return text("subheading", value, box, LABEL_STYLE, {
    order: 25,
    colour,
    align,
  });
}

function mark(parts: Parts, box: Box): LogoElement[] {
  if (!parts.logo) return [];
  return [{ kind: "logo", id: "logo", order: 20, box, source: parts.logo }];
}

function block(
  id: string,
  box: Box,
  fill: keyof Palette,
  extra: Partial<Pick<ShapeElement, "radius" | "opacity" | "order">> = {},
): ShapeElement {
  return {
    kind: "shape",
    id,
    order: extra.order ?? 5,
    box,
    fill,
    radius: extra.radius ?? 0,
    opacity: extra.opacity ?? 1,
  };
}

/**
 * The headline at a family's own scale.
 *
 * `headlineStyle` already sizes for the sentence; the factor is the family's
 * separate opinion — a wall of type wants 1.45, a caption under a close-up
 * wants 0.85 — and the two multiply. The leading is recomputed from the size
 * that actually results, because leading that suited a tenth of the page is
 * not leading that suits a twentieth.
 */
function big(parts: Parts, factor: number): TextStyle {
  const style = headlineStyle(parts, factor);
  return { ...style, lineHeight: leadingFor(style.size) };
}

/* --------------------------------- families -------------------------------- */

/**
 * Product Hero — the plate, as large as the page allows.
 *
 * Two arrangements, and the difference between them is where the photograph
 * stops. In `full` the picture is the whole page and the type sits in the band
 * at the bottom that the wash darkens. In `band` the picture takes the top half
 * and the type sits below it on the page itself.
 *
 * Type at the *top* of a full-bleed photo is missing on purpose: the wash is
 * transparent up there so the food is still the picture, and light type on an
 * unknown photograph is a coin toss we would be flipping on the owner's behalf.
 */
function productHero(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts);

  if (primary(parts)) {
    const els: CreativeElement[] = [
      ...panel(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.55) }),
      text("headline", parts.headline, { x: M, y: 0.6, width: 1 - M * 2, height: 0.2 },
        headlineStyle(parts),
        { order: 30, colour: "photoInk", valign: "bottom" }),
      ...cta(parts, ctaBox(t, 0.845), {
        ink: "photoInk",
        ruleColour: "photoInk",
        align: ctaAlign(t),
        onPhoto: true,
      }),
      brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.06, width: 0.6, height: 0.08 }, "photoInk"),
      ...mark(parts, { x: M, y: 0.06, width: 0.14, height: 0.08 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: M, y: 0.545, width: 1 - M * 2, height: 0.04 }, "photoInk"));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // Banded: the photograph ends a little past the halfway line and every word
  // below it is on the page colour, so no wash is needed and none is drawn.
  //
  // The one thing that stops this reading as two stacked rectangles — which is
  // what every banded layout in the M6 pack read as — is the tab: a block of
  // the deep brand colour that starts on the photograph and finishes on the
  // page, carrying the dish name across the join. It is the cheapest real
  // layering in the whole set. Nothing overlaps the food itself, because the
  // tab sits against the left margin and the crop has already been told to
  // keep the subject away from that edge.
  const tabbed = parts.label !== null;
  const els: CreativeElement[] = [
    ...panel(parts, 0, { x: 0, y: 0, width: 1, height: 0.54 }),
    text("headline", parts.headline, { x: M, y: 0.66, width: 1 - M * 2, height: 0.17 },
      headlineStyle(parts), { order: 30, colour: "ink" }),
    // The call and the name are two rows, not one overlapping pair. `ctaBox` is
    // 0.088 tall, so a call hung at 0.855 reaches 0.943 and prints through a
    // name set at 0.925 — which is what day 4 of the acceptance pack did.
    ...cta(parts, ctaBox(t, 0.832), { ink: "ink", align: ctaAlign(t) }),
    brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.928, width: 0.6, height: 0.05 }, "inkSoft"),
    ...mark(parts, { x: M, y: 0.923, width: 0.13, height: 0.06 }),
  ];
  if (tabbed && parts.label) {
    els.push(
      block("tab", { x: M, y: 0.485, width: 0.46, height: 0.088 }, "accentDeep", { order: 15 }),
      eyebrow(parts.label, { x: M + 0.035, y: 0.5, width: 0.39, height: 0.06 }, "photoInk"),
    );
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Editorial — a picture and a headline sharing the page, the way a magazine
 * does it.
 *
 * The distinguishing move is that nothing is centred and nothing is a pill: a
 * short rule, a line of capitals, a headline set against a lot of white, and
 * the call to action as a plain line of type. It is the quietest of the photo
 * families, which is what makes it read as considered next to a hero shot.
 */
function editorial(parts: Parts): Built {
  const page = pageColour(parts);

  if (primary(parts)) {
    const els: CreativeElement[] = [
      ...panel(parts, 0, { x: 0, y: 0, width: 1, height: 0.54 }),
      block("rule", { x: M, y: 0.6, width: 0.13, height: 0.007 }, "accent"),
      text("headline", parts.headline, { x: M, y: 0.665, width: 1 - M * 2, height: 0.155 },
        headlineStyle(parts), { order: 30, colour: "ink" }),
      ...cta(parts, { x: M, y: 0.835, width: 0.62, height: 0.055 }, {
        ink: "ink",
        prefer: "underline",
      }),
      brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.9, width: 0.6, height: 0.05 }, "ink"),
      ...mark(parts, { x: M, y: 0.895, width: 0.13, height: 0.06 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: M, y: 0.618, width: 0.7, height: 0.038 }, "accent"));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // The picture takes the right of the page from top to bottom and the words
  // run down a column on the left, which forces a short headline into several
  // lines — the single most magazine-like thing type can do.
  //
  // A magazine column, though, not a gutter. At a third of the page a long
  // Malay sentence came back as five lines of two words, which stops reading
  // as a column and starts reading as a mistake; four-tenths sets the same
  // sentence in three or four lines and keeps the effect.
  // Two groups and one gap, not four things spread down a column. The rule,
  // the label and the headline hang together from the top; the invitation and
  // the signature sit together at the foot; all the air is in the one place
  // between them, where it reads as space rather than as a gap the layout
  // failed to fill.
  const quiet = ctaAbsent(parts, { x: M, y: 0.755, width: 0.38, height: 0.09 }, {
    ink: "inkSoft",
  });
  const els: CreativeElement[] = [
    ...panel(parts, 0, { x: 0.5, y: 0, width: 0.5, height: 1 }),
    block("rule", { x: M, y: 0.1, width: 0.11, height: 0.007 }, "accent"),
    text("headline", parts.headline, { x: M, y: 0.2, width: 0.4, height: 0.42 },
      headlineStyle(parts), { order: 30, colour: "ink" }),
    ...cta(parts, { x: M, y: 0.755, width: 0.38, height: 0.09 }, { ink: "inkSoft" }),
    brandLine(parts, { x: M, y: quiet ? 0.775 : 0.875, width: 0.38, height: 0.05 }, "ink"),
  ];
  if (parts.label) {
    els.push(eyebrow(parts.label, { x: M, y: 0.148, width: 0.4, height: 0.038 }, "accent"));
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Bold Typography — the sentence *is* the design.
 *
 * No photograph at all, so it is also part of what a restaurant with no
 * pictures gets. The two compositions differ in which way round the page runs:
 * words on the page with a colour block under them, or the whole page in
 * colour with the words on top.
 */
function boldType(parts: Parts): Built {

  if (primary(parts)) {
    const els: CreativeElement[] = [
      block("band", { x: 0, y: 0.62, width: 1, height: 0.38 }, "accent"),
      text("headline", parts.headline, { x: M, y: 0.13, width: 1 - M * 2, height: 0.42 },
        big(parts, 1.45), { order: 30, colour: "ink" }),
      ...cta(parts, { x: M, y: 0.72, width: 1 - M * 2, height: 0.08 }, {
        ink: "accentInk",
        ruleColour: "accentInk",
      }),
      brandLine(parts, { x: M, y: 0.87, width: 0.6, height: 0.05 }, "accentInk"),
      ...mark(parts, { x: 0.79, y: 0.85, width: 0.14, height: 0.08 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: M, y: 0.08, width: 0.7, height: 0.038 }, "accent"));
    }
    return { background: { kind: "solid", colour: pageColour(parts) }, elements: els };
  }

  const els: CreativeElement[] = [
    text("headline", parts.headline, { x: M, y: 0.18, width: 1 - M * 2, height: 0.46 },
      big(parts, 1.55), { order: 30, colour: "photoInk" }),
    block("rule", { x: M, y: 0.7, width: 0.16, height: 0.008 }, "photoInk"),
    ...cta(parts, { x: M, y: 0.75, width: 1 - M * 2, height: 0.08 }, {
      ink: "photoInk",
      ruleColour: "photoInk",
    }),
    brandLine(parts, { x: M, y: 0.88, width: 0.6, height: 0.05 }, "photoInk"),
  ];
  return {
    background: { kind: "solid", colour: accentField(parts.palette) },
    elements: els,
  };
}

/**
 * Food Close-up — cropped so far into the picture that the subject is texture.
 *
 * The crop is the whole idea: steam, char, the edge of a bowl. It is what turns
 * a fourth appearance of the same photograph into a post nobody recognises as a
 * repeat, and it is the family that most depends on `focalFor` going in close.
 */
function closeup(parts: Parts): Built {
  const t = parts.treatment;

  if (primary(parts)) {
    const els: CreativeElement[] = [
      ...panel(parts, 0, { x: 0, y: 0, width: 1, height: 0.74 }),
      block("band", { x: 0, y: 0.74, width: 1, height: 0.26 }, "accent"),
      text("headline", parts.headline, { x: M, y: 0.765, width: 1 - M * 2, height: 0.11 },
        big(parts, 0.85), { order: 30, colour: "accentInk" }),
      // One line, two columns: the call runs to 0.46 and the name starts at
      // 0.48. A call wide enough to reach under the name is a call printed
      // through it.
      ...cta(parts, { x: M, y: 0.885, width: 0.39, height: 0.06 }, {
        ink: "accentInk",
        ruleColour: "accentInk",
        prefer: "plain",
      }),
      brandLine(parts, { x: 0.48, y: 0.885, width: 1 - 0.48 - M, height: 0.06 }, "accentInk", "right"),
    ];
    return { background: { kind: "solid", colour: pageColour(parts) }, elements: els };
  }

  const els: CreativeElement[] = [
    ...panel(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.5, "top") }),
    text("headline", parts.headline, { x: M, y: 0.1, width: 1 - M * 2, height: 0.2 },
      headlineStyle(parts), { order: 30, colour: "photoInk" }),
    brandLine(parts, { x: M, y: 0.325, width: 0.6, height: 0.05 }, "photoInk"),
    ...cta(parts, ctaBox(t, 0.85), {
      ink: "photoInk",
      ruleColour: "photoInk",
      align: ctaAlign(t),
      onPhoto: true,
    }),
    ...mark(parts, { x: 0.79, y: 0.06, width: 0.14, height: 0.08 }),
  ];
  return { background: { kind: "solid", colour: pageColour(parts) }, elements: els };
}

/**
 * Split Composition — the page divided cleanly in two, picture against colour.
 *
 * The hard edge is the point. Every other photo family softens the join with a
 * wash or a margin; this one does not, which is why it reads as a different
 * poster rather than a rearranged one.
 *
 * Which way the page is cut is decided by the page, not by the treatment. A
 * column that takes 42% of the width is a comfortable measure on a square and
 * a gutter on a story: the same Malay sentence that sets in three lines on one
 * sets in six two-word lines on the other, and a headline broken that hard is
 * read as a mistake rather than as a design. So the vertical cut belongs to
 * the square, the horizontal band to the tall formats, and the treatment
 * varies the arrangement *within* the shape that suits it — which side the
 * picture takes on a square, which end it takes on a story.
 */
function split(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts);

  if (parts.format === "square" && primary(parts)) {
    // The field takes a little more than half. A column narrower than this
    // makes `autoFit` shrink a normal Malay sentence until the headline is
    // quieter than the photograph beside it, which inverts the layout.
    const els: CreativeElement[] = [
      block("field", { x: 0, y: 0, width: 0.54, height: 1 }, "accent"),
      ...panel(parts, 0, { x: 0.54, y: 0, width: 0.46, height: 1 }),
      text("headline", parts.headline, { x: 0.06, y: 0.28, width: 0.42, height: 0.32 },
        big(parts, 0.82), { order: 30, colour: "accentInk" }),
      ...cta(parts, { x: 0.06, y: 0.68, width: 0.42, height: 0.09 }, {
        ink: "accentInk",
        ruleColour: "accentInk",
      }),
      brandLine(parts, { x: 0.06, y: 0.86, width: 0.42, height: 0.05 }, "accentInk"),
      ...mark(parts, { x: 0.06, y: 0.09, width: 0.14, height: 0.08 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: 0.06, y: 0.225, width: 0.42, height: 0.038 }, "accentInk"));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // The band. On a square this is the alternate to the vertical cut; on a tall
  // page it is the only sensible cut, and the treatment decides which end the
  // picture takes instead.
  const photoTop = parts.format === "square" || primary(parts);
  const els: CreativeElement[] = photoTop
    ? [
        ...panel(parts, 0, { x: 0, y: 0, width: 1, height: 0.45 }),
        block("field", { x: 0, y: 0.45, width: 1, height: 0.55 }, "accent"),
        text("headline", parts.headline, { x: M, y: 0.56, width: 1 - M * 2, height: 0.2 },
          headlineStyle(parts), { order: 30, colour: "accentInk" }),
        ...cta(parts, ctaBox(t, 0.8), {
          ink: "accentInk",
          ruleColour: "accentInk",
          plate: "base",
          plateInk: "ink",
          align: ctaAlign(t),
        }),
        brandLine(parts, { x: M, y: 0.9, width: 0.6, height: 0.05 }, "accentInk"),
      ]
    : [
        block("field", { x: 0, y: 0, width: 1, height: 0.55 }, "accent"),
        ...panel(parts, 0, { x: 0, y: 0.55, width: 1, height: 0.45 }),
        text("headline", parts.headline, { x: M, y: 0.17, width: 1 - M * 2, height: 0.2 },
          headlineStyle(parts), { order: 30, colour: "accentInk" }),
        ...cta(parts, ctaBox(t, 0.41), {
          ink: "accentInk",
          ruleColour: "accentInk",
          plate: "base",
          plateInk: "ink",
          align: ctaAlign(t),
        }),
        brandLine(parts, { x: M, y: 0.07, width: 0.6, height: 0.05 }, "accentInk"),
      ];
  if (parts.label) {
    els.push(
      eyebrow(
        parts.label,
        { x: M, y: photoTop ? 0.51 : 0.12, width: 1 - M * 2, height: 0.038 },
        "accentInk",
      ),
    );
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Collage — three frames of the same restaurant on one page.
 *
 * With three photographs it is three photographs. With one it is three crops of
 * one, which is a normal thing for a designer to do and an honest one: every
 * frame is still the owner's own picture. `focalFor` gives each slot a
 * different crop for exactly this reason.
 */
function collage(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts);
  const r = 0.03;

  // A drawing in the smallest frame is the one thing this grid cannot hold. The
  // frame is cut to the artwork's own proportions — see `panel` — and a tall
  // drawing in a wide little slot comes out a sliver: on day 14 of the M6.5
  // acceptance pack the third frame was 0.15 of the page wide under a 0.368
  // frame, which reads as a mistake in the grid rather than as a third
  // picture. So when the last frame would hold a drawing, the collage is two
  // frames and the drawing sits out. Two pictures well placed beats three.
  const twoUp = drawingAt(parts, 2);

  if (primary(parts)) {
    const els: CreativeElement[] = [
      ...panel(parts, 0, { x: M, y: 0.09, width: 0.5, height: 0.44 }, { radius: r }),
      ...(twoUp
        ? panel(parts, 1, { x: 0.585, y: 0.09, width: 0.345, height: 0.44 }, { radius: r })
        : [
            ...panel(parts, 1, { x: 0.585, y: 0.09, width: 0.345, height: 0.21 }, { radius: r }),
            ...panel(parts, 2, { x: 0.585, y: 0.32, width: 0.345, height: 0.21 }, { radius: r }),
          ]),
      brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.025, width: 0.6, height: 0.05 }, "ink"),
      text("headline", parts.headline, { x: M, y: 0.615, width: 1 - M * 2, height: 0.17 },
        headlineStyle(parts), { order: 30, colour: "ink" }),
      ...cta(parts, ctaBox(t, 0.83), { ink: "ink", align: ctaAlign(t) }),
      ...mark(parts, { x: M, y: 0.02, width: 0.13, height: 0.06 }),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { x: M, y: 0.567, width: 1 - M * 2, height: 0.038 }, "accent"));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // The alternate is the same three pictures as a picture *spread*: edge to
  // edge, one dominant frame and two beside it, with the type on the page above
  // and below rather than around it.
  //
  // Three equal frames in a row — which is what this was — is not a collage.
  // It is a row of thumbnails, and it left a fifth of the page empty between
  // the last frame and the brand line, which is the specific thing that made
  // this the weakest poster in the M6.5 pack. Unequal frames and no outer
  // margin is what a magazine does with three pictures, and it uses the page.
  const top = 0.305;
  const tall = 0.415;
  const g = 0.012;
  const short = (tall - g) / 2;
  const foot = ctaAbsent(parts, ctaBox(t, 0.795), { ink: "ink", align: ctaAlign(t) })
    ? 0.80
    : 0.895;
  const els: CreativeElement[] = [
    text("headline", parts.headline, { x: M, y: 0.115, width: 1 - M * 2, height: 0.155 },
      headlineStyle(parts), { order: 30, colour: "ink" }),
    ...panel(parts, 0, { x: 0, y: top, width: 0.62, height: tall }),
    ...(twoUp
      ? panel(parts, 1, { x: 0.632, y: top, width: 0.368, height: tall })
      : [
          ...panel(parts, 1, { x: 0.632, y: top, width: 0.368, height: short }),
          ...panel(parts, 2, { x: 0.632, y: top + short + g, width: 0.368, height: short }),
        ]),
    ...cta(parts, ctaBox(t, 0.795), { ink: "ink", align: ctaAlign(t) }),
    brandLine(parts, { x: M, y: foot, width: 0.6, height: 0.05 }, "inkSoft"),
    ...mark(parts, { x: 0.79, y: foot - 0.015, width: 0.14, height: 0.08 }),
  ];
  if (parts.label) {
    els.push(eyebrow(parts.label, { x: M, y: 0.068, width: 1 - M * 2, height: 0.038 }, "accent"));
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Menu Feature — one dish, named, on a card.
 *
 * The only family where the *name of the dish* is the largest thing after the
 * headline, which is what makes it useful on a day the post is about one item.
 * The name is `dishInPost`, so it came off the owner's own menu and appears in
 * the caption as well; nothing here can put a dish on a poster that the
 * restaurant does not sell.
 */
function menuCard(parts: Parts): Built {

  if (primary(parts)) {
    const els: CreativeElement[] = [
      ...panel(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.4, "full") }),
      block("card", { x: 0.1, y: 0.23, width: 0.8, height: 0.54 }, "base", { radius: 0.05, order: 10 }),
      text("headline", parts.headline, { x: 0.16, y: 0.345, width: 0.68, height: 0.2 },
        big(parts, 0.9),
        { order: 30, colour: "ink", align: "center" }),
      block("rule", { x: 0.44, y: 0.585, width: 0.12, height: 0.006 }, "accent", { order: 30 }),
      ...cta(parts, { x: 0.24, y: 0.63, width: 0.52, height: 0.07 }, {
        ink: "ink",
        align: "center",
      }),
      brandLine(parts, { x: 0.15, y: 0.715, width: 0.7, height: 0.045 }, "inkSoft", "center"),
    ];
    els.push(
      eyebrow(parts.label ?? parts.brand, { x: 0.15, y: 0.285, width: 0.7, height: 0.04 }, "accent", "center"),
    );
    return { background: { kind: "solid", colour: pageColour(parts) }, elements: els };
  }

  const els: CreativeElement[] = [
    ...panel(parts, 0, { x: 0, y: 0, width: 0.42, height: 1 }),
    block("card", { x: 0.46, y: 0.12, width: 0.47, height: 0.76 }, "surface", { radius: 0.05, order: 10 }),
    text("headline", parts.headline, { x: 0.5, y: 0.26, width: 0.39, height: 0.26 },
      big(parts, 0.85), { order: 30, colour: "ink" }),
    block("rule", { x: 0.5, y: 0.56, width: 0.1, height: 0.006 }, "accent", { order: 30 }),
    ...cta(parts, { x: 0.5, y: 0.62, width: 0.39, height: 0.07 }, { ink: "ink" }),
    brandLine(parts, { x: 0.5, y: 0.775, width: 0.39, height: 0.05 }, "inkSoft"),
  ];
  els.push(eyebrow(parts.label ?? parts.brand, { x: 0.5, y: 0.2, width: 0.39, height: 0.04 }, "accent"));
  return {
    background: { kind: "solid", colour: pageColour(parts) },
    elements: els,
  };
}

/**
 * Question — one question, set large enough that answering it is the obvious
 * thing to do.
 *
 * Photograph-free and centred, which is the opposite of every other family
 * here. On an engagement day that difference is the post: a picture of food
 * would compete with the question, and the question is the point.
 */
function question(parts: Parts): Built {

  if (primary(parts)) {
    // The signature goes at the top and the invitation at the bottom, with the
    // question between them. Stacking all three low left the upper third of a
    // portrait page completely empty — a poster's worth of colour and nothing
    // in it — and made the question look as though it had slid down the page.
    const silent = ctaAbsent(parts, { x: 0.14, y: 0.775, width: 0.72, height: 0.08 }, {
      ink: "photoInk",
      ruleColour: "photoInk",
      align: "center",
    });
    const els: CreativeElement[] = [
      // The signature holds whichever end the invitation does not. Put both at
      // the foot and the top of the page is empty; put both at the top and the
      // foot is. A centred poster wants weight at each end and the question in
      // the middle.
      brandLine(parts,
        { x: 0.14, y: silent ? 0.875 : 0.085, width: 0.72, height: 0.05 },
        "photoInk", "center", true),
      text("headline", parts.headline,
        { x: 0.11, y: silent ? 0.18 : 0.24, width: 0.78, height: silent ? 0.6 : 0.42 },
        big(parts, 1.2),
        { order: 30, colour: "photoInk", align: "center", valign: "middle" }),
      ...cta(parts, { x: 0.14, y: 0.775, width: 0.72, height: 0.08 }, {
        ink: "photoInk",
        ruleColour: "photoInk",
        align: "center",
      }),
    ];
    return {
      background: { kind: "solid", colour: accentField(parts.palette) },
      elements: els,
    };
  }

  // A drawn frame, four rules inset from the edge. Cheap, and it turns a page
  // of type into something that looks placed rather than left over.
  const i = 0.045;
  const w = 0.008;
  // With no invitation to make room for, the question moves to the middle of
  // its frame rather than sitting in the top half of an empty box.
  const quiet = ctaAbsent(parts, { x: 0.24, y: 0.755, width: 0.52, height: 0.07 }, {
    ink: "ink",
    align: "center",
  });
  const els: CreativeElement[] = [
    block("frame-top", { x: i, y: i, width: 1 - i * 2, height: w }, "accent"),
    block("frame-bottom", { x: i, y: 1 - i - w, width: 1 - i * 2, height: w }, "accent"),
    block("frame-left", { x: i, y: i, width: w, height: 1 - i * 2 }, "accent"),
    block("frame-right", { x: 1 - i - w, y: i, width: w, height: 1 - i * 2 }, "accent"),
    brandLine(parts,
      { x: 0.14, y: quiet ? 0.855 : 0.115, width: 0.72, height: 0.05 },
      "inkSoft", "center", true),
    text("headline", parts.headline,
      { x: 0.14, y: quiet ? 0.19 : 0.26, width: 0.72, height: quiet ? 0.58 : 0.4 },
      big(parts, 1.1),
      { order: 30, colour: "ink", align: "center", valign: "middle" }),
    ...cta(parts, { x: 0.24, y: 0.755, width: 0.52, height: 0.07 }, {
      ink: "ink",
      align: "center",
    }),
  ];
  return {
    background: { kind: "solid", colour: pageColour(parts) },
    elements: els,
  };
}

/**
 * Minimal — one small picture and a great deal of air.
 *
 * The restraint is the design. It is also the family that flatters an
 * indifferent photograph most, because a small picture with space around it
 * asks far less of the picture than a full-bleed one does — which matters when
 * the photographs came off a phone in a busy kitchen.
 */
function minimal(parts: Parts): Built {
  const page = pageColour(parts);
  const style: TextStyle = { ...big(parts, 0.78), lineHeight: 1.3 };
  // A mounted drawing is *placed*: a photograph has a crop, so the same plate
  // twice is two pictures, but the same drawing twice is the same drawing, and
  // the only honest way to make the second page a different page is to hang it
  // somewhere else and range the type to match. See `chooseCardPlacement` —
  // days 3 and 13, and days 6 and 16, of the acceptance pack were each one
  // poster printed twice before this.
  const drawing = drawingAt(parts, 0);
  const place = drawing ? chooseCardPlacement(parts.day) : "centre";
  const ranged: TextElement["align"] =
    place === "left" ? "left" : place === "right" ? "right" : "center";
  const column = place === "centre" ? { x: 0.15, width: 0.7 } : { x: M, width: 1 - M * 2 };

  if (primary(parts)) {
    // The photograph has to be the largest thing on the page. Restraint here
    // means one picture and a lot of margin — a small picture in the middle of
    // a cream field is not restraint, it is a poster that did not finish.
    // Centred type stacked three deep is only calm if the stack is spaced.
    // The M6.5 first pass had the hook ending at 0.855, the invitation at 0.87
    // and the name at 0.925 — three lines separated by about fifteen pixels
    // each, which sets as one grey block under a lot of empty page and is the
    // opposite of what the layout is for. The picture comes up, the hook
    // follows it closely enough to belong to it, and the invitation and the
    // name sit apart at the foot as their own group.
    const els: CreativeElement[] = [
      ...panel(parts, 0, { x: 0.12, y: 0.09, width: 0.76, height: 0.51 }),
      text("headline", parts.headline,
        place === "centre"
          ? { x: 0.13, y: 0.675, width: 0.74, height: 0.15 }
          : { ...column, y: 0.675, height: 0.15 },
        style, { order: 30, colour: "ink", align: ranged }),
      ...cta(parts, { ...column, y: 0.855, height: 0.05 }, {
        ink: "inkSoft",
        align: ranged,
        prefer: "plain",
      }),
      brandLine(parts, { ...column, y: 0.928, height: 0.045 }, "ink", ranged, true),
    ];
    if (parts.label) {
      els.push(eyebrow(parts.label, { ...column, y: 0.632, height: 0.038 }, "accent", ranged));
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // A photograph fills the band edge to edge, so a third of the page deep is
  // plenty. A drawing does not: `panel` cuts it to its own proportions, and a
  // tall drawing cut into a letterbox comes back as a stamp marooned in a
  // cream field — which is the exact failure the primary's own comment warns
  // about, arrived at from the other side. So a drawing is given a deeper band
  // to be tall in, and the foot of the page moves down to pay for it.
  //
  const band = drawing
    ? { x: 0, y: 0.29, width: 1, height: 0.43 }
    : { x: 0, y: 0.31, width: 1, height: 0.34 };
  const foot = drawing ? 0.035 : 0;

  const els: CreativeElement[] = [
    text("headline", parts.headline, { ...column, y: 0.1, height: 0.15 },
      style, { order: 30, colour: "ink", align: ranged }),
    ...panel(parts, 0, band),
    ...cta(parts, { ...column, y: 0.75 + foot, height: 0.06 }, {
      ink: "inkSoft",
      align: ranged,
    }),
    brandLine(parts, { ...column, y: 0.87 + foot, height: 0.045 }, "ink", ranged, true),
  ];
  if (parts.label) {
    els.push(
      eyebrow(parts.label, { ...column, y: 0.7 + foot, height: 0.038 }, "accent", ranged),
    );
  }
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Community — the post that is about where the restaurant is.
 *
 * The eyebrow is the town rather than a dish, because that is the subject. It
 * falls back to the dish when the owner never told us where they are, and to
 * nothing when there is neither: an invented neighbourhood is the same class of
 * mistake as an invented price.
 */
function local(parts: Parts): Built {
  const t = parts.treatment;
  const page = pageColour(parts);
  const where = parts.location.trim() || parts.label;

  if (primary(parts)) {
    const els: CreativeElement[] = [
      ...panel(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.55) }),
      text("headline", parts.headline, { x: M, y: 0.6, width: 1 - M * 2, height: 0.19 },
        headlineStyle(parts), { order: 30, colour: "photoInk", valign: "bottom" }),
      brandLine(parts, { x: M, y: 0.805, width: 0.6, height: 0.05 }, "photoInk"),
      ...cta(parts, ctaBox(t, 0.875), {
        ink: "photoInk",
        ruleColour: "photoInk",
        align: ctaAlign(t),
        onPhoto: true,
      }),
    ];
    if (where) {
      // A short rule and the name of the town, not a badge. The M6 version put
      // this in a pill sized for one line and a real Malaysian address —
      // "Kampung Baru, Kuala Lumpur" — wrapped inside it, which is the same
      // class of mistake as a call to action that wraps inside its button.
      // Type against a rule has no width to run out of.
      els.push(
        block("place-rule", { x: M, y: 0.062, width: 0.05, height: 0.006 }, "accent", {
          order: 25,
        }),
        text("subheading", where, { x: M, y: 0.082, width: 1 - M * 2, height: 0.05 }, LABEL_STYLE, {
          order: 25,
          colour: "photoInk",
          valign: "middle",
        }),
      );
    }
    return { background: { kind: "solid", colour: page }, elements: els };
  }

  // A postcard: the town at the top, the picture across the middle, the
  // sentence underneath. Centred, because this is the family about belonging
  // somewhere and every other photo family on the wheel is set left.
  const els: CreativeElement[] = [
    block("field", { x: 0, y: 0, width: 1, height: 0.2 }, "accent"),
    ...panel(parts, 0, { x: 0.07, y: 0.235, width: 0.86, height: 0.4 }, { radius: 0.03 }),
    text("headline", parts.headline, { x: 0.1, y: 0.685, width: 0.8, height: 0.14 },
      big(parts, 0.85), { order: 30, colour: "ink", align: "center" }),
    // Five thousandths of the page between the call and the signature is not a
    // gap, it is a collision that missed: on day 19 of the acceptance pack the
    // pill and "Nasi Lemak Mak Yah" read as one lump of furniture at the foot
    // of an otherwise quiet postcard. Two and a half hundredths is enough for
    // the eye to see two things.
    ...cta(parts, { x: 0.12, y: 0.838, width: 0.76, height: 0.055 }, {
      ink: "inkSoft",
      align: "center",
    }),
    brandLine(parts, { x: 0.12, y: 0.918, width: 0.76, height: 0.05 }, "ink", "center"),
  ];
  // The town if we were told one, the restaurant's own name if we were not.
  // Never an invented neighbourhood, and never an empty band.
  els.push(
    eyebrow(where || parts.brand, { x: 0.1, y: 0.085, width: 0.8, height: 0.055 }, "accentInk", "center"),
  );
  return { background: { kind: "solid", colour: page }, elements: els };
}

/**
 * Festive — the day the Malaysia calendar claimed.
 *
 * The one rule that matters here is that it still has to look like this
 * restaurant. A festive post rendered in gold and green with a generic greeting
 * is a poster from a template site; the owner's palette, the owner's type and
 * the owner's photograph, with the occasion named, is a post from their shop.
 *
 * The occasion is named by `lib/calendar`, which holds gazetted dates as
 * literals — so the greeting is never a date the model remembered.
 */
function festive(parts: Parts): Built {
  const name = parts.occasion ?? parts.label;

  if (primary(parts)) {
    // A deep brand field down the top two-fifths with the occasion named on
    // it, the photograph hung across the join, and the greeting set below on
    // the page. The M6 version was a thin accent rule at the very top and
    // another at the very bottom, which is the composition of a certificate —
    // and a festive post that looks like a certificate is a post an owner
    // scrolls past in their own gallery. No flags, no gold, no lanterns:
    // restraint is what stops it looking like a template site's Raya card.
    const els: CreativeElement[] = [
      block("field", { x: 0, y: 0, width: 1, height: 0.38 }, "accentDeep"),
      ...panel(parts, 0, { x: M, y: 0.24, width: 1 - M * 2, height: 0.36 }, { radius: 0.02, order: 10 }),
      text("headline", parts.headline, { x: 0.1, y: 0.68, width: 0.8, height: 0.16 },
        big(parts, 0.92), { order: 30, colour: "ink" }),
      // Ends before the name begins at 0.55. See `closeup`.
      ...cta(parts, { x: M, y: 0.865, width: 0.46, height: 0.06 }, {
        ink: "ink",
        prefer: "underline",
      }),
      brandLine(parts, { x: 0.55, y: 0.865, width: 1 - 0.55 - M, height: 0.06 }, "inkSoft", "right"),
    ];
    if (name) {
      els.push(eyebrow(name, { x: M, y: 0.085, width: 0.78, height: 0.05 }, "photoInk"));
    }
    return {
      background: { kind: "solid", colour: pageColour(parts) },
      elements: els,
    };
  }

  const els: CreativeElement[] = [
    ...panel(parts, 0, { x: 0, y: 0, width: 1, height: 1 }, { scrim: wash(0.6) }),
    text("headline", parts.headline, { x: 0.11, y: 0.6, width: 0.78, height: 0.19 },
      big(parts, 0.95),
      { order: 30, colour: "photoInk", align: "center", valign: "bottom" }),
    ...cta(parts, { x: 0.24, y: 0.845, width: 0.52, height: 0.07 }, {
      ink: "photoInk",
      ruleColour: "photoInk",
      align: "center",
      onPhoto: true,
    }),
    brandLine(parts, { x: 0.15, y: 0.925, width: 0.7, height: 0.045 }, "photoInk", "center"),
  ];
  if (name) {
    els.push(eyebrow(name, { x: 0.11, y: 0.545, width: 0.78, height: 0.04 }, "photoInk", "center"));
  }
  return { background: { kind: "solid", colour: pageColour(parts) }, elements: els };
}

/**
 * Storytelling — type first, with a picture below it the owner can swap.
 *
 * The variant swaps the order of the two blocks: picture over words, or words
 * over picture. Both keep the CTA on the same line at the foot of the page, so
 * a month of these still reads as one set rather than as thirty one-offs.
 */
function typePoster(parts: Parts): Built {
  const t = parts.treatment;
  const wordsFirst = !primary(parts);

  const photoY = wordsFirst ? 0.47 : 0.17;
  const labelY = wordsFirst ? 0.185 : 0.53;
  const headlineY = wordsFirst ? 0.23 : 0.575;

  const els: CreativeElement[] = [
    // A rule in the brand colour along the top. One decisive piece of brand
    // that costs nothing and does not depend on the owner having uploaded
    // anything at all.
    block("rule", { x: 0, y: 0, width: 1, height: 0.014 }, "accent"),
    ...panel(parts, 0, { x: M, y: photoY, width: 1 - M * 2, height: 0.34 }, { radius: 0.06, order: 10 }),
    text("headline", parts.headline, { x: M, y: headlineY, width: 1 - M * 2, height: 0.21 },
      headlineStyle(parts), { order: 30, colour: "ink" }),
    ...cta(parts, ctaBox(t, 0.845), { ink: "ink", align: ctaAlign(t) }),
    brandLine(parts, { x: parts.logo ? 0.24 : M, y: 0.055, width: 0.6, height: 0.08 }, "ink"),
    ...mark(parts, { x: M, y: 0.055, width: 0.14, height: 0.08 }),
  ];

  if (parts.label) {
    els.push(eyebrow(parts.label, { x: M, y: labelY, width: 1 - M * 2, height: 0.04 }, "accent"));
  }

  return {
    background: { kind: "solid", colour: pageColour(parts) },
    elements: els,
  };
}

/**
 * Brand Statement — a full-bleed colour field with the hook set large.
 *
 * Also what WhatsApp Status always gets, because a Status is glanced at on a
 * phone held at arm's length and is one message rather than a designed page.
 * No image slot: a photo the owner has not supplied would be the only thing on
 * it that was not theirs.
 *
 * The variant lifts the block and puts the CTA on a pale plate instead of
 * leaving it as plain type. The field stays the same colour either way — it is
 * the one derived to carry white type, and swapping it for a lighter one to be
 * different would be trading readability for variety.
 */
function textFirst(parts: Parts): Built {
  const field = accentField(parts.palette);
  const lifted = !primary(parts);
  const headlineY = lifted ? 0.24 : 0.3;

  const els: CreativeElement[] = [
    text("headline", parts.headline, { x: 0.1, y: headlineY, width: 0.8, height: 0.3 },
      big(parts, 1.05),
      { order: 30, colour: "photoInk", align: "center", valign: "middle" }),
    brandLine(parts, { x: 0.1, y: 0.84, width: 0.8, height: 0.05 }, "photoInk", "center"),
    ...cta(
      parts,
      lifted
        ? { x: 0.19, y: 0.58, width: 0.62, height: 0.07 }
        : { x: 0.12, y: 0.63, width: 0.76, height: 0.08 },
      {
        ink: "photoInk",
        ruleColour: "photoInk",
        align: "center",
        plate: "base",
        plateInk: "ink",
      },
    ),
    ...mark(parts, { x: 0.43, y: 0.75, width: 0.14, height: 0.06 }),
  ];

  if (parts.label) {
    els.push(
      eyebrow(parts.label, { x: 0.1, y: headlineY - 0.065, width: 0.8, height: 0.04 }, "photoInk", "center"),
    );
  }

  return { background: { kind: "solid", colour: field }, elements: els };
}

/** Every family, by the id the creative is stored under. */
const LAYOUTS: Record<TemplateId, (parts: Parts) => Built> = {
  "photo-band": productHero,
  "type-poster": typePoster,
  "text-first": textFirst,
  editorial,
  "bold-type": boldType,
  closeup,
  split,
  collage,
  "menu-card": menuCard,
  question,
  minimal,
  local,
  festive,
};


/* --------------------------------- compose -------------------------------- */

export interface ComposeOptions {
  /**
   * The photographs to build around, when there are any.
   *
   * A collage day asks for three and every other photo family asks for one —
   * see `photosWanted`. Handed fewer than it asked for, a layout draws the
   * slots it can fill and leaves the rest empty rather than inventing filler.
   */
  images?: readonly AssetRef[];
  /**
   * The photograph to build around, when there is one.
   *
   * Absent, the creative starts with an empty slot and a typographic layout.
   * That is the deliberate answer to "what if the restaurant has no photo":
   * the alternative is a stock picture of somebody else's nasi lemak presented
   * as theirs, which is the image equivalent of an invented opening hour.
   *
   * The logo is not promoted into this slot — a logo is not a food photograph —
   * and neither is the menu upload, which is usually a PDF and, when it is a
   * photograph, is a photograph of a menu: legible at A4, illegible behind a
   * headline.
   */
  image?: AssetRef | null;
  now?: string;
}

/**
 * A short digest of the copy a design was composed from.
 *
 * Stored on the creative so a poster can be asked, later, whether it still
 * belongs to the day it came from. Regenerating a day rewrites the words but
 * leaves the saved design where it was, and a gallery of posters quietly
 * disagreeing with their own captions is worse than either version alone —
 * the owner has to read all thirty to find out which ones lie.
 *
 * Only the fields composition actually reads go in. The caption is one of
 * them: it is not printed on the poster, but `dishInPost` searches it to work
 * out which dish a day is about, and that decides the poster's label.
 *
 * FNV-1a, because this is a change detector and not a security boundary. It
 * has to be stable across builds and machines, which rules out object
 * identity, and cheap enough to run on thirty days in a render, which rules
 * out anything asynchronous.
 */
export function contentFingerprint(item: ContentItem): string {
  const parts = [
    String(item.day),
    item.category,
    item.platform,
    item.hook,
    item.caption,
    item.cta,
    item.visualIdea,
    item.occasion
      ? `${item.occasion.kind}:${item.occasion.role}:${item.occasion.name}`
      : "",
  ].join("\u0000");

  let hash = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * One content day in, one creative out. Pure: same inputs, same creative.
 */
export function composeCreative(
  profile: RestaurantProfile,
  planId: string,
  item: ContentItem,
  options: ComposeOptions = {},
): Creative {
  // Photographs first: see `orderImages`. Done before anything reads
  // `images[0]`, because the lead picture is what decides the family.
  const images = orderImages(
    options.images ?? (options.image ? [options.image] : []),
    signatureOf,
  );
  const now = options.now ?? new Date().toISOString();
  const format = formatFor(item);
  // Whether the *restaurant* has photographs, not whether this day was dealt
  // one. A day whose family wants none — the typographic families ask for zero
  // — must still be recognised as belonging to a restaurant that has pictures,
  // or the composer falls through to the no-photo path and hands back a
  // different layout from the one the pack builder dealt against.
  const family = familyFor(
    item,
    images.length > 0 || profile.photos.length > 0,
  );
  // What `photo.ts` read off this day's first picture at upload, or null for a
  // photograph that predates M6.5. Null is the honest answer everywhere it
  // appears: every function that consults it has a defined behaviour for "we
  // do not know", and that behaviour is what M6 did.
  const signature = signatureOf(images[0] ?? null);
  // A drawing cannot be the page. See `redirectForGraphic`.
  const template = redirectForGraphic(family, signature, item.day, item.hook);
  const treatment = treatmentFor(item);
  const arrangement = chooseComposition({
    day: item.day,
    family: template,
    format,
    headline: headlineFrom(item.hook),
    signature,
    photos: images.length,
    fallback: treatment.alternate,
  });
  const keepClear = keepClearFor(template, arrangement);
  const palette = buildPalette({
    brandColours: profile.brandColours,
    visualStyle: profile.visualStyle,
  });
  const dish = labelForPhoto(
    dishInPost(item, profile.bestSellers),
    images[0]?.name ?? null,
    profile.bestSellers,
  );

  const parts: Parts = {
    // The hook is the headline. It was written to stop a scroll, which is the
    // same job a headline has, and it has already been through the validator.
    // See `headlineFrom` for the one mark that does not survive the move.
    headline: headlineFrom(item.hook),
    label: dish,
    cta: item.cta.trim(),
    brand: profile.name.trim(),
    logo: profile.logo,
    images,
    focals: images.map((image, slot) =>
      focalFor(item, slot, signatureOf(image), keepClear),
    ),
    occasion: item.occasion?.name ?? null,
    day: item.day,
    signature,
    arrangement,
    ground: chooseGround(item.day),
    location: profile.location,
    tone: profile.tone,
    palette,
    // Derived from the day rather than passed in, so the studio and the pack
    // generator compose the same poster for the same day. If this were an
    // option, "Kembali ke asal" could quietly hand the owner a different
    // layout from the one they had.
    treatment,
    format,
  };

  const built = LAYOUTS[template](parts);

  return {
    id: item.id,
    planId,
    itemId: item.id,
    day: item.day,
    name: defaultName(item, dish),
    template,
    platform: item.platform satisfies Platform,
    format,
    canvas: CANVAS[format],
    palette,
    background: built.background,
    elements: built.elements,
    generatorVersion: CREATIVE_VERSION,
    source: contentFingerprint(item),
    createdAt: now,
    updatedAt: now,
    edited: false,
  };
}
