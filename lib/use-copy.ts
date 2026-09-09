"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Copy-to-clipboard with the bits that actually matter on a phone:
 * a fallback for browsers without the async clipboard API, and a short
 * confirmed state on the button itself so the owner knows it worked even if
 * they miss the toast.
 */
export function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string, message = "Disalin", key = "default") => {
      const ok = await writeToClipboard(text);
      if (!ok) {
        toast.error("Tak dapat salin", {
          description: "Cuba pilih teks dan salin secara manual.",
        });
        return false;
      }

      setCopiedKey(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedKey(null), 2000);
      toast.success(message);
      return true;
    },
    [],
  );

  return { copy, copiedKey };
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below (blocked permissions, http, …).
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
