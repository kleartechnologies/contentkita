import { AppShell } from "@/components/app-shell";
import { AuthedArea } from "@/components/auth-gate";

/**
 * Everything under this layout requires a signed-in owner with a saved
 * restaurant. `AuthedArea` provides the Firebase-backed state and turns anyone
 * else away before the shell renders.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthedArea>
      <AppShell>{children}</AppShell>
    </AuthedArea>
  );
}
