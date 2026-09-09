"use client";

import type { AssetRef } from "../content/types.ts";
import { assetsOf, SYSTEM_FONTS, drawCreative, type Fonts, type ImageBank, type LoadedImage } from "./render.ts";
import type { Creative } from "./types.ts";

/**
 * The half of rendering that needs a browser.
 *
 * `render.ts` deliberately knows nothing about the DOM so its layout can be
 * unit-tested; everything here — loading pictures, resolving the app's real
 * typeface, turning a canvas into a file — is the part that cannot be. Both
 * the preview and the export go through the same `drawCreative`, so what an
 * owner downloads is what they were looking at.
 */

/**
 * Routes a Storage download URL through this origin.
 *
 * Not decoration: an image fetched straight from
 * `firebasestorage.googleapis.com` taints the canvas, and a tainted canvas
 * refuses `toBlob()`. See `app/api/asset/route.ts`.
 */
export function assetUrl(url: string): string {
  return `/api/asset?url=${encodeURIComponent(url)}`;
}

function loadOne(url: string): Promise<LoadedImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    // A picture that will not load is not an error the owner can act on. The
    // slot renders as an empty slot, which is honest, and the rest of the
    // poster still draws.
    img.onerror = () => resolve(null);
    img.src = assetUrl(url);
  });
}

/** Every upload the creative references, loaded and keyed by storage path. */
export async function loadImages(creative: Creative): Promise<ImageBank> {
  const wanted = new Set(assetsOf(creative));
  const refs: AssetRef[] = [];
  for (const el of creative.elements) {
    if ((el.kind === "image" || el.kind === "logo") && el.source) {
      if (wanted.delete(el.source.path)) refs.push(el.source);
    }
  }

  const bank: ImageBank = {};
  await Promise.all(
    refs.map(async (ref) => {
      if (!ref.url) return;
      const loaded = await loadOne(ref.url);
      if (loaded) bank[ref.path] = loaded;
    }),
  );
  return bank;
}

/**
 * The typeface the product is actually set in.
 *
 * Read from the live page rather than hard-coded, so the poster stays in step
 * with `app/globals.css` instead of drifting the day the font changes. Waiting
 * on `document.fonts.ready` first matters more than it looks: measure a
 * headline before the webfont has arrived and every line is wrapped against
 * the fallback's widths.
 */
export async function resolveFonts(): Promise<Fonts> {
  try {
    await document.fonts.ready;
  } catch {
    // Not supported, or blocked. The fallback stack still renders.
  }
  const family = getComputedStyle(document.body).fontFamily;
  if (!family) return SYSTEM_FONTS;
  return { display: family, body: family };
}

/** A 2D context, or `null` on a browser that refuses one. */
function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext("2d");
}

export interface PaintOptions {
  images: ImageBank;
  fonts: Fonts;
  /** CSS pixels the canvas occupies. The backing store is scaled to match. */
  cssWidth: number;
  showPlaceholders?: boolean;
}

/**
 * Draws the creative into an on-screen canvas at the size it is displayed.
 *
 * The backing store is sized in device pixels so the preview is sharp on a
 * phone, and the whole layout is expressed in fractions, so "smaller" is a
 * scale factor rather than a second set of numbers to keep in sync.
 */
export function paintPreview(
  canvas: HTMLCanvasElement,
  creative: Creative,
  options: PaintOptions,
): void {
  const ctx = context(canvas);
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ratio = options.cssWidth / creative.canvas.width;
  const scale = ratio * dpr;

  canvas.width = Math.round(creative.canvas.width * scale);
  canvas.height = Math.round(creative.canvas.height * scale);
  canvas.style.width = `${options.cssWidth}px`;
  canvas.style.height = `${creative.canvas.height * ratio}px`;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCreative(ctx, creative, {
    images: options.images,
    fonts: options.fonts,
    scale,
    showPlaceholders: options.showPlaceholders ?? true,
  });
}

/**
 * Renders the creative at its full canvas size and returns a PNG.
 *
 * Placeholders are off: the dashed "gambar di sini" slot is a hint for the
 * person editing, and printing it onto the file they are about to post would
 * be a bug with an audience.
 */
export async function exportPng(
  creative: Creative,
  images: ImageBank,
  fonts: Fonts,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = creative.canvas.width;
  canvas.height = creative.canvas.height;

  const ctx = context(canvas);
  if (!ctx) throw new Error("Browser ini tak boleh render gambar.");

  drawCreative(ctx, creative, { images, fonts, scale: 1, showPlaceholders: false });

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("Gagal simpan gambar. Cuba sekali lagi.");
  return blob;
}

/** Turns a creative name into something a filesystem will accept. */
export function fileNameFor(creative: Creative): string {
  const base = creative.name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${base || `creative-hari-${creative.day}`}.png`;
}

/** Hands the file to the browser's own download machinery, then cleans up. */
export function download(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking synchronously can race the download in
  // Safari and hand the owner an empty file.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
