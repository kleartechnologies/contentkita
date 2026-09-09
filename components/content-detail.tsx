"use client";

import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, SearchX } from "lucide-react";

import { ContentActions, ContentBody } from "@/components/content-parts";
import { CategoryBadge, PlatformBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { status, plan, todayDay } = useApp();

  if (status !== "ready" || !plan) return <DetailSkeleton />;

  const item = findItem(plan, id);
  if (!item) return <NotFound />;

  const prev = plan.items.find((i) => i.day === item.day - 1) ?? null;
  const next = plan.items.find((i) => i.day === item.day + 1) ?? null;
  const isToday = item.day === todayDay;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard#pelan"
        className="-my-2 inline-flex items-center gap-1.5 py-2 text-sm font-semibold text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Kembali ke kalendar
      </Link>

      <header className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={item.category} />
          <PlatformBadge platform={item.platform} />
          {isToday ? (
            <span className="rounded-full bg-brand px-2.5 py-1 text-xs font-bold leading-none text-white">
              Hari ini
            </span>
          ) : null}
        </div>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-ink">
          {dayLabel(item.day)}
        </h1>
        <p className="mt-0.5 text-sm text-ink-soft">{formatDate(item.date)}</p>
      </header>

      <article className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
        <ContentBody item={item} />
      </article>

      <ContentActions item={item} className="mt-5" />

      <nav
        aria-label="Hari lain"
        className="mt-8 grid grid-cols-2 gap-2 border-t border-line pt-5"
      >
        {prev ? (
          <Link
            href={`/content/${prev.id}`}
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
            href={`/content/${next.id}`}
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
