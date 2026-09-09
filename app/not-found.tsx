import Link from "next/link";

import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm">
        <Wordmark className="text-lg" />
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-ink">
          Halaman ini tak wujud
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Mungkin pautan sudah lama atau tersalah taip.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href="/dashboard">Ke dashboard</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">Ke laman utama</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
