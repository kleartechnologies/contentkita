import type { Metadata } from "next";

import { AuthedArea } from "@/components/auth-gate";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export const metadata: Metadata = { title: "Maklumat Restoran" };

/**
 * The one signed-in screen that runs without a restaurant profile — that is
 * precisely what it is here to create.
 */
export default function OnboardingPage() {
  return (
    <AuthedArea requireProfile={false}>
      <OnboardingWizard />
    </AuthedArea>
  );
}
