"use client";

import { Check, Loader2 } from "lucide-react";

import type { GenerationStage } from "@/lib/content";
import { cn } from "@/lib/utils";

/**
 * What the owner watches while a month is written.
 *
 * Named steps, no percentage. We genuinely do not know how far through a model
 * is, and a bar that crawls to 90% and sits there is a lie the owner can feel.
 * Naming the step is honest and, on a minute-long wait, more reassuring.
 *
 * The writing step is the exception, and only because there is a true number to
 * show: the month is written in batches, so finished days are counted, not
 * estimated. It appears once the first batch lands rather than reading "0 / 30"
 * during the longest silence.
 */

const STAGES: { key: GenerationStage; label: string }[] = [
  { key: "brief", label: "Membaca maklumat restoran anda" },
  { key: "strategy", label: "Menyusun strategi 30 hari" },
  { key: "writing", label: "Menulis hook, caption dan idea gambar" },
  { key: "checking", label: "Menyemak supaya tiada fakta direka" },
  { key: "saving", label: "Menyimpan content anda" },
];

export function GeneratingScreen({
  stage,
  name,
  done = 0,
  total = 0,
}: {
  stage: GenerationStage;
  name?: string;
  /** Days validated so far, and how many are expected. */
  done?: number;
  total?: number;
}) {
  const index = Math.max(
    STAGES.findIndex((s) => s.key === stage),
    0,
  );

  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-6">
      <div className="w-full max-w-sm text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-brand" aria-hidden />
        <h1 className="mt-5 text-xl font-extrabold tracking-tight text-ink">
          Menyusun 30 hari content…
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Sekejap ya{name ? `, ${name}` : ""}. Ini ambil masa sekitar satu minit.
          Jangan tutup tab ini.
        </p>

        <ol className="mt-7 space-y-2.5 text-left" aria-live="polite">
          {STAGES.map((s, i) => {
            const complete = i < index;
            const active = i === index;
            const count =
              s.key === "writing" && done > 0 && total > 0
                ? ` — ${done} / ${total} hari`
                : "";
            return (
              <li
                key={s.key}
                className={cn(
                  "flex items-center gap-2.5 text-sm",
                  active ? "font-semibold text-ink" : "text-ink-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border",
                    complete && "border-brand bg-brand text-white",
                    active && "border-brand text-brand",
                    !complete && !active && "border-line",
                  )}
                >
                  {complete ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : active ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : null}
                </span>
                {s.label}
                {count}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
