"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Download, ImageOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { CreativeThumb } from "@/components/creative-thumb";
import { Button } from "@/components/ui/button";
import type { Creative } from "@/lib/creative";
import { download, exportPack, resolveFonts } from "@/lib/creative/browser";
import { contentHref } from "@/lib/packs/href";
import type { PackDay } from "@/lib/use-pack";
import { cn } from "@/lib/utils";

/**
 * The month, as thirty finished posters.
 *
 * This is the product. Everything else on the dashboard is a caption to it.
 * The screen this replaced led with a progress bar and thirty rows of text,
 * with the designs on another route behind a button — which told the owner
 * that what they bought was a list of ideas and that making them into posts
 * was still their job. What they bought is on this grid.
 *
 * Tiles are the real creatives, drawn by the same renderer that writes the
 * downloaded PNG. No mock-ups, no "Hari 12 · Menu Feature" cards standing in
 * for a design that has not been made yet.
 */

export function PackGallery({
  days,
  packId,
  todayDay,
  className,
}: {
  days: PackDay[];
  packId: string | null;
  todayDay: number;
  className?: string;
}) {
  return (
    <ol
      id="pack-gallery"
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4",
        className,
      )}
    >
      {days.map((day, index) => (
        <li key={day.item.id}>
          <Tile
            day={day}
            packId={packId}
            isToday={day.item.day === todayDay}
            // The first row is on screen before the owner scrolls anywhere, so
            // it draws immediately rather than waiting to be approached.
            eager={index < 4}
          />
        </li>
      ))}
    </ol>
  );
}

function Tile({
  day,
  packId,
  isToday,
  eager,
}: {
  day: PackDay;
  packId: string | null;
  isToday: boolean;
  eager: boolean;
}) {
  const { item, creative } = day;
  const label = String(item.day).padStart(2, "0");

  return (
    <Link
      href={contentHref(item.id, packId)}
      data-day={item.day}
      className={cn(
        "group relative block overflow-hidden rounded-[var(--radius-card)] border bg-surface transition-[transform,box-shadow] duration-200",
        "hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]",
        isToday ? "border-brand" : "border-line",
      )}
    >
      {creative ? (
        <CreativeThumb creative={creative} eager={eager} />
      ) : (
        <Pending status={day.status} />
      )}

      {/* The day number, small, on the poster rather than beside it. A caption
          strip under every tile would turn the grid back into a list. */}
      <span
        className={cn(
          "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold leading-none backdrop-blur-sm",
          isToday
            ? "bg-brand text-white"
            : "bg-black/55 text-white",
        )}
      >
        {isToday ? `Hari ini · ${label}` : label}
      </span>
      <span className="sr-only" data-hook>
        {item.hook}
      </span>
    </Link>
  );
}

/** A day whose poster is not composed yet. Says so; never fakes one. */
function Pending({ status }: { status: PackDay["status"] }) {
  return (
    <div className="grid aspect-square place-items-center bg-sunken">
      {status === "generating" ? (
        <Loader2 className="size-5 animate-spin text-ink-muted" aria-hidden />
      ) : (
        <ImageOff className="size-5 text-ink-muted" aria-hidden />
      )}
    </div>
  );
}

/* ------------------------------- download all ------------------------------ */

/**
 * The whole month as one file.
 *
 * The primary action on the dashboard, because the thing an owner does with a
 * finished pack is take it away and post it. Thirty separate downloads is not
 * a smaller version of this — browsers block the second one.
 */
export function DownloadAllButton({
  creatives,
  packName,
  className,
}: {
  creatives: readonly Creative[];
  packName: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  async function run() {
    if (creatives.length === 0) return;
    setBusy(true);
    setDone(0);
    try {
      const fonts = await resolveFonts();
      const blob = await exportPack(creatives, fonts, (finished) =>
        setDone(finished),
      );
      const base =
        packName
          .normalize("NFKD")
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-")
          .toLowerCase() || "content-pack";
      download(blob, `${base}.zip`);
      toast.success(`${creatives.length} design dimuat turun.`);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Tak dapat muat turun semua design. Cuba lagi.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      id="pack-download-all"
      size="lg"
      className={className}
      onClick={run}
      disabled={busy || creatives.length === 0}
      aria-live="polite"
    >
      {busy ? (
        <Loader2 className="animate-spin" />
      ) : done > 0 ? (
        <Check />
      ) : (
        <Download />
      )}
      {busy
        ? `Menyiapkan… ${done}/${creatives.length}`
        : `Muat turun semua ${creatives.length} design`}
    </Button>
  );
}
