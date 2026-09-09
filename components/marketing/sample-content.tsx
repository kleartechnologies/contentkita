import { DEMO_RESTAURANT, getContentGenerator } from "@/lib/content";
import { CategoryBadge, PlatformBadge } from "@/components/ui/badge";
import { dayLabel } from "@/lib/format";

/**
 * Real output from the same engine the product uses — not marketing mock-ups.
 * A fixed start date keeps this page statically renderable and the copy stable.
 */
const SAMPLE_DAYS = [2, 6, 7];

export async function SampleContent() {
  const plan = await getContentGenerator().generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-01-06",
  });
  const samples = SAMPLE_DAYS.map(
    (day) => plan.items.find((item) => item.day === day)!,
  );

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {samples.map((item) => (
        <article
          key={item.id}
          className="flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={item.category} />
            <PlatformBadge platform={item.platform} />
          </div>

          <p className="mt-4 text-base font-bold leading-snug tracking-tight text-ink">
            {item.hook}
          </p>
          <p className="mt-2 line-clamp-5 whitespace-pre-line text-sm leading-relaxed text-ink-soft">
            {item.caption}
          </p>

          <div className="mt-4 flex-1" />
          <div className="border-t border-line pt-3">
            <p className="text-xs font-semibold text-ink-soft">{item.cta}</p>
            <p className="mt-2 text-xs text-ink-muted">
              {dayLabel(item.day)} · {item.videoIdea ? "Ada idea video" : "Ada idea gambar"}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * A non-interactive replica of the dashboard's "today" card, so the hero shows
 * the actual product instead of an abstract illustration.
 */
export async function HeroPreview() {
  const plan = await getContentGenerator().generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-01-06",
  });
  const item = plan.items[0];

  return (
    <div className="rounded-[calc(var(--radius-card)+4px)] border border-line bg-sunken p-2 shadow-[var(--shadow-raised)]">
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-left sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-brand">
            Content hari ini
          </span>
          <span className="flex items-center gap-2 sm:ml-auto">
            <CategoryBadge category={item.category} />
            <PlatformBadge platform={item.platform} />
          </span>
        </div>

        <p className="mt-4 text-lg font-bold leading-snug tracking-tight text-ink sm:text-xl">
          {item.hook}
        </p>
        <p className="mt-3 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-soft">
          {item.caption}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="inline-flex h-9 items-center rounded-[var(--radius-field)] bg-brand px-3.5 text-sm font-semibold text-white">
            Salin caption
          </span>
          <span className="inline-flex h-9 items-center rounded-[var(--radius-field)] border border-line-strong px-3.5 text-sm font-semibold text-ink-soft">
            Jana semula
          </span>
        </div>
      </div>
    </div>
  );
}
