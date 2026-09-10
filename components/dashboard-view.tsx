"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Loader2,
  RefreshCw,
  Sparkle,
} from "lucide-react";
import { toast } from "sonner";

import { BuyPackButton, ONE_TIME_NOTE } from "@/components/buy-pack-button";
import { CreativeThumb } from "@/components/creative-thumb";
import { GeneratingScreen, type PackStage } from "@/components/generating-screen";
import { DownloadAllButton, PackGallery } from "@/components/pack-gallery";
import { PlanList } from "@/components/plan-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ContentItem, RestaurantProfile } from "@/lib/content";
import { greeting } from "@/lib/format";
import { contentHref } from "@/lib/packs/href";
import type { Pack } from "@/lib/packs/types";
import { PACK_DAYS } from "@/lib/payment/product";
import { useApp } from "@/lib/store";
import { useCopy } from "@/lib/use-copy";
import { usePack, type PackState } from "@/lib/use-pack";

/**
 * The dashboard: a month of finished posts.
 *
 * ## What changed and why
 *
 * The screen this replaces opened with a progress bar, one day's copy written
 * out in full, and thirty rows of text — with the posters on another route,
 * behind a button. Read as a product that is a list of ideas and a reminder
 * that turning them into posts is still the owner's job.
 *
 * What the owner bought is thirty finished posters, so thirty finished
 * posters are what the page opens with. The tiles are the real creatives,
 * drawn by the renderer that writes the downloaded file. The words are still
 * here — a tap away on any tile, and listed in full under a disclosure for
 * anyone who wants to read the month straight through — but they are no
 * longer what the page is.
 *
 * ## One wait, not two
 *
 * Generation used to stop at the words and leave "now go and make the
 * designs" as a second errand on a second screen. Composition costs nothing —
 * no model is called — so it runs on the end of the same wait, and the owner
 * presses one button and gets a finished pack.
 */

export function DashboardView() {
  const { status, profile, activePack } = useApp();

  if (status !== "ready" || !profile) return <DashboardSkeleton />;
  // Two legitimate states before there is anything to show. No pack means
  // nothing has been bought, which is an offer. A pack with no content means
  // it was bought and not yet made, which is a button — not a bill.
  if (!activePack) return <NoPackYet profile={profile} />;

  return <PackDashboard profile={profile} pack={activePack} />;
}

/* ------------------------------ the whole pack ----------------------------- */

