"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Store } from "lucide-react";

import { BrandLink } from "@/components/brand";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: CalendarDays },
  { href: "/profile", label: "Profil", icon: Store },
] as const;

/**
 * Chrome for the signed-in screens: a sticky header on every size, plus a
 * thumb-reachable tab bar on phones. The tab bar is fixed, so the main region
 * carries matching bottom padding to keep the last card clear of it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile } = useApp();

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <BrandLink href="/dashboard" />

          <nav className="hidden items-center gap-1 sm:flex" aria-label="Utama">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-[var(--radius-field)] px-3 py-2 text-sm font-semibold transition-colors",
                    active
                      ? "bg-brand-tint text-brand-ink"
                      : "text-ink-soft hover:bg-sunken hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <span className="max-w-[45%] truncate text-sm font-semibold text-ink-soft sm:hidden">
            {profile?.name ?? ""}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pb-16 sm:pt-8">
        {children}
      </main>

      <nav
        aria-label="Utama"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md sm:hidden"
      >
        <div className="mx-auto flex max-w-md">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2.5 text-xs font-semibold transition-colors",
                  active ? "text-brand" : "text-ink-muted",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
