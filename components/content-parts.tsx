"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Image as ImageIcon,
  Palette,
  Pencil,
  RefreshCw,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CategoryBadge, PlatformBadge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/field";
import { CATEGORY_META, type ContentItem } from "@/lib/content";
import { dayLabel, formatDate, formatFullContent } from "@/lib/format";
import { useApp } from "@/lib/store";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";

export function ContentMeta({
  item,
  className,
}: {
  item: ContentItem;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <CategoryBadge category={item.category} />
      <PlatformBadge platform={item.platform} />
      <span className="text-xs font-medium text-ink-muted">
        {dayLabel(item.day)} · {formatDate(item.date)}
      </span>
      {item.edited ? (
        <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-ink-muted">
          Diedit
        </span>
      ) : null}
    </div>
  );
}

function Section({
  label,
  icon,
  action,
  children,
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  /** A small control on the heading row, e.g. a copy link. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {icon}
          {label}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Copy, as a quiet link on a heading rather than a button.
 *
 * The CTA and the hashtags are pasted separately from the caption often enough
 * to deserve their own control — an owner writing an Instagram post puts the
 * hashtags in the first comment — but not often enough to earn a button the
 * size of "Salin caption".
 */
function CopyLink({
  label,
  copied,
  onClick,
}: {
  label: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-my-3 inline-flex items-center gap-1 py-3 text-xs font-semibold text-ink-soft transition-colors hover:text-ink"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Disalin" : label}
    </button>
  );
}

/**
 * The post itself. Ordered the way the owner uses it: the line that stops the
 * scroll, then the caption they will paste, then what to do and what to shoot.
 *
 * The three fields an owner would want to reword — hook, caption, CTA — are
 * editable in place. The rest are direction for whoever takes the photo, and
 * change with the day rather than with the wording.
 */
export function ContentBody({ item }: { item: ContentItem }) {
  const { copy, copiedKey } = useCopy();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <EditForm item={item} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-ink-muted">{item.objective}</p>

      <Section label="Hook">
        <p className="text-lg font-bold leading-snug tracking-tight text-ink sm:text-xl">
          {item.hook}
        </p>
      </Section>

      <Section label="Caption">
        <div className="rounded-[var(--radius-card)] border border-line bg-sunken p-4">
          <p className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink">
            {item.caption}
          </p>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-xs text-ink-muted">
              {item.caption.length} aksara
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copy(item.caption, "Caption disalin", "caption")}
              >
                {copiedKey === "caption" ? <Check /> : <Copy />}
                {copiedKey === "caption" ? "Disalin" : "Salin caption"}
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section
        label="Call to action"
        action={
          <CopyLink
            label="Salin CTA"
            copied={copiedKey === "cta"}
            onClick={() => copy(item.cta, "CTA disalin", "cta")}
          />
        }
      >
        <p className="text-[0.9375rem] font-semibold leading-relaxed text-ink">
          {item.cta}
        </p>
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section
          label="Idea gambar"
          icon={<ImageIcon className="size-3.5" aria-hidden />}
        >
          <p className="text-[0.9375rem] leading-relaxed text-ink-soft">
            {item.visualIdea}
          </p>
        </Section>

        {item.videoIdea ? (
          <Section
            label="Idea video"
            icon={<Video className="size-3.5" aria-hidden />}
          >
            <p className="text-[0.9375rem] leading-relaxed text-ink-soft">
              {item.videoIdea}
            </p>
          </Section>
        ) : null}
      </div>

      {item.designDirection ? (
        <Section
          label="Arahan design"
          icon={<Palette className="size-3.5" aria-hidden />}
        >
          <p className="text-[0.9375rem] leading-relaxed text-ink-soft">
            {item.designDirection}
          </p>
        </Section>
      ) : null}

      {item.hashtags.length > 0 ? (
        <Section
          label="Hashtag"
          action={
            <CopyLink
              label="Salin hashtag"
              copied={copiedKey === "hashtags"}
              onClick={() =>
                copy(
                  item.hashtags.map((tag) => `#${tag}`).join(" "),
                  "Hashtag disalin",
                  "hashtags",
                )
              }
            />
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {item.hashtags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-ink-soft"
              >
                #{tag}
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      <p className="rounded-[var(--radius-field)] border border-line bg-paper px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink-soft">Kenapa post ini:</span>{" "}
        {CATEGORY_META[item.category].purpose}
      </p>
    </div>
  );
}

/**
 * Editing one day's words.
 *
 * Saved to Firestore before the form closes, so what the owner sees afterwards
 * is what is stored. A failure leaves the form open with their text intact
 * rather than closing on a change that never landed.
 */
function EditForm({ item, onDone }: { item: ContentItem; onDone: () => void }) {
  const { editDay } = useApp();
  const [hook, setHook] = useState(item.hook);
  const [caption, setCaption] = useState(item.caption);
  const [cta, setCta] = useState(item.cta);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!caption.trim()) {
      toast.error("Caption tak boleh kosong.");
      return;
    }
    setBusy(true);
    try {
      await editDay(item.day, { hook, caption, cta });
      toast.success("Perubahan disimpan");
      onDone();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Tak dapat simpan perubahan. Cuba lagi.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
          Hook
        </span>
        <Textarea
          value={hook}
          onChange={(e) => setHook(e.target.value)}
          className="min-h-16 font-bold"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
          Caption
        </span>
        <Textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          className="min-h-44"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
          Call to action
        </span>
        <Textarea
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          className="min-h-16"
        />
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button block className="sm:flex-1" onClick={save} disabled={busy}>
          <Check />
          {busy ? "Menyimpan…" : "Simpan perubahan"}
        </Button>
        <Button
          block
          variant="ghost"
          className="sm:w-auto"
          onClick={onDone}
          disabled={busy}
        >
          <X />
          Batal
        </Button>
      </div>
    </div>
  );
}

/**
 * Copy-all and regenerate. Kept separate from the body so the dashboard and the
 * detail screen can lay them out differently without duplicating logic.
 */
export function ContentActions({
  item,
  className,
}: {
  item: ContentItem;
  className?: string;
}) {
  const { regenerateDay, pendingDays } = useApp();
  const { copy, copiedKey } = useCopy();
  const busy = pendingDays.includes(item.day);
  // `variantCount` 0 means the engine can always write another version; 1 means
  // this day has exactly one and there is nothing to swap to.
  const canRegenerate = item.variantCount !== 1;
  const showsVersion = item.variantCount > 1;

  // Regenerating writes to the database, so it can fail. When it does the day
  // reverts to what is actually saved and the owner is told, rather than being
  // left looking at a version that never landed.
  async function regenerate() {
    try {
      await regenerateDay(item.day);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Tak jadi jana semula.");
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          block
          className="sm:flex-1"
          onClick={() => copy(formatFullContent(item), "Semua disalin", "all")}
        >
          {copiedKey === "all" ? <Check /> : <Copy />}
          {copiedKey === "all" ? "Disalin" : "Salin semua"}
        </Button>
        <Button
          block
          variant="secondary"
          className="sm:flex-1"
          onClick={regenerate}
          disabled={busy || !canRegenerate}
          aria-live="polite"
        >
          <RefreshCw className={cn(busy && "animate-spin")} />
          {busy ? "Menjana…" : "Jana semula"}
        </Button>
      </div>
      {item.edited ? (
        <p className="text-center text-xs text-ink-muted sm:text-left">
          Anda dah edit hari ini. Jana semula akan ganti tulisan anda.
        </p>
      ) : showsVersion ? (
        <p className="text-center text-xs text-ink-muted sm:text-left">
          Versi {item.variantIndex + 1} daripada {item.variantCount}
        </p>
      ) : null}
    </div>
  );
}
