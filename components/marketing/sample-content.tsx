import { DEMO_RESTAURANT, MockContentGenerator } from "@/lib/content";
import { composeCreative } from "@/lib/creative";
import { CreativeCanvas } from "@/components/marketing/creative-canvas";
import { CategoryBadge, PlatformBadge } from "@/components/ui/badge";
import { dayLabel } from "@/lib/format";

/**
 * Sample days for the landing page, from the deterministic engine.
 *
 * The landing page has no signed-in owner and no restaurant, so it cannot — and
 * should not — call the AI engine: that would spend a generation on a visitor
 * who has not signed up, and it would make a static page depend on a provider
 * being up. The copy is real output for the demo restaurant, and the page says
 * so rather than presenting it as a customer's month.
 */
const SAMPLE_DAYS = [2, 6, 7];

export async function SampleContent() {
  const plan = await new MockContentGenerator().generatePlan({
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
 * The two halves of one day, side by side: the poster and the words.
 *
 * Both come out of the engine the app actually runs. The caption card is a
 * non-interactive replica of the dashboard's "today" card, and the poster is
 * `composeCreative` output painted by the same renderer the studio uses — not
 * a picture of a poster, but the poster. Showing them together is the point:
 * the caption is not printed on the design, because an owner pastes the
 * caption into the post and uploads the design as the image.
 *
 * No model is called to build either one. Composition is arrangement, and the
 * words were written by the deterministic demo generator at build time.
 */
export async function HeroPreview() {
  const plan = await new MockContentGenerator().generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-01-06",
  });
  const item = plan.items[0];
  // A fixed timestamp so the composed creative is identical on every build.
  const creative = composeCreative(DEMO_RESTAURANT, plan.id, item, {
    now: "2026-01-06T00:00:00.000Z",
  });

  return (
    <div className="grid gap-4 text-left sm:grid-cols-2 sm:items-start">
      <figure className="rounded-[calc(var(--radius-card)+4px)] border border-line bg-sunken p-2 shadow-[var(--shadow-raised)]">
        <p className="px-2 pb-2 pt-1 text-xs font-bold uppercase tracking-[0.08em] text-brand">
          Design siap
        </p>
        <CreativeCanvas
          creative={creative}
          label={`Contoh design untuk ${item.hook}`}
          className="rounded-[var(--radius-card)] border border-line"
        />
        <figcaption className="px-2 pb-1 pt-3 text-xs leading-relaxed text-ink-muted">
          Poster sebenar dari ContentKita — hook, CTA, nama dan warna kedai.
          Kotak bergaris tu tempat gambar anda sendiri; kami tak guna gambar
          orang lain.
        </figcaption>
      </figure>

      <div className="rounded-[calc(var(--radius-card)+4px)] border border-line bg-sunken p-2 shadow-[var(--shadow-raised)]">
        <p className="px-2 pb-2 pt-1 text-xs font-bold uppercase tracking-[0.08em] text-brand">
          Caption siap
        </p>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs font-semibold text-ink-muted">
              {dayLabel(item.day)}
            </span>
            <span className="flex items-center gap-2 sm:ml-auto">
              <CategoryBadge category={item.category} />
              <PlatformBadge platform={item.platform} />
            </span>
          </div>

          <p className="mt-4 text-lg font-bold leading-snug tracking-tight text-ink">
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
              Muat turun PNG
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
