"use client";

import { useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AssetRef } from "@/lib/content";
import { friendlyMessage } from "@/lib/firebase/errors";
import {
  UPLOAD_SPECS,
  deleteAsset,
  uploadAsset,
  validateUpload,
  type UploadKind,
} from "@/lib/firebase/storage";
import { cn } from "@/lib/utils";

/**
 * One file, uploaded and replaceable.
 *
 * Four states, all visible: nothing chosen, uploading (with the real byte
 * count), uploaded, and failed. The failure state keeps the previous file — a
 * failed replacement must never leave an owner with less than they started
 * with.
 */

interface UploadFieldProps {
  uid: string;
  kind: UploadKind;
  label: string;
  hint: string;
  value: AssetRef | null;
  onChange: (next: AssetRef | null) => void;
  /** Menu files can be removed entirely; a logo is only ever replaced. */
  removable?: boolean;
}

export function UploadField({
  uid,
  kind,
  label,
  hint,
  value,
  onChange,
  removable = true,
}: UploadFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const spec = UPLOAD_SPECS[kind];
  const busy = progress !== null;

  async function choose(file: File | undefined) {
    if (!file) return;
    const problem = validateUpload(kind, file);
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setProgress(0);
    const previous = value;
    try {
      const next = await uploadAsset(uid, kind, file, {
        onProgress: setProgress,
      });
      onChange(next);
      // Only once the new file is safely stored. Deleting first would leave an
      // owner with nothing if the upload then failed.
      if (previous && previous.path !== next.path) await deleteAsset(previous);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setProgress(null);
      // Cleared so choosing the same file again still fires a change event.
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    const previous = value;
    onChange(null);
    await deleteAsset(previous);
  }

  const Icon = kind === "logo" ? ImageIcon : FileText;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="text-xs font-medium text-ink-muted">Pilihan</span>
      </div>

      <div
        className={cn(
          "rounded-[var(--radius-field)] border border-dashed border-line-strong bg-surface p-4",
          error && "border-tint-rose-line bg-tint-rose",
        )}
      >
        {busy ? (
          <div aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Memuat naik… {progress}%
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full bg-brand transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : value ? (
          <div className="flex items-center gap-3">
            {kind === "logo" && value.url ? (
              /* A Storage download URL is not a build-time known host, and this
                 preview is a fixed 48px thumbnail that gains nothing from
                 optimisation. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value.url}
                alt=""
                className="size-12 shrink-0 rounded-[var(--radius-field)] border border-line object-cover"
              />
            ) : (
              <Icon className="size-6 shrink-0 text-ink-muted" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {value.name || "Fail dimuat naik"}
              </p>
              <p className="text-xs text-ink-muted">
                {formatSize(value.size)} · Sudah tersimpan
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => input.current?.click()}
              >
                Tukar
              </Button>
              {removable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={remove}
                  aria-label={`Buang ${label}`}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Icon className="size-6 shrink-0 text-ink-muted" aria-hidden />
            <p className="flex-1 text-sm text-ink-soft">{hint}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => input.current?.click()}
            >
              <Upload />
              Pilih fail
            </Button>
          </div>
        )}

        <input
          ref={input}
          type="file"
          accept={spec.acceptAttribute}
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0])}
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

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
