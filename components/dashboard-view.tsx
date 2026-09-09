"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Palette,
  RefreshCw,
  Sparkle,
} from "lucide-react";
import { toast } from "sonner";

import { BuyPackButton, ONE_TIME_NOTE } from "@/components/buy-pack-button";
import { ContentActions, ContentBody, ContentMeta } from "@/components/content-parts";
import { GeneratingScreen } from "@/components/generating-screen";
import { PlanList } from "@/components/plan-list";
import { contentHref } from "@/lib/packs/href";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { GenerationStage, RestaurantProfile } from "@/lib/content";
import { dayLabel, greeting } from "@/lib/format";
import type { Pack } from "@/lib/packs/types";
import { PACK_DAYS } from "@/lib/payment/product";
import { useApp } from "@/lib/store";

export function DashboardView() {
  const { status, profile, plan, activePack, packs, todayDay } = useApp();

  if (status !== "ready" || !profile) return <DashboardSkeleton />;
  // Three legitimate states, and they are not the same state. No pack means
  // nothing has been bought. A pack with no content means it was bought and
  // not yet generated — which is a button, not a bill.
  if (!activePack) return <NoPackYet profile={profile} />;
  if (!plan) return <PackAwaitingContent profile={profile} pack={activePack} />;

  const today = plan.items.find((item) => item.day === todayDay) ?? plan.items[0];
  const remaining = plan.items.length - todayDay;

  return (
    <div className="space-y-8">
      <header className="ck-rise">
        <div className="flex items-center gap-3">
          {profile.logo?.url ? (
            /* A Storage download URL has no build-time known host for
               next/image to be configured against. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logo.url}
              alt=""
              className="size-11 shrink-0 rounded-[var(--radius-field)] border border-line object-cover"
            />
          ) : null}
          <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
            {greeting()}, {profile.name} 👋
          </h1>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-brand-ink">
          <CheckCircle2 className="size-4" aria-hidden />
          Pelan {plan.items.length} hari anda dah siap
        </p>
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
        {packs.length > 1 ? (
          <p className="mt-2 text-xs text-ink-muted">
            Anda ada {packs.length} pack.{" "}
            <Link href="/packs" className="font-semibold text-ink-soft hover:text-ink">
              Lihat semua
            </Link>
          </p>
        ) : null}
      </header>

      {/*
        The words are half of what a pack is; the designs are the other half,
        and they live on another route behind a button the owner has to press.
        Saying so here — above the thirty rows rather than below them — is the
        difference between an owner who has a month of posters and one who
        never found out they had any.
      */}
      <section
        aria-labelledby="pack-next-heading"
        className="ck-rise rounded-[var(--radius-card)] border border-brand-line bg-brand-tint p-5"
      >
        <h2
          id="pack-next-heading"
          className="flex items-center gap-2 text-base font-bold tracking-tight text-brand-ink"
        >
          <Palette className="size-4" aria-hidden />
          Langkah seterusnya: {plan.items.length} design anda
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/85">
          Ayat untuk {plan.items.length} hari dah siap. Sekarang sediakan
          poster berjenama untuk setiap hari — guna logo, warna dan ayat anda
          sendiri. Boleh edit, boleh muat turun PNG.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/pack?packId=${activePack.id}`}>
            Buka {plan.items.length} design anda
            <ArrowRight />
          </Link>
        </Button>
      </section>

      <section aria-labelledby="today-heading" className="ck-rise">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2
            id="today-heading"
            className="text-xs font-bold uppercase tracking-[0.08em] text-brand"
          >
            Content hari ini
          </h2>
          <Link
            href={contentHref(today.id, activePack?.id)}
            className="-my-3 py-3 text-sm font-semibold text-ink-soft hover:text-ink"
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
            Pelan Content {plan.items.length} Hari
          </h2>
          <span className="text-xs text-ink-muted">Tekan mana-mana hari</span>
        </div>

        <PlanList items={plan.items} todayDay={todayDay} packId={activePack?.id} />

        <p className="mt-4 text-center text-xs leading-relaxed text-ink-muted">
          Content ini disusun daripada maklumat yang anda isi sendiri. Pack ini
          kekal milik anda — ia tidak akan ditulis ganti.
        </p>
        <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Button asChild variant="quiet" size="sm">
            <Link href={`/pack?packId=${activePack.id}`}>
              Buka {plan.items.length} design anda
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/profile">Kemas kini maklumat restoran</Link>
          </Button>
        </div>
      </section>

      {/*
        Buying again is an offer, not a nag, so it sits at the end and says
        plainly what it costs. A second purchase makes a second pack: this one
        stays exactly where it is.
      */}
      <section
        aria-labelledby="buy-again-heading"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-center"
      >
        <h2
          id="buy-again-heading"
          className="text-base font-bold tracking-tight text-ink"
        >
          Nak {PACK_DAYS} hari lagi?
        </h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">
          Pack baru ditambah di sebelah pack sedia ada. Content yang ada
          sekarang kekal, tidak ditulis ganti.
        </p>
        <div className="mt-4 flex justify-center">
          <BuyPackButton size="md" />
        </div>
        <p className="mt-2 text-xs text-ink-muted">{ONE_TIME_NOTE}</p>
      </section>
    </div>
  );
}

/**
 * The dashboard for an owner who has finished onboarding and bought nothing.
 *
 * Says the price before the button, because a button that takes someone to a
 * payment page without having named a number is a trick.
 */
function NoPackYet({ profile }: { profile: RestaurantProfile }) {
  return (
    <div className="space-y-6">
      <header className="ck-rise">
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          {greeting()}, {profile.name} 👋
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Maklumat restoran anda dah tersimpan. Tinggal satu langkah lagi.
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center shadow-[var(--shadow-raised)]">
        <div className="mx-auto grid size-11 place-items-center rounded-[var(--radius-field)] bg-brand-tint text-brand-ink">
          <Sparkle className="size-5" aria-hidden />
        </div>
        <h2 className="mt-4 text-base font-bold tracking-tight text-ink">
          Pack {PACK_DAYS} hari content
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          Hook, caption, call to action dan idea gambar untuk {PACK_DAYS} hari,
          ditulis daripada maklumat restoran anda — serta {PACK_DAYS} poster
          berjenama yang boleh anda edit dan muat turun.
        </p>
        <div className="mt-5 flex justify-center">
          <BuyPackButton />
        </div>
        <p className="mt-2.5 text-xs text-ink-muted">{ONE_TIME_NOTE}</p>
      </section>

      <div className="flex justify-center">
        <Button asChild variant="quiet" size="sm">
          <Link href="/profile">
            Semak maklumat restoran dulu
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * A pack that has been paid for and has no content in it yet.
 *
 * Generation is a button, never automatic. It takes a real minute, and after a
 * failure the same button is pressed again — the pack is already paid for, so
 * retrying costs the owner nothing.
 */
function PackAwaitingContent({
  profile,
  pack,
}: {
  profile: RestaurantProfile;
  pack: Pack;
}) {
  const { regeneratePlan } = useApp();
  const [stage, setStage] = useState<GenerationStage | null>(null);
  const [written, setWritten] = useState({ done: 0, total: 0 });
  const failed = pack.generationStatus === "failed";

  async function run() {
    setStage("brief");
    try {
      await regeneratePlan(setStage, (done, total) => setWritten({ done, total }));
      toast.success(`Pelan ${PACK_DAYS} hari anda dah siap. Sekarang sediakan design.`);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Tak dapat jana content sekarang. Cuba lagi sekejap lagi.",
        { description: "Pack anda masih dibayar. Cuba jana semula — tiada caj tambahan." },
      );
    } finally {
      setStage(null);
    }
  }

  if (stage) {
    return (
      <GeneratingScreen
        stage={stage}
        name={profile.name}
        done={written.done}
        total={written.total}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="ck-rise">
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          {greeting()}, {profile.name} 👋
        </h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-brand-ink">
          <CheckCircle2 className="size-4" aria-hidden />
          Bayaran anda dah disahkan. Pack ini milik anda.
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center shadow-[var(--shadow-raised)]">
        <div className="mx-auto grid size-11 place-items-center rounded-[var(--radius-field)] bg-brand-tint text-brand-ink">
          {failed ? (
            <RefreshCw className="size-5" aria-hidden />
          ) : (
            <Sparkle className="size-5" aria-hidden />
          )}
        </div>
        <h2 className="mt-4 text-base font-bold tracking-tight text-ink">
          {failed
            ? `Cuba jana ${PACK_DAYS} hari content anda semula`
            : `Jana ${PACK_DAYS} hari content anda`}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          {failed
            ? `Percubaan sebelum ini tak selesai. Pack ini dah dibayar, jadi cuba semula tanpa sebarang caj tambahan.`
            : `Kami akan tulis hook, caption, call to action dan idea gambar untuk ${PACK_DAYS} hari, guna maklumat yang anda isi. Ambil masa sekitar satu minit.`}
        </p>
        <Button size="lg" className="mt-5" onClick={run}>
          <Sparkle />
          {failed ? "Jana semula" : "Jana content sekarang"}
        </Button>
        <p className="mt-2.5 text-xs text-ink-muted">
          Tiada caj tambahan untuk pack ini.
        </p>
      </section>

      <div className="flex justify-center">
        <Button asChild variant="quiet" size="sm">
          <Link href="/profile">
            Semak maklumat restoran dulu
            <ArrowRight />
          </Link>
        </Button>
      </div>
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
