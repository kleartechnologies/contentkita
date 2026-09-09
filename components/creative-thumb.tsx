"use client";

import { useEffect, useRef, useState } from "react";

import { loadImages, paintPreview, resolveFonts } from "@/lib/creative/browser";
import { SYSTEM_FONTS, type Creative, type Fonts, type ImageBank } from "@/lib/creative";
import { cn } from "@/lib/utils";

/**
 * One finished poster, small.
 *
 * The gallery is the product, so a tile has to be the design itself rather
 * than a description of it — a card saying "Hari 07 · Menu Feature" is the
 * spreadsheet the owner was trying to escape. The same `drawCreative` paints
 * this tile, the studio preview and the downloaded PNG, so what is on the
 * grid is what lands in the file.
 *
 * ## Why it waits to draw
 *
 * Thirty canvases, each fetching its photographs, is a lot to ask of a phone
 * on a Malaysian mobile connection all at once. A tile draws when it is about
 * to come into view and not before; until then it is a plain tinted rectangle
 * of the right shape, so the grid never reflows as the pictures arrive.
 */
export function CreativeThumb({
  creative,
  className,
  /** Draw immediately instead of on approach. For the few tiles above the fold. */
  eager = false,
}: {
  creative: Creative;
  className?: string;
  eager?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(eager);
  const [images, setImages] = useState<ImageBank>({});
  const [fonts, setFonts] = useState<Fonts>(SYSTEM_FONTS);
  const [width, setWidth] = useState(0);
  const [painted, setPainted] = useState(false);

  /* --- is it nearly on screen? -------------------------------------------- */

  useEffect(() => {
    if (near) return;
    const box = boxRef.current;
    if (!box) return;
    // A screen of margin: the tile is ready by the time the owner's thumb has
    // finished the flick that brings it up.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "600px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [near]);

  /* --- what it needs to draw ---------------------------------------------- */

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    (async () => {
      const [bank, resolved] = await Promise.all([
        loadImages(creative),
        resolveFonts(),
      ]);
      if (cancelled) return;
      setImages(bank);
      setFonts(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [near, creative]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas || width <= 0) return;
    // Placeholders off. The dashed "gambar di sini" rectangle is a hint for
    // somebody editing; on a gallery tile it reads as a hole in the design.
    paintPreview(canvas, creative, {
      images,
      fonts,
      cssWidth: width,
      showPlaceholders: false,
    });
    setPainted(true);
  }, [near, creative, images, fonts, width]);

  const ratio = `${creative.canvas.width} / ${creative.canvas.height}`;

  return (
    <div
      ref={boxRef}
      className={cn("relative overflow-hidden bg-sunken", className)}
      style={{ aspectRatio: ratio }}
    >
      {near ? (
        <canvas
          ref={canvasRef}
          className={cn(
            "block h-auto w-full transition-opacity duration-300",
            painted ? "opacity-100" : "opacity-0",
          )}
          role="img"
          aria-label={creative.name}
        />
      ) : null}
    </div>
  );
}
