"use client";

import Link from "next/link";
import { ChevronRight, Video } from "lucide-react";

import { CategoryDot } from "@/components/ui/badge";
import { CATEGORY_META, PLATFORM_LABEL, type ContentItem } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The 30-day plan as a scannable list. A calendar grid loses the hook, and the
 * hook is the thing an owner actually recognises a day by.
 */
export function PlanList({
  items,
  todayDay,
}: {
  items: ContentItem[];
  todayDay: number;
}) {
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {items.map((item) => {
        const isToday = item.day === todayDay;
        const isPast = item.day < todayDay;
        return (
          <li key={item.id}>
            <Link
              href={`/content/${item.id}`}
              className={cn(
                "flex items-center gap-3 px-4 py-3.5 transition-colors sm:gap-4 sm:px-5",
                isToday ? "bg-brand-tint" : "hover:bg-sunken",
              )}
            >
              <div
                className={cn(
                  "flex size-11 shrink-0 flex-col items-center justify-center rounded-[var(--radius-field)] border text-center leading-none",
                  isToday
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-paper text-ink-soft",
                  isPast && !isToday && "opacity-60",
                )}
              >
                <span className="text-[0.5625rem] font-bold uppercase tracking-wide opacity-75">
                  Hari
                </span>
                <span className="text-base font-extrabold">{item.day}</span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <CategoryDot category={item.category} />
                  <span className="truncate text-xs font-semibold text-ink-soft">
                    {CATEGORY_META[item.category].label}
                  </span>
                  <span className="text-xs text-ink-muted">·</span>
                  <span className="truncate text-xs text-ink-muted">
                    {formatDate(item.date)}
                  </span>
                  {item.videoIdea ? (
                    <Video
                      className="size-3.5 shrink-0 text-ink-muted"
                      aria-label="Ada idea video"
                    />
                  ) : null}
                </div>
                <p
                  className={cn(
                    "mt-1 line-clamp-2 text-[0.9375rem] font-semibold leading-snug",
                    isToday ? "text-brand-ink" : "text-ink",
                  )}
                >
                  {item.hook}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  {PLATFORM_LABEL[item.platform]}
                </p>
              </div>

              <ChevronRight
                className="size-4 shrink-0 text-ink-muted"
                aria-hidden
              />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
