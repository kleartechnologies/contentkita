import type { Metadata } from "next";

import { CreativePack } from "@/components/creative-pack";

export const metadata: Metadata = { title: "Content Pack" };

/** `?packId=` is honoured by `ActivePackSync`, mounted in the layout above. */
export default function PackPage() {
  return <CreativePack />;
}
