import Link from "next/link";

import { BrandLink } from "@/components/brand";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <BrandLink />
        <div className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Log Masuk</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Mula Sekarang</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
