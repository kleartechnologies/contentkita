import { parseHex } from "./palette.ts";
import { blockTop, fitText, lineX, type Measure } from "./text.ts";
import {
  ordered,
  type Box,
  type Creative,
  type CreativeElement,
  type FontFamily,
  type ImageElement,
  type LogoElement,
  type Palette,
  type ShapeElement,
  type TextElement,
  type TextStyle,
} from "./types.ts";

/**
 * Drawing a creative onto a 2D canvas.
 *
 * One renderer, used for both the preview on screen and the PNG the owner
 * downloads. The preview is the same function at a smaller scale, so what they
 * see is what they get — not because the two were kept in step by hand, but
 * because there is only one of them.
 *
 * The context is typed as `Painter`, a narrow structural subset of
 * `CanvasRenderingContext2D` rather than the DOM type itself. A real context
 * satisfies it, and a recording stub in a unit test satisfies it too, so layout
 * can be asserted in Node without a browser or a headless canvas.
 */

/* ---------------------------------- ports --------------------------------- */

/** The parts of a 2D context this renderer uses. Nothing else. */
export interface Painter {
  save(): void;
  restore(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  closePath(): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { addColorStop(offset: number, colour: string): void };
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  letterSpacing?: string;
}

/** A decoded image, with the intrinsic size needed to compute a cover crop. */
export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** Keyed by `AssetRef.path`, which is the stable identity of an upload. */
export type ImageBank = Record<string, LoadedImage | undefined>;

export interface Fonts {
  display: string;
  body: string;
}

/**
 * The system stack, used when the caller does not supply one.
 *
 * In the browser the caller passes the app's own resolved family, so an
 * exported poster is set in the same typeface as the product. In a test there
 * is no font at all and only the measurements matter.
 */
export const SYSTEM_FONTS: Fonts = {
  display:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

export interface RenderOptions {
  images?: ImageBank;
  fonts?: Fonts;
  /**
   * Multiplier on the creative's own canvas size. `1` renders at full
   * resolution, which is what an export wants; the preview passes the ratio
   * that fits its element.
   */
  scale?: number;
  /** Draw empty image slots as slots. Off for export: see `drawImage`. */
  showPlaceholders?: boolean;
}

/* -------------------------------- geometry -------------------------------- */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A fractional box resolved against the scaled canvas. */
function rectOf(box: Box, width: number, height: number): Rect {
  return {
    x: box.x * width,
    y: box.y * height,
    w: box.width * width,
    h: box.height * height,
  };
}

function roundedPath(p: Painter, r: Rect, radius: number): void {
  const limit = Math.min(radius, r.w / 2, r.h / 2);
  p.beginPath();
  if (limit <= 0) {
    p.rect(r.x, r.y, r.w, r.h);
    return;
  }
  p.moveTo(r.x + limit, r.y);
  p.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, limit);
  p.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, limit);
  p.arcTo(r.x, r.y + r.h, r.x, r.y, limit);
  p.arcTo(r.x, r.y, r.x + r.w, r.y, limit);
  p.closePath();
}

/** `#rrggbb` plus an alpha, as a colour a canvas accepts. */
function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * The source rectangle that fills `target` without distorting the image.
 *
 * `cover` crops the long side and centres what is left — never squashes. A
 * stretched plate of food is the single most obvious sign of an automated
 * poster.
 */
export function coverCrop(
  source: { width: number; height: number },
  target: { w: number; h: number },
): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(target.w / source.width, target.h / source.height);
  const sw = target.w / scale;
  const sh = target.h / scale;
  return {
    sx: (source.width - sw) / 2,
    sy: (source.height - sh) / 2,
    sw,
    sh,
  };
}