function PackDashboard({
  profile,
  pack,
}: {
  profile: RestaurantProfile;
  pack: Pack;
}) {
  const { plan, packs, todayDay, regeneratePlan } = useApp();
  const creatives = usePack();

  const [stage, setStage] = useState<PackStage | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [count, setCount] = useState({ done: 0, total: 0 });
  // Which pack the run is for, so a run started on one pack does not carry on
  // reporting into another after the owner switches months mid-generation.
  const runningFor = useRef<string | null>(null);
  const composedFor = useRef<string | null>(null);
  const composing = useRef(false);

  const total = plan?.items.length ?? PACK_DAYS;

  /**
   * Designs the pack, then places photographs, then finishes.
   *
   * Every step here is real work with a real result — none of it is a
   * progress bar with a timer behind it. `generate` composes the days that
   * have no poster, `fillPhotos` rebuilds the days that should be showing a
   * photograph and are not, and both are safe to have run before.
   */
  const compose = useCallback(async () => {
    setStage("designing");
    const run = await creatives.generate();
    setStage("photos");
    await creatives.fillPhotos();
    setStage("finishing");
    // Read from the run rather than from the hook's counters: those belong to
    // the render this callback closed over, which is the render before the one
    // that recorded the result.
    return run.failed === 0;
  }, [creatives]);

  /**
   * The whole run, from an empty pack to thirty posters.
   *
   * The design half cannot be called inline after the words land: the plan has
   * to reach the store and come back through a render before the composer can
   * see it. So this stops at `saving` and the effect below carries on when the
   * plan is actually in hand.
   */
  async function run() {
    runningFor.current = pack.id;
    setStage("brief");
    setCount({ done: 0, total });
    try {
      await regeneratePlan(
        (next) => setStage(next),
        (done, all) => setCount({ done, total: all }),
      );
    } catch (err) {
      runningFor.current = null;
      setStage(null);
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Tak dapat siapkan content sekarang. Cuba lagi sekejap lagi.",
        {
          description:
            "Pack anda masih dibayar. Cuba sekali lagi — tiada caj tambahan.",
        },
      );
    }
  }

  // The design half of a run the owner started, resumed once the plan has
  // arrived. `saving` is where `run` above leaves off.
  //
  // Guarded by a ref rather than by the effect's dependencies: `creatives` is
  // a fresh object every render, so this effect re-runs constantly and the
  // only reliable "already going" is one that does not reset with it.
  useEffect(() => {
    if (composing.current) return;
    if (runningFor.current !== pack.id || stage !== "saving") return;
    if (!plan || creatives.loading) return;
    composing.current = true;
    void (async () => {
      let complete = false;
      try {
        complete = await compose();
      } finally {
        composing.current = false;
        runningFor.current = null;
        composedFor.current = pack.id;
        setStage(null);
        // Only when the month is actually finished. A run that saved
        // twenty-eight of thirty is not something to congratulate anybody
        // about; that lands on the dashboard, where the two gaps are visible
        // and there is a button to fix them.
        setCelebrate(complete);
      }
    })();
  }, [pack.id, stage, plan, creatives.loading, compose]);

  /**
   * Posters for a pack whose words exist and whose designs do not.
   *
   * An owner who generated a month before this build, or whose run was
   * interrupted, has thirty captions and no posters — and no reason to know
   * that composing them is a thing they can ask for. It costs nothing, so it
   * simply happens, once per pack, in the background rather than behind a
   * full-screen wait: they are already looking at the page.
   */
  useEffect(() => {
    if (!plan || creatives.loading || creatives.running) return;
    if (runningFor.current || composedFor.current === pack.id) return;
    if (creatives.ready >= creatives.total || creatives.total === 0) return;
    composedFor.current = pack.id;
    void creatives.generate();
  }, [pack.id, plan, creatives]);

  if (stage) {
    return (
      <GeneratingScreen
        stage={stage}
        name={profile.name}
        done={stage === "designing" ? creatives.ready : count.done}
        total={stage === "designing" ? creatives.total : count.total}
      />
    );
  }

  if (celebrate) {
    return (
      <PackReadyScreen
        days={creatives.total}
        onOpen={() => setCelebrate(false)}
      />
    );
  }

  if (!plan) return <PackAwaitingContent profile={profile} pack={pack} onRun={run} />;

  const today = plan.items.find((item) => item.day === todayDay) ?? plan.items[0];
  const ready = creatives.days
    .map((day) => day.creative)
    .filter((creative): creative is NonNullable<typeof creative> => Boolean(creative));

  return (
    <div className="space-y-8">
      <header className="ck-rise flex items-center gap-3">
        {profile.logo?.url ? (
          /* A Storage download URL has no build-time known host for
             next/image to be configured against. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.logo.url}
            alt=""
            className="size-10 shrink-0 rounded-[var(--radius-field)] border border-line object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-soft">
            {greeting()}, {profile.name}
          </p>
          {packs.length > 1 ? (
            <Link
              href="/packs"
              className="-my-3 inline-flex min-h-10 items-center py-3 text-xs font-semibold text-ink-muted hover:text-ink"
            >
              {packs.length} pack — lihat semua
            </Link>
          ) : null}
        </div>
      </header>

      {/*
        The three facts, in the order that answers the owner's question. Not a
        percentage and not a status badge: what they want to know on opening
        this page is whether the month is done.
      */}
      <section aria-labelledby="pack-heading" className="ck-rise">
        <h1 id="pack-heading" className="sr-only">
          Pack content {plan.items.length} hari anda
        </h1>
        <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <Headline term="Hari" value={String(plan.items.length)} />
          <Headline term="Post" value={String(creatives.total)} />
          <div>
            <dd className="text-2xl font-extrabold leading-none tracking-tight text-brand sm:text-3xl">
              {creatives.ready >= creatives.total && creatives.total > 0
                ? "Sedia"
                : `${creatives.ready}/${creatives.total}`}
            </dd>
            <dt className="mt-1.5 text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
              {creatives.ready >= creatives.total && creatives.total > 0
                ? "Untuk post"
                : "Design siap"}
            </dt>
          </div>
        </dl>

        {creatives.running ? (
          <p
            className="mt-4 flex items-center gap-2 text-sm text-ink-soft"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Sedang menyiapkan design anda… {creatives.ready}/{creatives.total}
          </p>
        ) : (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <DownloadAllButton
              creatives={ready}
              packName={plan.packName || `${plan.items.length} Hari Content`}
              className="sm:w-auto"
            />
            {creatives.failures.length > 0 ? (
              <Button
                variant="secondary"
                onClick={() => void creatives.retryFailed()}
              >
                <RefreshCw />
                Cuba lagi {creatives.failures.length} hari
              </Button>
            ) : null}
          </div>
        )}

        {creatives.error ? (
          <p role="alert" className="mt-3 text-sm text-tint-rose-fg">
            {creatives.error}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="gallery-heading">
        <h2 id="gallery-heading" className="sr-only">
          Semua post anda
        </h2>
        {creatives.loading ? (
          <GallerySkeleton />
        ) : (
          <PackGallery
            days={creatives.days}
            packId={pack.id}
            todayDay={todayDay}
          />
        )}
      </section>

      <TodayStrip item={today} packId={pack.id} creatives={creatives} />

      {/*
        The words, for anyone who wants to read the month straight through.
        Closed by default, because thirty rows of text above the fold is the
        screen this page exists to stop being.
      */}
      <section id="pelan">
        <details className="group">
          <summary className="-my-3 flex cursor-pointer list-none items-center gap-1.5 py-3 text-sm font-semibold text-ink-soft hover:text-ink">
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
            Lihat senarai caption {plan.items.length} hari
          </summary>
          <div className="mt-4">
            <PlanList items={plan.items} todayDay={todayDay} packId={pack.id} />
          </div>
        </details>

        <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Button asChild variant="quiet" size="sm">
            <Link href={`/pack?packId=${pack.id}`}>
              Buka studio design
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

function Headline({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dd className="text-2xl font-extrabold leading-none tracking-tight text-ink sm:text-3xl">
        {value}
      </dd>
      <dt className="mt-1.5 text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
        {term}
      </dt>
    </div>
  );
}

/**
 * Today's post, at the size a reminder deserves.
 *
 * The poster first, one line of the caption, and the two things an owner
 * actually does with it. Not the full copy: that is what opening the day is
 * for, and printing it here is how the old dashboard ended up being mostly
 * text.
 */
function TodayStrip({
  item,
  packId,
  creatives,
}: {
  item: ContentItem;
  packId: string;
  creatives: PackState;
}) {
  const { copy, copiedKey } = useCopy();
  const creative =
    creatives.days.find((day) => day.item.id === item.id)?.creative ?? null;

  return (
    <section
      aria-labelledby="today-heading"
      className="ck-rise flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]"
    >
      {creative ? (
        <Link
          href={contentHref(item.id, packId)}
          className="w-20 shrink-0 overflow-hidden rounded-[var(--radius-field)] border border-line sm:w-24"
        >
          <CreativeThumb creative={creative} eager />
        </Link>
      ) : null}

      <div className="min-w-0 flex-1">
        <h2
          id="today-heading"
          className="text-xs font-bold uppercase tracking-[0.08em] text-brand"
        >
          Post hari ini
        </h2>
        <p className="mt-1 line-clamp-2 text-[0.9375rem] font-semibold leading-snug text-ink">
          {item.hook}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => copy(item.caption, "Caption disalin", "today")}
          >
            {copiedKey === "today" ? <Check /> : <Copy />}
            {copiedKey === "today" ? "Disalin" : "Salin caption"}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={contentHref(item.id, packId)}>
              Buka post
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- states --------------------------------- */

/**
 * The end of the wait.
 *
 * Says the one thing the owner has been waiting to hear, in the three numbers
 * that say it. No confetti: the poster grid behind this screen is the part
 * that is supposed to impress, and a screen that celebrates harder than the
 * work does is how a product tells on itself.
 */
function PackReadyScreen({
  days,
  onOpen,
}: {
  days: number;
  onOpen: () => void;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-6">
      <div className="w-full max-w-sm text-center">
        <p className="text-4xl" aria-hidden>
          🎉
        </p>
        <h1 className="mt-4 text-xl font-extrabold tracking-tight text-ink">
          Pack content {days} hari anda dah siap
        </h1>
        <dl className="mt-7 grid grid-cols-3 gap-3 text-center">
          <div>
            <dd className="text-2xl font-extrabold leading-none text-ink">{days}</dd>
            <dt className="mt-1.5 text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
              Hari
            </dt>
          </div>
          <div>
            <dd className="text-2xl font-extrabold leading-none text-ink">{days}</dd>
            <dt className="mt-1.5 text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
              Post
            </dt>
          </div>
          <div>
            <dd className="text-2xl font-extrabold leading-none text-brand">
              Sedia
            </dd>
            <dt className="mt-1.5 text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
              Untuk post
            </dt>
          </div>
        </dl>
        <Button size="lg" className="mt-8" onClick={onOpen}>
          Lihat {days} post anda
          <ArrowRight />
        </Button>
      </div>
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
          {PACK_DAYS} post siap — poster berjenama dan caption untuk setiap
          hari, ditulis dan direka daripada maklumat serta gambar restoran
          anda sendiri. Muat turun dan post.
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
 * A pack that has been paid for and has nothing in it yet.
 *
 * One button, and it produces the finished thing — words and posters in the
 * same run. Never automatic: it takes a real minute, and an owner who opens
 * the app to check something should not find it busy.
 */
function PackAwaitingContent({
  profile,
  pack,
  onRun,
}: {
  profile: RestaurantProfile;
  pack: Pack;
  onRun: () => void;
}) {
  const failed = pack.generationStatus === "failed";

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
            ? `Cuba siapkan ${PACK_DAYS} hari content anda semula`
            : `Siapkan ${PACK_DAYS} hari content anda`}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          {failed
            ? "Percubaan sebelum ini tak selesai. Pack ini dah dibayar, jadi cuba semula tanpa sebarang caj tambahan."
            : `Caption dan poster untuk ${PACK_DAYS} hari, guna maklumat dan gambar yang anda isi. Ambil masa sekitar satu minit.`}
        </p>
        <Button id="pack-generate" size="lg" className="mt-5" onClick={onRun}>
          <Sparkle />
          {failed ? "Cuba semula" : "Siapkan content saya"}
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

/* -------------------------------- skeletons -------------------------------- */

function GallerySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton
          key={i}
          className="aspect-square w-full rounded-[var(--radius-card)]"
        />
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Sedang memuatkan pack content anda…</span>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-[var(--radius-field)]" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex gap-8">
        <Skeleton className="h-12 w-16" />
        <Skeleton className="h-12 w-16" />
        <Skeleton className="h-12 w-20" />
      </div>
      <Skeleton className="h-12 w-64" />
      <GallerySkeleton />
    </div>
  );
}
