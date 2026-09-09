import type { Metadata } from "next";
import { Suspense } from "react";

import { PaymentResultView } from "@/components/payment-result-view";

export const metadata: Metadata = { title: "Status bayaran" };

export default function PaymentResultPage() {
  return (
    // `useSearchParams` suspends, and this page is nothing but a query string.
    <Suspense fallback={null}>
      <PaymentResultView />
    </Suspense>
  );
}
