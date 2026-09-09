"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand";
import { AppProvider, useApp } from "@/lib/store";

/**
 * The client-side half of route protection.
 *
 * Firestore Security Rules are the real boundary — a signed-out browser cannot
 * read a single document no matter what it renders. This gate exists so the
 * *experience* matches: nobody sees an application shell they have no data for,
 * and an owner who has not finished onboarding is sent to finish it.
 */
export function AuthedArea({
  children,
  requireProfile = true,
}: {
  children: React.ReactNode;
  /** Onboarding sets this false: it is the one signed-in screen with no profile. */
  requireProfile?: boolean;
}) {
  return (
    <AppProvider>
      <Gate requireProfile={requireProfile}>{children}</Gate>
    </AppProvider>
  );
}

function Gate({
  children,
  requireProfile,
}: {
  children: React.ReactNode;
  requireProfile: boolean;
}) {
  const router = useRouter();
  const { authStatus, status, error, retry } = useApp();

  const signedOut = authStatus === "unauthenticated";
  const needsOnboarding = requireProfile && status === "needs-onboarding";
  // Onboarding is finished, so stop showing it.
  const alreadyOnboarded = !requireProfile && status === "ready";

  useEffect(() => {
    if (signedOut) router.replace("/login");
    else if (needsOnboarding) router.replace("/onboarding");
    else if (alreadyOnboarded) router.replace("/dashboard");
  }, [signedOut, needsOnboarding, alreadyOnboarded, router]);

  if (authStatus === "unknown" || signedOut) {
    return <FullScreen label="Sedang menyemak akaun anda…" />;
  }

  if (status === "error") {
    return <LoadFailed message={error} onRetry={retry} />;
  }

  if (needsOnboarding || alreadyOnboarded) {
    return <FullScreen label="Sekejap ya…" />;
  }

  if (status === "loading") {
    return <FullScreen label="Sedang memuatkan maklumat anda…" />;
  }

  return <>{children}</>;
}

function FullScreen({ label }: { label: string }) {
  return (
    <div
      className="grid min-h-dvh place-items-center bg-paper px-6 text-center"
      aria-busy="true"
    >
      <div>
        <Wordmark className="text-lg" />
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {label}
        </p>
      </div>
    </div>
  );
}

function LoadFailed({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto flex size-11 items-center justify-center rounded-[var(--radius-field)] border border-line bg-sunken text-ink-soft">
          <WifiOff className="size-5" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-bold tracking-tight text-ink">
          Tak dapat muat maklumat anda
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {message ?? "Ada masalah teknikal. Cuba lagi sekejap lagi."}
        </p>
        <Button className="mt-6" onClick={onRetry}>
          Cuba lagi
        </Button>
      </div>
    </div>
  );
}
