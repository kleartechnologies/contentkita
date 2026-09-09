"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { loadOrder } from "@/lib/firebase/packs";
import { PACK_DAYS } from "@/lib/payment/product";
import { useApp } from "@/lib/store";

/**
 * Where Billplz sends the customer back to.
 *
 * ## This page is not the payment authority
 *
 * Billplz appends its own parameters to this URL, and they are ignored — every
 * one of them. A redirect is a browser being told where to go next; anybody can
 * type it, and a `paid=true` in a query string is a claim from the address bar,
 * not from a payment processor. The only thing read out of the URL here is
 * `order`, which is an id and settles nothing.
 *
 * The answer comes from our own order document, which the customer can read and
 * cannot write, and which is only ever set to `paid` by the callback route
 * after it has verified an X Signature. This page waits for that to happen.
 *
 * ## Why the waiting is bounded
 *
 * The callback usually lands before the customer's browser does, but not
 * always. So the page checks a fixed number of times over about a minute and
 * then stops, saying plainly that the payment is still being confirmed rather
 * than spinning forever or — much worse — deciding for itself that it failed.
 * Nothing here creates a pack, and nothing here gives up on a paid order:
 * a payment confirmed later still produces the pack, without the customer
 * having to be on this page for it.
 */

/** About a minute, in steps a person does not experience as a freeze. */
const ATTEMPTS = 20;
const INTERVAL_MS = 3000;

type Phase = "checking" | "paid" | "unsettled" | "failed" | "missing";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function PaymentResultView() {
  const params = useSearchParams();
  const orderId = params.get("order") ?? "";
  const { refreshPacks, selectPack } = useApp();

  const [phase, setPhase] = useState<Phase>("checking");

  const [packId, setPackId] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  const checkAgain = useCallback(() => setRound((n) => n + 1), []);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;

    (async () => {
      setPhase("checking");
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (cancelled) return;

        // A read failure is not an answer. It is treated exactly like "not
        // settled yet" so a flaky moment never turns into "your payment
        // failed" in front of somebody whose card has been charged.
        const order = await loadOrder(orderId).catch(() => null);
        if (cancelled) return;

        if (order?.paymentStatus === "paid") {
          setPackId(order.packId);
          setPhase("paid");
          // The pack now exists. Pull it in and open it, so the next screen is
          // the one they paid for rather than a list they have to hunt through.
          await refreshPacks().catch(() => {});
          if (!cancelled && order.packId) selectPack(order.packId);
          return;
        }

        if (
          order?.paymentStatus === "failed" ||
          order?.paymentStatus === "cancelled"
        ) {
          setPhase("failed");
          return;
        }

        await wait(INTERVAL_MS);
      }

      if (!cancelled) setPhase("unsettled");
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, round, refreshPacks, selectPack]);

  // A missing order id is a property of the URL, not something to be recorded
  // in state: there is nothing to poll and nothing to change its mind.
  const shown: Phase = orderId ? phase : "missing";

  return (
    <div className="mx-auto max-w-md space-y-6 py-6">
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center shadow-[var(--shadow-raised)]">
        {shown === "checking" ? (
          <Waiting />
        ) : shown === "paid" ? (
          <Paid packId={packId} />
        ) : shown === "failed" ? (
          <Failed />
        ) : shown === "missing" ? (
          <Missing />
        ) : (
          <Unsettled onCheck={checkAgain} />
        )}
      </section>
    </div>
  );
}

function Waiting() {
  return (
    <>
      <div className="mx-auto grid size-11 place-items-center rounded-[var(--radius-field)] bg-brand-tint text-brand-ink">
        <Loader2 className="size-5 animate-spin" aria-hidden />
      </div>
      <h1
        className="mt-4 text-base font-bold tracking-tight text-ink"
        aria-live="polite"
      >
        Bayaran sedang disahkan…
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
        Kami sedang menunggu pengesahan daripada Billplz. Jangan tutup halaman
        ini — biasanya ambil beberapa saat sahaja.
      </p>
    </>
  );
}

function Paid({ packId }: { packId: string | null }) {
  return (
    <>
      <div className="mx-auto grid size-11 place-items-center rounded-[var(--radius-field)] bg-tint-teal text-tint-teal-fg">
        <CheckCircle2 className="size-5" aria-hidden />
      </div>
      <h1
        className="mt-4 text-base font-bold tracking-tight text-ink"
        aria-live="polite"
      >
        Bayaran anda dah disahkan
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
        Pack {PACK_DAYS} hari anda dah sedia. Tekan butang di bawah untuk jana
        content — tiada caj tambahan.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <Button asChild size="lg">
          <Link href="/dashboard">Jana content sekarang</Link>
        </Button>
        <Button asChild variant="quiet" size="sm">
          <Link href={packId ? `/pack?packId=${encodeURIComponent(packId)}` : "/packs"}>
            Lihat pack saya
          </Link>
        </Button>
      </div>
    </>
  );
}

function Unsettled({ onCheck }: { onCheck: () => void }) {
  return (
    <>
      <div className="mx-auto grid size-11 place-items-center rounded-[var(--radius-field)] bg-tint-amber text-tint-amber-fg">
        <Loader2 className="size-5" aria-hidden />
      </div>
      <h1
        className="mt-4 text-base font-bold tracking-tight text-ink"
        aria-live="polite"
      >
        Bayaran masih dalam pengesahan
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
        Pengesahan daripada Billplz belum sampai. Kalau bayaran anda berjaya,
        pack akan muncul dengan sendirinya — anda tidak perlu bayar lagi.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <Button onClick={onCheck}>
          <RefreshCw />
          Semak semula
        </Button>
        <Button asChild variant="quiet" size="sm">
          <Link href="/packs">Buka Content Saya</Link>
        </Button>
      </div>
    </>
  );
}

function Failed() {
  return (
    <>
      <div className="mx-auto grid size-11 place-items-center rounded-[var(--radius-field)] bg-tint-rose text-tint-rose-fg">
        <TriangleAlert className="size-5" aria-hidden />
      </div>
      <h1
        className="mt-4 text-base font-bold tracking-tight text-ink"
        aria-live="polite"
      >
        Bayaran tidak berjaya
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
        Tiada apa-apa yang dicaj. Anda boleh cuba lagi bila-bila masa.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <Button asChild>
          <Link href="/packs">Cuba beli semula</Link>
        </Button>
        <Button asChild variant="quiet" size="sm">
          <Link href="/dashboard">Kembali ke dashboard</Link>
        </Button>
      </div>
    </>
  );
}

function Missing() {
  return (
    <>
      <div className="mx-auto grid size-11 place-items-center rounded-[var(--radius-field)] bg-tint-amber text-tint-amber-fg">
        <TriangleAlert className="size-5" aria-hidden />
      </div>
      <h1 className="mt-4 text-base font-bold tracking-tight text-ink">
        Tiada maklumat pesanan
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
        Halaman ini dibuka tanpa rujukan pesanan. Semua pack anda ada dalam
        Content Saya.
      </p>
      <div className="mt-5 flex justify-center">
        <Button asChild>
          <Link href="/packs">Buka Content Saya</Link>
        </Button>
      </div>
    </>
  );
}
