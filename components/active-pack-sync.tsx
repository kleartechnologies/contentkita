"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { useApp } from "@/lib/store";

/**
 * Points the app at the pack named in `?packId=`.
 *
 * A link is a request, not an authorisation. `selectPack` ignores an id that
 * is not in the owner's own loaded list, so a hand-typed packId belonging to
 * somebody else selects nothing — and the security rules would refuse to read
 * it even if this were sloppier than it is.
 */
export function ActivePackSync() {
  const params = useSearchParams();
  const requested = params.get("packId");
  const { activePackId, packs, selectPack } = useApp();

  useEffect(() => {
    if (!requested || requested === activePackId) return;
    if (!packs.some((pack) => pack.id === requested)) return;
    selectPack(requested);
  }, [requested, activePackId, packs, selectPack]);

  return null;
}
