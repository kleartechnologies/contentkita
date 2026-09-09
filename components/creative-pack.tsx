"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ImagePlus,
  Loader2,
  RefreshCw,
  Sparkle,
} from "lucide-react";
import { toast } from "sonner";

import { ContentBody, ContentMeta } from "@/components/content-parts";
import { CreativeStudio } from "@/components/creative-studio";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import type { RestaurantProfile } from "@/lib/content";
import { defaultPackName, type PackStatus } from "@/lib/creative";
import { dayLabel, formatDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import { usePack, type PackDay } from "@/lib/use-pack";
import { cn } from "@/lib/utils";

/**
 * The content pack: thirty days of copy and thirty finished designs, in one
 * place the owner can work through.
 *
 * The screen it replaces was Day 01, wait, Day 02, wait — thirty times. Here
 * one press composes the whole month, the strip along the top says which days
 * are done, and the day on screen is the same Phase A studio, so nothing about
 * editing a poster had to be invented twice.
 *
 * The caption sits beside the poster rather than inside it. A caption belongs
 * in the post's text field where it can be read and searched; a poster carries
 * the one line that stops the scroll.
 */
export function CreativePack() {
  const { status, profile, plan, todayDay } = useApp();

  if (status !== "ready" || !profile || !plan) return <PackSkeleton />;

  return <Workspace profile={profile} todayDay={todayDay} />;
}

function Workspace({
  profile,
  todayDay,
}: {
  profile: RestaurantProfile;
  todayDay: number;
}) {
  const { plan } = useApp();
  const pack = usePack();
  const [selectedDay, setSelectedDay] = useState(todayDay);

  const selected = useMemo(
    () => pack.days.find((day) => day.item.day === selectedDay) ?? pack.days[0],
    [pack.days, selectedDay],
  );

  if (!plan) return <PackSkeleton />;

  return (
    <div className="space-y-6">
      <PackHeader profile={profile} pack={pack} />

      {pack.error ? (
        <p role="alert" className="text-sm text-tint-rose-fg">
          {pack.error}
        </p>
      ) : null}

      <DayStrip
        days={pack.days}
        selected={selected?.item.day ?? 0}
        onSelect={setSelectedDay}
      />

      {pack.loading ? (
        <p
          className="flex items-center gap-2 py-8 text-sm text-ink-soft"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Sedang memuatkan design anda…
        </p>
      ) : selected ? (
        <DayPanel day={selected} isToday={selected.item.day === todayDay} />
      ) : null}
    </div>
  );
}

/* --------------------------------- header --------------------------------- */

const STATUS_LABEL: Record<PackStatus, string> = {
  not_started: "Belum disediakan",
  generating: "Sedang disediakan",
  ready: "Semua siap",
  partial: "Sebahagian siap",
  failed: "Tak jadi",
};

const STATUS_CLASS: Record<PackStatus, string> = {
  not_started: "bg-sunken text-ink-muted",
  generating: "bg-brand-tint text-brand-ink",
  ready: "bg-tint-teal text-tint-teal-fg",
  partial: "bg-tint-amber text-tint-amber-fg",
  failed: "bg-tint-rose text-tint-rose-fg",
};

function PackHeader({
  profile,
  pack,
}: {
  profile: RestaurantProfile;
  pack: ReturnType<typeof usePack>;
}) {
  const { plan } = useApp();
  const stored = plan?.packName ?? "";
  const percent = pack.total > 0 ? (pack.ready / pack.total) * 100 : 0;

  return (
    <header className="ck-rise space-y-4">
      <PackNameField
        stored={stored}
        fallback={defaultPackName(profile, pack.total || 30)}
      />

      {/* Until the saved designs are in hand the counter would read 0/30 for a
          pack that is already half finished, and the button under it would
          offer to compose days that already exist. Say "still loading" instead
          of a number that is wrong. */}
      {pack.loading ? (
        <p
          className="flex items-center gap-2 text-sm text-ink-soft"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Sedang memuatkan design anda…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-bold leading-none",
                STATUS_CLASS[pack.status],
              )}
            >
              {STATUS_LABEL[pack.status]}
            </span>
            <span className="text-sm font-semibold text-ink" aria-live="polite">
              {pack.ready}/{pack.total} design siap
            </span>
          </div>

          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={pack.total}
            aria-valuenow={pack.ready}
            aria-label={`Design siap: ${pack.ready} daripada ${pack.total}`}
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {pack.ready < pack.total ? (
              <Button
                id="pack-generate"
                onClick={() => run(pack.generate, "Design anda dah siap.")}
                disabled={pack.running}
              >
                {pack.running ? <Loader2 className="animate-spin" /> : <Sparkle />}
                {pack.running
                  ? `Menyediakan… ${pack.ready}/${pack.total}`
                  : pack.ready === 0
                    ? "Sediakan semua design"
                    : "Sambung sediakan design"}
              </Button>
            ) : null}

            {pack.failures.length > 0 && !pack.running ? (
              <Button
                variant="secondary"
                onClick={() => run(pack.retryFailed, "Hari yang gagal dah dicuba semula.")}
              >
                <RefreshCw />
                Cuba lagi {pack.failures.length} hari gagal
              </Button>
            ) : null}

            {pack.gaps > 0 && !pack.running ? (
              <Button
                variant="secondary"
                onClick={() =>
                  run(pack.fillPhotos, "Gambar anda dah diletak pada design.")
                }
              >
                <ImagePlus />
                Isi gambar pada {pack.gaps} design
              </Button>
            ) : null}
          </div>

          <p className="text-xs leading-relaxed text-ink-muted">
            {pack.photos === 0
              ? "Belum ada gambar anda dalam sistem. Muat naik gambar makanan anda sendiri pada mana-mana hari — kami tak guna gambar orang lain."
              : `${pack.photos} gambar anda digunakan berselang-seli sepanjang pack ini.`}
          </p>
        </>
      )}
    </header>
  );
}

