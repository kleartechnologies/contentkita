import type { Metadata } from "next";

import { CreativePack } from "@/components/creative-pack";

export const metadata: Metadata = { title: "Content Pack" };

export default function PackPage() {
  return <CreativePack />;
}
