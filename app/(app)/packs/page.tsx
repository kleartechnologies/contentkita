import type { Metadata } from "next";

import { PackListView } from "@/components/pack-list-view";

export const metadata: Metadata = { title: "Content Saya" };

export default function PacksPage() {
  return <PackListView />;
}
