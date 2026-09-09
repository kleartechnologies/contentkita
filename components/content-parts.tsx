"use client";

import { Check, Copy, Image as ImageIcon, RefreshCw, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CategoryBadge, PlatformBadge } from "@/components/ui/badge";
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
    </div>
  );
}

function Section({
  label,
  icon,
  children,
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
        {icon}
        {label}
      </h3>
      {children}
    </section>
  );
}

/**
 * The post itself. Ordered the way the owner uses it: the line that stops the
 * scroll, then the caption they will paste, then what to do and what to shoot.
 */
export function ContentBody({ item }: { item: ContentItem }) {
  const { copy, copiedKey } = useCopy();

  return (
    <div className="space-y-5">
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
      </Section>

      <Section label="Call to action">
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

      <p className="rounded-[var(--radius-field)] border border-line bg-paper px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink-soft">Kenapa post ini:</span>{" "}
        {CATEGORY_META[item.category].purpose}
      </p>
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
  const hasVariants = item.variantCount > 1;

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
          onClick={() => regenerateDay(item.day)}
          disabled={busy || !hasVariants}
          aria-live="polite"
        >
          <RefreshCw className={cn(busy && "animate-spin")} />
          {busy ? "Menjana…" : "Jana semula"}
        </Button>
      </div>
      {hasVariants ? (
        <p className="text-center text-xs text-ink-muted sm:text-left">
          Versi {item.variantIndex + 1} daripada {item.variantCount}
        </p>
      ) : null}
    </div>
  );
}
