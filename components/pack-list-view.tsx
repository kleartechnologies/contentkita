"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Layers, TriangleAlert } from "lucide-react";

import { BuyPackButton, ONE_TIME_NOTE } from "@/components/buy-pack-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { monthlyPackName } from "@/lib/packs/codecs";
import type { PackSummary } from "@/lib/packs/types";
import { PACK_DAYS } from "@/lib/payment/product";
import { useApp } from "@/lib/store";

/**
 * "Content Saya" — every pack this owner has, newest first.
 *
 * The screen that only exists because a purchase makes a pack rather than
 * replacing one. An owner who has bought three months has three rows here, the
 * oldest as intact as the day it was written.
 *
 * Nothing on this screen shows an order id, a bill id or a payment reference.
 * A pack is named by its month or by whatever the owner called it; the
 * plumbing of the transaction is not something they should have to read.
 */

interface Tone {
  readonly label: string;
  readonly className: string;
  readonly Icon: typeof CheckCircle2;
}

function toneFor(pack: PackSummary): Tone {
  if (pack.paymentStatus !== "paid") {
    return {
      label: "Menunggu bayaran",
      className: "bg-tint-amber text-tint-amber-fg",
      Icon: Clock,
    };
  }
  switch (pack.generationStatus) {
    case "ready":
      return {
        label: `${pack.written} hari siap`,
        className: "bg-tint-teal text-tint-teal-fg",
        Icon: CheckCircle2,
      };
    case "generating":
      return {
        label: "Sedang dijana",
        className: "bg-brand-tint text-brand-ink",
        Icon: Clock,
      };
    case "partial":
      return {
        label: `${pack.written} daripada ${pack.days} hari`,
        className: "bg-tint-amber text-tint-amber-fg",
        Icon: TriangleAlert,
      };
    case "failed":
      return {
        label: "Belum siap — cuba jana semula",
        className: "bg-tint-rose text-tint-rose-fg",
        Icon: TriangleAlert,
      };
    default:
      return {
        label: "Belum dijana",
        className: "bg-tint-amber text-tint-amber-fg",
        Icon: Clock,
      };
  }
}

export function PackListView() {
  const { status, packs, activePackId, selectPack } = useApp();

  if (status === "loading") return <PackListSkeleton />;

  return (
    <div className="space-y-6">
      <header className="ck-rise">
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          <Layers className="size-5 text-ink-muted" aria-hidden />
          Content Saya
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          {packs.length === 0
            ? `Anda belum ada pack. Setiap pembelian memberi anda satu pack ${PACK_DAYS} hari.`
            : `${packs.length} pack. Setiap pembelian menambah pack baharu — yang lama kekal seperti sedia ada.`}
        </p>
      </header>

      {packs.length > 0 ? (
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {packs.map((pack) => {
            const tone = toneFor(pack);
            const name = pack.name || monthlyPackName(pack.createdAt, pack.days);
            return (
              <li key={pack.id} className="border-b border-line last:border-0">
                <Link
                  href={`/pack?packId=${encodeURIComponent(pack.id)}`}
                  onClick={() => selectPack(pack.id)}
                  className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-paper"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[0.9375rem] font-bold text-ink">
                        {name}
                      </span>
                      {pack.source === "legacy" ? (
                        <span className="rounded-full bg-line px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-soft">
                          Content asal anda
                        </span>
                      ) : null}
                      {pack.id === activePackId ? (
                        <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[0.6875rem] font-semibold text-brand-ink">
                          Sedang dibuka
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${tone.className}`}
                    >
                      <tone.Icon className="size-3.5" aria-hidden />
                      {tone.label}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-center">
        <div className="flex justify-center">
          <BuyPackButton size={packs.length === 0 ? "lg" : "md"} />
        </div>
        <p className="mt-2.5 text-xs text-ink-muted">{ONE_TIME_NOTE}</p>
      </section>

      <div className="flex justify-center">
        <Button asChild variant="quiet" size="sm">
          <Link href="/dashboard">Kembali ke dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

function PackListSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Sedang memuatkan pack anda…</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 border-b border-line px-4 py-4 last:border-0">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