/** The destination rectangle that fits the whole image inside `target`. */
export function containBox(
  source: { width: number; height: number },
  target: Rect,
): Rect {
  const scale = Math.min(target.w / source.width, target.h / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  return { x: target.x + (target.w - w) / 2, y: target.y + (target.h - h) / 2, w, h };
}

/* ------------------------------- typography ------------------------------- */

function fontString(style: TextStyle, px: number, fonts: Fonts): string {
  const family: FontFamily = style.family;
  return `${style.weight} ${px}px ${fonts[family]}`;
}

function transformed(text: string, style: TextStyle): string {
  return style.transform === "uppercase" ? text.toLocaleUpperCase("ms-MY") : text;
}

/* -------------------------------- elements -------------------------------- */

function paintShape(p: Painter, el: ShapeElement, rect: Rect, palette: Palette): void {
  p.save();
  p.globalAlpha = el.opacity;
  p.fillStyle = palette[el.fill];
  roundedPath(p, rect, el.radius * Math.min(rect.w, rect.h));
  p.fill();
  p.restore();
}

/**
 * A photo, or an honest empty slot.
 *
 * The slot is drawn as a dashed outline with a label, and it is drawn *only*
 * in the editor — `showPlaceholders` is false when exporting, so a downloaded
 * poster never carries an instruction to the owner as if it were design. What
 * it must never be is a stand-in photograph: this is the point in the pipeline
 * where a stock picture of somebody else's food would enter the product, so
 * there is nothing here that could put one in.
 */
function paintImage(
  p: Painter,
  el: ImageElement,
  rect: Rect,
  palette: Palette,
  options: Required<Pick<RenderOptions, "images" | "fonts" | "showPlaceholders">>,
  scaleW: number,
): void {
  const radius = el.radius * Math.min(rect.w, rect.h);
  const loaded = el.source ? options.images[el.source.path] : undefined;

  if (loaded) {
    p.save();
    roundedPath(p, rect, radius);
    p.clip();
    if (el.fit === "cover") {
      const crop = coverCrop(loaded, rect);
      p.drawImage(
        loaded.source,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
      );
    } else {
      const box = containBox(loaded, rect);
      p.drawImage(
        loaded.source,
        0,
        0,
        loaded.width,
        loaded.height,
        box.x,
        box.y,
        box.w,
        box.h,
      );
    }
    p.restore();
  } else {
    p.save();
    p.fillStyle = palette.surface;
    roundedPath(p, rect, radius);
    p.fill();
    if (options.showPlaceholders) {
      p.strokeStyle = withAlpha(palette.inkSoft, 0.5);
      p.lineWidth = Math.max(2, scaleW * 0.004);
      p.setLineDash([scaleW * 0.02, scaleW * 0.015]);
      roundedPath(p, rect, radius);
      p.stroke();
      p.setLineDash([]);

      const px = scaleW * 0.026;
      p.font = `600 ${px}px ${options.fonts.body}`;
      p.fillStyle = palette.inkSoft;
      p.textAlign = "center";
      p.textBaseline = "middle";
      p.fillText(el.placeholder, rect.x + rect.w / 2, rect.y + rect.h / 2);
    }
    p.restore();
  }

  if (el.scrim) {
    p.save();
    const gradient = p.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
    // Transparent across the top third so the food is still the picture, then
    // deepening into the band the type sits on.
    gradient.addColorStop(0, withAlpha(palette[el.scrim.colour], 0));
    gradient.addColorStop(0.42, withAlpha(palette[el.scrim.colour], el.scrim.opacity * 0.35));
    gradient.addColorStop(1, withAlpha(palette[el.scrim.colour], Math.min(el.scrim.opacity + 0.35, 1)));
    p.fillStyle = gradient as unknown as CanvasGradient;
    roundedPath(p, rect, radius);
    p.fill();
    p.restore();
  }
}

function paintLogo(
  p: Painter,
  el: LogoElement,
  rect: Rect,
  images: ImageBank,
): void {
  const loaded = el.source ? images[el.source.path] : undefined;
  // No logo, no box. An empty rectangle where a logo should be is worse than
  // the type-only layout the rest of the template already handles.
  if (!loaded) return;
  const box = containBox(loaded, rect);
  p.save();
  p.drawImage(
    loaded.source,
    0,
    0,
    loaded.width,
    loaded.height,
    box.x,
    box.y,
    box.w,
    box.h,
  );
  p.restore();
}

function paintText(
  p: Painter,
  el: TextElement,
  rect: Rect,
  palette: Palette,
  fonts: Fonts,
  scaleW: number,
): void {
  const value = transformed(el.text, el.style);
  if (!value.trim()) return;

  const startPx = el.style.size * scaleW;
  const spacingPx = el.style.letterSpacing * startPx;
  const plate = el.plate;
  const padding = plate ? plate.padding * scaleW : 0;
  const inner = {
    x: rect.x + padding,
    y: rect.y,
    w: Math.max(rect.w - padding * 2, 1),
    h: rect.h,
  };

  p.save();
  if (el.style.letterSpacing !== 0) p.letterSpacing = `${spacingPx}px`;

  const measure: Measure = (t, px) => {
    p.font = fontString(el.style, px, fonts);
    return p.measureText(t).width;
  };

  const fitted = fitText({
    text: value,
    width: inner.w,
    height: inner.h,
    fontPx: startPx,
    lineHeight: el.style.lineHeight,
    autoFit: el.autoFit,
    measure,
  });

  if (plate) {
    // The pill hugs the text rather than filling the declared box, so a short
    // CTA does not get a button half the width of the poster.
    const widest = Math.max(
      ...fitted.lines.map((line) => measure(line, fitted.fontPx)),
      1,
    );
    const plateRect: Rect = {
      x: rect.x,
      y: rect.y,
      w: Math.min(widest + padding * 2, rect.w),
      h: rect.h,
    };
    if (el.align === "center") plateRect.x = rect.x + (rect.w - plateRect.w) / 2;
    if (el.align === "right") plateRect.x = rect.x + rect.w - plateRect.w;
    p.fillStyle = palette[plate.colour];
    roundedPath(p, plateRect, plate.radius * Math.min(plateRect.w, plateRect.h));
    p.fill();
    inner.x = plateRect.x + padding;
    inner.w = plateRect.w - padding * 2;
  }

  p.font = fontString(el.style, fitted.fontPx, fonts);
  p.fillStyle = palette[el.colour];
  p.textAlign = el.align;
  p.textBaseline = "top";

  const top = blockTop(inner.y, inner.h, fitted.height, el.valign);
  const x = lineX(inner.x, inner.w, el.align);
  // The gap between the em box top and the glyphs; without it a line sits
  // visibly high inside its own leading.
  const lead = (fitted.lineHeightPx - fitted.fontPx) / 2;

  fitted.lines.forEach((line, i) => {
    p.fillText(line, x, top + lead + i * fitted.lineHeightPx);
  });

  p.restore();
}

/* --------------------------------- render --------------------------------- */

function paintBackground(p: Painter, creative: Creative, w: number, h: number): void {
  const bg = creative.background;
  p.save();
  if (bg.kind === "solid") {
    p.fillStyle = bg.colour;
  } else {
    const radians = (bg.angle * Math.PI) / 180;
    const gradient = p.createLinearGradient(
      w / 2 - (Math.sin(radians) * w) / 2,
      h / 2 - (Math.cos(radians) * h) / 2,
      w / 2 + (Math.sin(radians) * w) / 2,
      h / 2 + (Math.cos(radians) * h) / 2,
    );
    gradient.addColorStop(0, bg.from);
    gradient.addColorStop(1, bg.to);
    p.fillStyle = gradient as unknown as CanvasGradient;
  }
  p.fillRect(0, 0, w, h);
  p.restore();
}

/**
 * Draws the whole creative. The canvas is assumed to already be the right size.
 */
export function drawCreative(
  p: Painter,
  creative: Creative,
  options: RenderOptions = {},
): void {
  const scale = options.scale ?? 1;
  const width = creative.canvas.width * scale;
  const height = creative.canvas.height * scale;
  const resolved = {
    images: options.images ?? {},
    fonts: options.fonts ?? SYSTEM_FONTS,
    showPlaceholders: options.showPlaceholders ?? true,
  };

  paintBackground(p, creative, width, height);

  for (const el of ordered(creative)) {
    const rect = rectOf(el.box, width, height);
    paintOne(p, el, rect, creative.palette, resolved, width);
  }
}

function paintOne(
  p: Painter,
  el: CreativeElement,
  rect: Rect,
  palette: Palette,
  resolved: Required<Pick<RenderOptions, "images" | "fonts" | "showPlaceholders">>,
  width: number,
): void {
  switch (el.kind) {
    case "shape":
      return paintShape(p, el, rect, palette);
    case "image":
      return paintImage(p, el, rect, palette, resolved, width);
    case "logo":
      return paintLogo(p, el, rect, resolved.images);
    case "text":
      return paintText(p, el, rect, palette, resolved.fonts, width);
  }
}

/** Every upload a creative needs loaded before it can be drawn completely. */
export function assetsOf(creative: Creative): string[] {
  const paths = new Set<string>();
  for (const el of creative.elements) {
    if ((el.kind === "image" || el.kind === "logo") && el.source) {
      paths.add(el.source.path);
    }
  }
  return [...paths];
}
