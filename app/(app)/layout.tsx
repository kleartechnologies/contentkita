import { Suspense } from "react";

import { ActivePackSync } from "@/components/active-pack-sync";
import { AppShell } from "@/components/app-shell";
import { AuthedArea } from "@/components/auth-gate";

/**
 * Everything under this layout requires a signed-in owner with a saved
 * restaurant. `AuthedArea` provides the Firebase-backed state and turns anyone
 * else away before the shell renders.
 *
 * `ActivePackSync` sits here rather than on one page because a `?packId=` may
 * arrive on any of them — a pack link, a day link, the page a customer lands
 * on after paying — and a link that names a pack should open that pack whether
 * or not the app was already running. It reads the query string, so it is
 * wrapped in its own Suspense boundary and the page below never waits for it.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthedArea>
      <Suspense fallback={null}>
        <ActivePackSync />
      </Suspense>
      <AppShell>{children}</AppShell>
    </AuthedArea>
  );
}
