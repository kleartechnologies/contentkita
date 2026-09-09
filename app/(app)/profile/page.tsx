import type { Metadata } from "next";

import { ProfileForm } from "@/components/profile-form";

export const metadata: Metadata = { title: "Profil Restoran" };

export default function ProfilePage() {
  return <ProfileForm />;
}