/**
 * The owner's label for their month of work.
 *
 * Saved when the field is left rather than on every keystroke: a rename is one
 * decision, not thirty, and thirty writes for one name is thirty chances for a
 * flaky connection to leave the label half-typed.
 */
function PackNameField({
  stored,
  fallback,
}: {
  stored: string;
  fallback: string;
}) {
  const { renamePack } = useApp();
  // `null` means "not being edited", so the field shows whatever is stored —
  // including a name that arrived from a regeneration or another tab. Once the
  // owner types, their draft wins until it is saved or fails.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function commit() {
    const next = (draft ?? stored).trim();
    if (next === stored) {
      setDraft(null);
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      await renamePack(next);
      setDraft(null);
      setSaved(true);
    } catch (err) {
      setDraft(null);
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Tak dapat simpan nama pack.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Label htmlFor="pack-name">Nama pack</Label>
      <Input
        id="pack-name"
        className="mt-1.5 text-base font-bold"
        value={draft ?? stored}
        placeholder={fallback}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {/* Said out loud, because a name that never landed looks exactly like one
          that did until the owner reloads the page a week later. */}
      <p className="mt-1.5 text-xs text-ink-muted" aria-live="polite">
        {saving
          ? "Menyimpan nama…"
          : saved
            ? "Nama pack disimpan."
            : "Nama ini milik anda. Tukar bila-bila."}
      </p>
    </div>
  );
}

/** Runs one of the pack actions and reports the outcome once, not per day. */
async function run(action: () => Promise<void>, done: string) {
  try {
    await action();
    toast.success(done);
  } catch (err) {
    toast.error(
      err instanceof Error && err.message
        ? err.message
        : "Tak dapat sediakan design sekarang. Cuba lagi.",
    );
  }
}

/* -------------------------------- day strip -------------------------------- */

