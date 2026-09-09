"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";

import { ContentActions, ContentBody, ContentMeta } from "@/components/content-parts";
import { PlanList } from "@/components/plan-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dayLabel, greeting } from "@/lib/format";
import { useApp } from "@/lib/store";

export function DashboardView() {
  const { status, profile, plan, todayDay } = useApp();

  if (status !== "ready" || !plan) return <DashboardSkeleton />;

  const today = plan.items.find((item) => item.day === todayDay) ?? plan.items[0];
  const remaining = plan.items.length - todayDay;

  return (
    <div className="space-y-8">
      <header className="ck-rise">
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          {greeting()}, {profile.name} 👋
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {remaining > 0
            ? `${dayLabel(todayDay)} daripada ${plan.items.length}. Tinggal ${remaining} hari lagi dalam pelan ini.`
            : `${dayLabel(todayDay)} — hari terakhir pelan ini.`}
        </p>
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={plan.items.length}
          aria-valuenow={todayDay}
          aria-label={`Kemajuan pelan: hari ${todayDay} daripada ${plan.items.length}`}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${(todayDay / plan.items.length) * 100}%` }}
          />
        </div>
      </header>

      <section aria-labelledby="today-heading" className="ck-rise">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2
            id="today-heading"
            className="text-xs font-bold uppercase tracking-[0.08em] text-brand"
          >
            Content hari ini
          </h2>
          <Link
            href={`/content/${today.id}`}
            className="-my-2 py-2 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            Buka penuh
          </Link>
        </div>

        <article className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-raised)] sm:p-6">
          <ContentMeta item={today} className="mb-5" />
          <ContentBody item={today} />
          <ContentActions item={today} className="mt-6" />
        </article>
      </section>

      <section aria-labelledby="plan-heading" id="pelan">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2
            id="plan-heading"
            className="flex items-center gap-2 text-base font-bold tracking-tight text-ink"
          >
            <CalendarDays className="size-4 text-ink-muted" aria-hidden />
            Pelan Content 30 Hari
          </h2>
          <span className="text-xs text-ink-muted">Tekan mana-mana hari</span>
        </div>

        <PlanList items={plan.items} todayDay={todayDay} />

        <p className="mt-4 text-center text-xs leading-relaxed text-ink-muted">
          Content ini disusun daripada maklumat yang anda isi sendiri. Ubah
          maklumat, pelan akan dijana semula.
        </p>
        <div className="mt-3 flex justify-center">
          <Button asChild variant="quiet" size="sm">
            <Link href="/profile">
              Kemas kini maklumat restoran
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Sedang memuatkan pelan content anda…</span>
      <div className="space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-1.5 w-full" />
      </div>

      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="mt-5 h-6 w-3/4" />
        <Skeleton className="mt-4 h-28 w-full rounded-[var(--radius-card)]" />
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Skeleton className="h-11 w-full sm:flex-1" />
          <Skeleton className="h-11 w-full sm:flex-1" />
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-0">
            <Skeleton className="size-11 rounded-[var(--radius-field)]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-full max-w-sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
