import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The wordmark. Deliberately typographic — a temporary mark that looks
 * intentional rather than a placeholder logo waiting to be replaced.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-[1.0625rem] font-extrabold tracking-tight text-ink",
        className,
      )}
    >
      Content<span className="text-brand">Kita</span>
    </span>
  );
}

export function BrandLink({
  href = "/",
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center rounded-md focus-visible:outline-offset-4",
        className,
      )}
      aria-label="ContentKita"
    >
      <Wordmark />
    </Link>
  );
}
