"use client";

import { useEffect, useRef, useState } from "react";

import {
  SYSTEM_FONTS,
  type Creative,
  type Fonts,
} from "@/lib/creative";
import { paintPreview, resolveFonts } from "@/lib/creative/browser";
import { cn } from "@/lib/utils";

/**
 * A composed creative, drawn on a marketing page.
 *
 * Deliberately the same `paintPreview` the studio uses, fed a creative that
 * came out of the same `composeCreative`. There is no second renderer and no
 * flattened mock-up: what a visitor sees here is the identical drawing code
 * that will draw their own poster after they sign up, so the page cannot drift
 * away from the product by being maintained separately.
 *
 * The image bank is empty on purpose. The demo restaurant has no uploads, and
 * borrowing a stock photograph to fill the slot would be presenting somebody
 * else's food as a restaurant's own — the one thing the poster is built not to
 * do. The slot renders as the honest dashed placeholder instead, exactly as it
 * does in the studio before an owner uploads a picture.
 */
export function CreativeCanvas({
  creative,
  label,
  className,
}: {
  creative: Creative;
  label: string;
  className?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [fonts, setFonts] = useState<Fonts>(SYSTEM_FONTS);

  // The app's real typeface, once the browser has it. Until then the system
  // stack draws, which is the same fallback the studio starts from.
  useEffect(() => {
    let live = true;
    resolveFonts().then((next) => {
      if (live) setFonts(next);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    paintPreview(canvas, creative, { images: {}, fonts, cssWidth: width });
  }, [creative, fonts, width]);

  return (
    <div
      ref={stageRef}
      className={cn("w-full overflow-hidden", className)}
      // Held before the canvas is painted, so the page does not jump once it is.
      style={{ aspectRatio: `${creative.canvas.width} / ${creative.canvas.height}` }}
    >
      <canvas
        ref={canvasRef}
        className="block h-auto w-full"
        role="img"
        aria-label={label}
      />
    </div>
  );
}
