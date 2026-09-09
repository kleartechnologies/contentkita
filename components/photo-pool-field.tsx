"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AssetRef } from "@/lib/content";
import { friendlyMessage } from "@/lib/firebase/errors";
import {
  UPLOAD_SPECS,
  deleteAsset,
  uploadAsset,
  validateUpload,
} from "@/lib/firebase/storage";
import { cn } from "@/lib/utils";

/**
 * The restaurant's own photographs — the single most valuable thing an owner
 * gives us.
 *
 * Deliberately not `UploadField` in a loop. That component owns one slot and
 * replaces what is in it; this is a pool, where the interesting operations are
 * "add several at once" and "get rid of that blurry one". They only look alike.
 *
 * Uploads run one file at a time. A phone on a shop's wifi handed eight
 * simultaneous 5MB uploads finishes them all late; sequentially, the first
 * photo is on screen in a couple of seconds and the owner can see the thing is
 * working.
 */

/** Enough for the month to vary without turning the form into a photo manager. */
export const MAX_PHOTOS = 12;

export function PhotoPoolField({
  uid,
  value,
  onChange,
  className,
}: {
  uid: string;
  value: AssetRef[];
  onChange: (next: AssetRef[]) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const spec = UPLOAD_SPECS.creative;
  const room = MAX_PHOTOS - value.length;

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const chosen = [...files].slice(0, Math.max(room, 0));
    if (chosen.length === 0) {
      setError(`Anda dah ada ${MAX_PHOTOS} gambar. Buang satu dulu.`);
      return;
    }

    // Validated up front, so a bad file in the middle of a batch does not stop
    // the good ones behind it from being offered.
    const ok: File[] = [];
    let rejected: string | null = null;
    for (const file of chosen) {
      const problem = validateUpload("creative", file);
      if (problem) rejected = problem;
      else ok.push(file);
    }

    setBusy({ done: 0, total: ok.length });
    const added: AssetRef[] = [];
    try {
      for (const file of ok) {
        added.push(await uploadAsset(uid, "creative", file));
        setBusy({ done: added.length, total: ok.length });
        // Committed as each one lands, so an owner who navigates away mid-batch
        // keeps the photos that already uploaded.
        onChange([...value, ...added]);
      }
      if (rejected) setError(rejected);
      if (files.length > chosen.length) {
        setError(`Kami ambil ${chosen.length} gambar sahaja — had ${MAX_PHOTOS}.`);
      }
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(photo: AssetRef) {
    onChange(value.filter((p) => p.path !== photo.path));
    await deleteAsset(photo);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-ink">
          Gambar restoran anda
        </span>
        <span className="text-xs font-medium text-ink-muted">
          {value.length > 0 ? `${value.length} / ${MAX_PHOTOS}` : "Pilihan"}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-ink-soft">
        Gambar makanan, dapur, kedai, staf — apa sahaja yang betul-betul milik
        anda. Kami guna gambar ini pada poster anda, dengan potongan dan susun
        atur berbeza setiap kali. Tiga empat keping pun sudah memadai; kami tak
        akan letak gambar orang lain sebagai makanan anda.
      </p>

      <div
        className={cn(
          "rounded-[var(--radius-field)] border border-dashed border-line-strong bg-surface p-4",
          error && "border-tint-rose-line bg-tint-rose",
        )}
      >
        {value.length > 0 ? (
          <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {value.map((photo, i) => (
              <li
                key={photo.path}
                className="group relative aspect-square overflow-hidden rounded-[var(--radius-field)] border border-line bg-sunken"
              >
                {/* Storage download URLs are not a build-time known host, and
                    these are small square thumbnails. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.name || `Gambar ${i + 1}`}
                  className="size-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => remove(photo)}
                  aria-label={`Buang gambar ${i + 1}`}
                  className="absolute right-1 top-1 rounded-full bg-ink/70 p-1.5 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {busy ? (
          <p
            aria-live="polite"
            className="flex items-center gap-2 text-sm font-medium text-ink"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Memuat naik gambar {Math.min(busy.done + 1, busy.total)} daripada{" "}
            {busy.total}…
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Camera className="size-6 shrink-0 text-ink-muted" aria-hidden />
            <p className="flex-1 text-sm text-ink-soft">
              {value.length > 0
                ? "Tambah lagi supaya bulan anda nampak lebih pelbagai."
                : "Pilih beberapa gambar sekali gus."}
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              disabled={room <= 0}
              onClick={() => input.current?.click()}
            >
              <Upload />
              {value.length > 0 ? "Tambah" : "Pilih gambar"}
            </Button>
          </div>
        )}

        <input
          ref={input}
          type="file"
          multiple
          accept={spec.acceptAttribute}
          className="sr-only"
          onChange={(e) => add(e.target.files)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium text-tint-rose-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