const DOT: Record<PackDay["status"], string> = {
  ready: "bg-tint-teal-fg",
  generating: "bg-brand",
  failed: "bg-tint-rose-fg",
  missing: "bg-line-strong",
};

const DOT_LABEL: Record<PackDay["status"], string> = {
  ready: "siap",
  generating: "sedang disediakan",
  failed: "gagal",
  missing: "belum ada design",
};

/**
 * Thirty days as one scrolling row.
 *
 * A grid of thirty cards would push the day being worked on below the fold on
 * a phone, so the days stay on one line and the poster keeps the screen.
 */
function DayStrip({
  days,
  selected,
  onSelect,
}: {
  days: PackDay[];
  selected: number;
  onSelect: (day: number) => void;
}) {
  return (
    <nav aria-label="Hari dalam pack" className="-mx-4 px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1.5 overflow-x-auto pb-2">
        {days.map((day) => {
          const active = day.item.day === selected;
          return (
            <li key={day.item.id}>
              <button
                type="button"
                onClick={() => onSelect(day.item.day)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  // `relative` so the sr-only label below is positioned
                  // against this button. Without it the label's containing
                  // block is the page, which puts an absolutely positioned
                  // element outside the scroller's clip and makes the whole
                  // document 1843px wide on a 390px phone.
                  "relative flex w-14 shrink-0 flex-col items-center gap-1.5 rounded-[var(--radius-field)] border px-2 py-2.5 transition-colors",
                  active
                    ? "border-brand bg-brand-tint text-brand-ink"
                    : "border-line bg-surface text-ink-soft hover:bg-sunken",
                )}
              >
                <span className="text-sm font-bold leading-none">
                  {String(day.item.day).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    DOT[day.status],
                    day.status === "generating" && "animate-pulse",
                  )}
                  aria-hidden
                />
                <span className="sr-only">
                  {dayLabel(day.item.day)} — {DOT_LABEL[day.status]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* --------------------------------- one day -------------------------------- */

function DayPanel({ day, isToday }: { day: PackDay; isToday: boolean }) {
  const { item, creative, status, message } = day;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <section
        aria-labelledby="pack-design-heading"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6"
      >
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2
            id="pack-design-heading"
            className="text-lg font-extrabold tracking-tight text-ink"
          >
            {dayLabel(item.day)}
          </h2>
          {isToday ? (
            <span className="rounded-full bg-brand px-2.5 py-1 text-xs font-bold leading-none text-white">
              Hari ini
            </span>
          ) : null}
        </div>
        <p className="text-sm text-ink-soft">{formatDate(item.date)}</p>

        {status === "failed" ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-[var(--radius-field)] border border-line bg-tint-rose px-3 py-2.5 text-xs leading-relaxed text-tint-rose-fg"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {message ?? "Design hari ini tak dapat disediakan."}
          </p>
        ) : status === "ready" ? (
          <p className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-tint-teal-fg">
            <CheckCircle2 className="size-3.5" aria-hidden />
            Design tersimpan
          </p>
        ) : null}

        {/* Remounting when the saved design changes is what makes the studio
            show what generation just wrote, rather than what it loaded first. */}
        <div className="mt-5">
          <CreativeStudio
            key={`${item.id}:${creative?.updatedAt ?? "none"}`}
            item={item}
          />
        </div>
      </section>

      <section
        aria-labelledby="pack-caption-heading"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6"
      >
        <h2
          id="pack-caption-heading"
          className="text-lg font-extrabold tracking-tight text-ink"
        >
          Caption &amp; copywriting
        </h2>
        <ContentMeta item={item} className="mt-3" />
        <div className="mt-5">
          <ContentBody item={item} />
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <Link
            href={`/content/${item.id}`}
            className="-my-3 inline-flex items-center gap-1.5 py-3 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            Buka hari ini penuh
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

function PackSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Sedang memuatkan pack content anda…</span>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-1.5 w-full" />
      <div className="flex gap-1.5 overflow-hidden">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-14 shrink-0" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-96 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-96 w-full rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}
