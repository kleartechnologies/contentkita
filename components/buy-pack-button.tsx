"use client";

import { useState } from "react";
import { ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PACK_DAYS, priceLabel } from "@/lib/payment/product";
import { useApp } from "@/lib/store";

/**
 * The one button in the product that spends money.
 *
 * It asks our own server to start a purchase and then leaves for the page
 * Billplz hosts. Nothing about the price, the product or the customer travels
 * from here — the browser sends an id token and receives a URL, which is the
 * whole of its part in the transaction.
 *
 * There is no optimistic anything. The button does not grant a pack, does not
 * mark an order paid and does not believe the page it comes back to; a pack
 * appears when the signed callback says the money arrived.
 */

export const ONE_TIME_NOTE = "Sekali bayar. Tiada langganan. Tiada caj bulanan.";

/** "Jana 30 Hari Baru — RM39.90". The price is never written by hand. */
export const BUY_LABEL = `Jana ${PACK_DAYS} Hari Baru — ${priceLabel()}`;

export function BuyPackButton({
  label = BUY_LABEL,
  size = "lg",
  variant,
  block,
  className,
}: {
  label?: string;
  size?: "sm" | "md" | "lg";
  variant?: "quiet" | "ghost";
  block?: boolean;
  className?: string;
}) {
  const { buyPack } = useApp();
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const url = await buyPack();
      // A full navigation, not a router push: the destination is Billplz, not
      // a route of ours. `busy` is deliberately never cleared here — the page
      // is leaving, and a button that springs back to life first would invite
      // a second bill.
      window.location.assign(url);
    } catch (err) {
      setBusy(false);
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Tak dapat buka halaman bayaran sekarang. Cuba lagi sekejap lagi.",
      );
    }
  }

  return (
    <Button
      size={size}
      variant={variant}
      block={block}
      className={className}
      onClick={go}
      disabled={busy}
    >
      <ShoppingBag />
      {busy ? "Membuka halaman bayaran…" : label}
    </Button>
  );
}
