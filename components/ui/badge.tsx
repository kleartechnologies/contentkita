import type * as React from "react";

import { CATEGORY_META, PLATFORM_LABEL, TINT_CLASS } from "@/lib/content";
import type { ContentCategory, Platform } from "@/lib/content";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none",
        className,
      )}
      {...props}
    />
  );
}

/** The colour-coded category chip used on every card and calendar row. */
export function CategoryBadge({
  category,
  className,
}: {
  category: ContentCategory;
  className?: string;
}) {
  const meta = CATEGORY_META[category];
  return (
    <Badge className={cn(TINT_CLASS[meta.tint], className)}>{meta.label}</Badge>
  );
}

export function PlatformBadge({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  return (
    <Badge className={cn("border-line bg-sunken text-ink-soft", className)}>
      {PLATFORM_LABEL[platform]}
    </Badge>
  );
}

/** A small square swatch of the category colour, for dense calendar rows. */
export function CategoryDot({
  category,
  className,
}: {
  category: ContentCategory;
  className?: string;
}) {
  const meta = CATEGORY_META[category];
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full border",
        TINT_CLASS[meta.tint],
        className,
      )}
    />
  );
}
