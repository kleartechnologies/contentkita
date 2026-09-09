import Link from "next/link";

import { Wordmark } from "@/components/brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="space-y-1.5">
          <Wordmark />
          <p className="text-sm text-ink-muted">
            Dibina untuk peniaga makanan di Malaysia.
          </p>
        </div>
        <nav
          aria-label="Pautan kaki"
          className="flex flex-wrap items-center gap-x-5 text-sm font-medium text-ink-soft"
        >
          <Link href="/dashboard" className="py-2 hover:text-ink">
            Lihat contoh
          </Link>
          <Link href="/signup" className="py-2 hover:text-ink">
            Daftar
          </Link>
          <Link href="/login" className="py-2 hover:text-ink">
            Log masuk
          </Link>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-ink-muted sm:px-6">
          © {new Date().getFullYear()} ContentKita
        </p>
      </div>
    </footer>
  );
}
