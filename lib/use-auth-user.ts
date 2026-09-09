"use client";

import { useEffect, useState } from "react";

import { getAuthClient, type AuthUser } from "@/lib/auth";

export type AuthPhase = "unknown" | "authenticated" | "unauthenticated";

/**
 * Auth state on its own, with no Firestore loading attached.
 *
 * The signed-in screens get this through `useApp()`, which also loads the
 * restaurant and the plan. Login and signup only need to know whether somebody
 * is already signed in — they have no business fetching that owner's data — so
 * they subscribe directly.
 */
export function useAuthUser(): { phase: AuthPhase; user: AuthUser | null } {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [phase, setPhase] = useState<AuthPhase>("unknown");

  useEffect(() => {
    return getAuthClient().subscribe((next) => {
      setUser(next);
      setPhase(next ? "authenticated" : "unauthenticated");
    });
  }, []);

  return { phase, user };
}
