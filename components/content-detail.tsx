"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, SearchX } from "lucide-react";

import {
  CaptionBlock,
  ContentActions,
  ContentMeta,
  ContentNotes,
} from "@/components/content-parts";
import { CreativeStudio } from "@/components/creative-studio";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { contentHref } from "@/lib/packs/href";
import type { ContentItem, ContentPlan } from "@/lib/content";
import { dayLabel, formatDate } from "@/lib/format";
import { useApp } from "@/lib/store";

/**
 * Resolves a URL id against the current plan.
 *
 * Ids embed the plan they came from, so a link saved before the owner updated
 * their profile would otherwise 404. Falling back to the day number keeps every
 * bookmark and shared link working.
 */
function findItem(plan: ContentPlan, id: string): ContentItem | null {
  const exact = plan.items.find((item) => item.id === id);
  if (exact) return exact;

  const match = /-d(\d+)$/.exec(id) ?? /^(\d+)$/.exec(id);
  if (!match) return null;
  return plan.items.find((item) => item.day === Number(match[1])) ?? null;
}

export function ContentDetail({ id }: { id: string }) {
  const { status, plan, todayDay, activePackId } = useApp();

  if (status !== "ready" || !plan) return <DetailSkeleton />;

  const item = findItem(plan, id);
  if (!item) return <NotFound />;

  const prev = plan.items.find((i) => i.day === item.day - 1) ?? null;
  const next = plan.items.find((i) => i.day === item.day + 1) ?? null;
  const isToday = item.day === todayDay;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard"
        className="-my-3 inline-flex items-center gap-1.5 py-3 text-sm font-semibold text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Kembali ke pack anda
      </Link>

      {/*
        The poster, first and large. The screen this replaces opened with two
        badges, a paragraph of objective and the full copy, and put the design
        at the bottom under a heading explaining what it was — which told the
        owner the design was a bonus attached to the writing. It is the post.
      */}
      <header className="mt-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-lg font-extrabold tracking-tight text-ink">
          {dayLabel(item.day)}
        </h1>
        <p className="text-sm text-ink-soft">
          {formatDate(item.date)}
          {isToday ? (
            <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold leading-none text-white">
              Hari ini
            </span>
          ) : null}
        </p>
      </header>

      <section aria-labelledby="design-heading" className="mt-4">
        <h2 id="design-heading" className="sr-only">
          Design siap guna
        </h2>
        <CreativeStudio item={item} />
      </section>

      <section aria-labelledby="caption-heading" className="mt-8">
        <h2 id="caption-heading" className="sr-only">
          Caption dan hashtag
        </h2>
        <CaptionBlock item={item} />
      </section>

      {/*
        The strategy, folded away. It is honest work and occasionally useful,
        but an owner about to post does not need to read the reasoning that
        produced the post — that is the part that made this feel like homework.
      */}
      <details className="group mt-8 border-t border-line pt-5">
        <summary className="-my-3 flex cursor-pointer list-none items-center gap-1.5 py-3 text-sm font-semibold text-ink-soft hover:text-ink">
          <ChevronDown
            className="size-4 transition-transform group-open:rotate-180"
            aria-hidden
          />
          Butiran content
        </summary>
        <div className="mt-4 space-y-5">
          <ContentMeta item={item} />
          <ContentNotes item={item} />
          <ContentActions item={item} />
        </div>
      </details>

      <nav
        aria-label="Hari lain"
        className="mt-8 grid grid-cols-2 gap-2 border-t border-line pt-5"
      >
        {prev ? (
          <Link
            href={contentHref(prev.id, activePackId)}
            className="group flex items-center gap-2 rounded-[var(--radius-field)] border border-line bg-surface px-3 py-3 transition-colors hover:bg-sunken"
          >
            <ChevronLeft className="size-4 shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs text-ink-muted">Sebelum</span>
              <span className="block truncate text-sm font-semibold text-ink">
                {dayLabel(prev.day)}
              </span>
            </span>
          </Link>
        ) : (
          <span />
        )}

        {next ? (
          <Link
            href={contentHref(next.id, activePackId)}
            className="group col-start-2 flex items-center justify-end gap-2 rounded-[var(--radius-field)] border border-line bg-surface px-3 py-3 text-right transition-colors hover:bg-sunken"
          >
            <span className="min-w-0">
              <span className="block text-xs text-ink-muted">Seterusnya</span>
              <span className="block truncate text-sm font-semibold text-ink">
                {dayLabel(next.day)}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <SearchX className="mx-auto size-8 text-ink-muted" aria-hidden />
      <h1 className="mt-4 text-lg font-extrabold tracking-tight text-ink">
        Content ini tak dijumpai
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        Mungkin pelan anda telah dijana semula. Kembali ke kalendar untuk lihat
        pelan terkini.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Kembali ke dashboard</Link>
      </Button>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-2xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">Sedang memuatkan content…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-5 h-6 w-32 rounded-full" />
      <Skeleton className="mt-3 h-8 w-28" />
      <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="mt-4 h-32 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="mt-5 h-4 w-2/3" />
        <Skeleton className="mt-5 h-4 w-1/2" />
      </div>
    </div>
  );
}
