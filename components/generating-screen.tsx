"use client";

import { Check, Loader2 } from "lucide-react";

import type { GenerationStage } from "@/lib/content";
import { cn } from "@/lib/utils";

/**
 * What the owner watches while a month is made.
 *
 * ## Why the list runs past the words
 *
 * ContentKita does not sell thirty content ideas, it sells thirty finished
 * posts, and a waiting screen that stops at "content saved" tells the owner
 * the job is the words. So the same screen carries straight on through
 * designing the posters and placing their photographs, and ends by saying the
 * pack is ready. One wait, one outcome.
 *
 * ## Why there is no percentage
 *
 * Named steps, no bar. We genuinely do not know how far through a model is,
 * and a bar that crawls to 90% and sits there is a lie the owner can feel.
 * Naming the step is honest and, on a minute-long wait, more reassuring.
 *
 * Two steps do carry a true number — the days written, and the posters
 * designed — because both are counted from work in hand rather than estimated.
 *
 * ## What it does not say
 *
 * No model names, no batch sizes, no "validating JSON schema". The owner is a
 * restaurant owner waiting for their content; every line here is written in
 * terms of their restaurant, not our pipeline.
 */

/**
 * The steps of the whole run, words and pictures together.
 *
 * The first five come from the content engine (`GenerationStage`); the last
 * three are composition, which happens in the browser and costs nothing. They
 * share one type because to the person waiting it is one wait.
 */
export type PackStage =
  | GenerationStage
  | "designing"
  | "photos"
  | "finishing";

const STAGES: { key: PackStage; label: string }[] = [
  { key: "brief", label: "Memahami restoran anda" },
  { key: "strategy", label: "Menyusun pelan content 30 hari" },
  { key: "writing", label: "Menulis caption anda" },
  { key: "checking", label: "Menyemak supaya tiada fakta direka" },
  { key: "saving", label: "Menyimpan content anda" },
  { key: "designing", label: "Mereka bentuk poster anda" },
  { key: "photos", label: "Menggunakan gambar restoran anda" },
  { key: "finishing", label: "Menyiapkan pack content anda" },
];

export function GeneratingScreen({
  stage,
  name,
  done = 0,
  total = 0,
}: {
  stage: PackStage;
  name?: string;
  /** Days finished so far in the step that has a real count, and of how many. */
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
          Sedang menyiapkan 30 hari content anda…
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Sekejap ya{name ? `, ${name}` : ""}. Ini ambil masa sekitar satu minit.
          Jangan tutup tab ini.
        </p>

        <ol className="mt-7 space-y-2.5 text-left" aria-live="polite">
          {STAGES.map((s, i) => {
            const complete = i < index;
            const active = i === index;
            // Shown only on the two steps where the number is counted rather
            // than guessed, and only once the first result is actually in.
            const count =
              (s.key === "writing" || s.key === "designing") &&
              active &&
              done > 0 &&
              total > 0
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
