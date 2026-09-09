"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  ImagePlus,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import type { AssetRef, ContentItem } from "@/lib/content";
import {
  composeCreative,
  editText,
  isImage,
  isText,
  setImage,
  SYSTEM_FONTS,
  type Creative,
  type Fonts,
  type ImageBank,
  type ImageElement,
  type TextElement,
  type TextRole,
} from "@/lib/creative";
import {
  download,
  exportPng,
  fileNameFor,
  loadImages,
  paintPreview,
  resolveFonts,
} from "@/lib/creative/browser";
import { loadPackCreative, savePackCreative } from "@/lib/firebase/packs";
import { friendlyMessage } from "@/lib/firebase/errors";
import { uploadAsset, validateUpload } from "@/lib/firebase/storage";
import { useApp } from "@/lib/store";
import { useCopy } from "@/lib/use-copy";

/**
 * One finished post: the poster, and the two things an owner does with it.
 *
 * ## The poster is the screen
 *
 * The design comes first and it comes large. What sold the pack is the picture,
 * and a screen that opens with a name field, a format label and a column of
 * textareas is a design tool — which is the job the owner paid not to have.
 * So the editor is behind one button. It is still all there, and an owner who
 * wants to change a word can, but nothing about this screen suggests they need
 * to before posting.
 *
 * ## Nothing here is flattened
 *
 * Everything on screen is the same structured creative: the canvas draws it,
 * the fields edit it, the download button renders it again at full size. The
 * text is still text after it is saved, which is the whole reason the model in
 * `lib/creative/types.ts` looks the way it does.
 *
 * No model is called. The words on the poster were written during generation
 * and validated then; composition only chooses and arranges them.
 */

const ROLE_LABEL: Record<TextRole, string> = {
  headline: "Hook di poster",
  subheading: "Sub-tajuk",
  body: "Teks sokongan",
  cta: "Ajakan (CTA)",
  brand: "Nama restoran",
};

const FORMAT_LABEL: Record<Creative["format"], string> = {
  square: "Segi empat · 1080 × 1080",
  portrait: "Menegak · 1080 × 1350",
  story: "Story · 1080 × 1920",
};

export function CreativeStudio({
  item,
  /** Opens straight into the editor. The design workspace does; a post does not. */
  defaultEditing = false,
}: {
  item: ContentItem;
  defaultEditing?: boolean;
}) {
  const { user, profile, activePackId } = useApp();
  const { copy, copiedKey } = useCopy();
  const uid = user?.id ?? null;
  const itemId = item.id;
  // Designs belong to the pack their day belongs to. Since M5 an owner can have
  // several months at once, so "the owner's design for this day" is not a
  // location — `contentPacks/{uid}/packs/{packId}/creatives/{itemId}` is.
  const packId = activePackId;

  const [creative, setCreative] = useState<Creative | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [images, setImages] = useState<ImageBank>({});
  const [fonts, setFonts] = useState<Fonts>(SYSTEM_FONTS);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(defaultEditing);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Which picture the file dialog is about to replace. One input, several
  // slots: a collage has three, and three hidden inputs is three ways to open
  // the wrong one.
  const targetSlot = useRef<string | null>(null);
  const [stageWidth, setStageWidth] = useState(0);

  /* --- what we are editing ------------------------------------------------ */

  // Images are fetched at the two moments they can change — when a creative
  // arrives, and when the owner swaps the photo — rather than from an effect
  // that watches the creative, which would re-fetch on every keystroke.
  const refreshImages = useCallback(async (next: Creative) => {
    const bank = await loadImages(next);
    setImages(bank);
  }, []);

  /**
   * The day and the restaurant as they are now, readable without a re-render.
   *
   * The same pattern the store uses, for the same reason and one more: editing
   * a caption replaces the plan, and therefore the `item` object, on every
   * save. Keying the loader on the object identity would throw away a poster
   * the owner was halfway through editing because they fixed a typo elsewhere
   * on the page. It loads once per day, and "Kembali ke asal" is how new copy
   * is pulled in deliberately.
   */
  const latest = useRef({ profile, item });
  useEffect(() => {
    latest.current = { profile, item };
  }, [profile, item]);

  const ready = Boolean(uid && profile && packId);

  useEffect(() => {
    const owner = uid;
    const pack = packId;
    const restaurant = latest.current.profile;
    if (!ready || !owner || !pack || !restaurant) return;
    const day = latest.current.item;
    let cancelled = false;

    setLoading(true);
    setFailed(null);
    (async () => {
      try {
        const saved = await loadPackCreative(owner, pack, day.id);
        if (cancelled) return;
        // A day with nothing saved gets a design immediately, not an empty
        // screen with a "generate" button. The composition is deterministic,
        // so this costs nothing and the owner sees a poster on first visit.
        const next = saved ?? composeCreative(restaurant, day.planId, day);
        setCreative(next);
        setDirty(saved === null);
        setLoading(false);
        await refreshImages(next);
      } catch (err) {
        if (cancelled) return;
        setFailed(friendlyMessage(err));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, packId, ready, itemId, refreshImages]);

  useEffect(() => {
    let cancelled = false;
    resolveFonts().then((next) => {
      if (!cancelled) setFonts(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* --- drawing ------------------------------------------------------------ */

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageWidth(entry.contentRect.width);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !creative || stageWidth <= 0) return;
    // Placeholders only while the editor is open. An empty slot is a hint for
    // somebody editing; on a finished post it reads as a hole in the design.
    paintPreview(canvas, creative, {
      images,
      fonts,
      cssWidth: stageWidth,
      showPlaceholders: editing,
    });
  }, [creative, images, fonts, stageWidth, editing]);

  /* --- edits -------------------------------------------------------------- */

  function apply(next: Creative) {
    setCreative(next);
    setDirty(true);
  }

  async function choose(file: File | undefined) {
    const slotId = targetSlot.current;
    if (!file || !uid || !creative || !slotId) return;

    const problem = validateUpload("creative", file);
    if (problem) {
      toast.error(problem);
      return;
    }

    setUploading(slotId);
    try {
      const ref: AssetRef = await uploadAsset(uid, "creative", file);
      const next = setImage(creative, slotId, ref);
      apply(next);
      await refreshImages(next);
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setUploading(null);
      targetSlot.current = null;
      // So choosing the same file twice still fires a change event.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function clearImage(slot: ImageElement) {
    if (!creative) return;
    const next = setImage(creative, slot.id, null);
    apply(next);
    await refreshImages(next);
  }

  /** Rebuilds from the day's current copy, discarding every edit made here. */
  function reset() {
    const { profile: restaurant, item: day } = latest.current;
    if (!restaurant) return;
    apply(composeCreative(restaurant, day.planId, day));
    toast.success("Design dikembalikan ke asal.");
  }

  async function save() {
    if (!uid || !packId || !creative) return;
    setSaving(true);
    try {
      await savePackCreative(uid, packId, creative);
      setDirty(false);
      toast.success("Design disimpan.");
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function exportImage() {
    if (!creative) return;
    setExporting(true);
    try {
      const blob = await exportPng(creative, images, fonts);
      download(blob, fileNameFor(creative));
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setExporting(false);
    }
  }

  /* --- render ------------------------------------------------------------- */

  if (!uid || !profile) return null;

  if (loading) {
    return (
      <p
        className="flex items-center gap-2 py-8 text-sm text-ink-soft"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Sedang sediakan design…
      </p>
    );
  }

  if (failed || !creative) {
    return (
      <p role="alert" className="py-8 text-sm text-tint-rose-fg">
        {failed ?? "Design tak dapat disediakan."}
      </p>
    );
  }

  const texts = creative.elements.filter(isText);
  const slots = creative.elements.filter(isImage);

  return (
    <div className="space-y-4">
      <div
        ref={stageRef}
        className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-sunken"
      >
        <canvas
          ref={canvasRef}
          className="block h-auto w-full"
          role="img"
          aria-label={`Design untuk ${creative.name}`}
        />
      </div>

      {/* The two things an owner does with a finished post, then the way in
          for the one who wants to change something. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          id="creative-download"
          block
          className="sm:flex-1"
          onClick={exportImage}
          disabled={exporting}
        >
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          Muat turun
        </Button>
        <Button
          block
          variant="secondary"
          className="sm:flex-1"
          onClick={() => copy(item.caption, "Caption disalin", "caption")}
        >
          {copiedKey === "caption" ? <Check /> : <Copy />}
          {copiedKey === "caption" ? "Disalin" : "Salin caption"}
        </Button>
        <Button
          block
          variant="ghost"
          className="sm:w-auto"
          onClick={() => setEditing((open) => !open)}
          aria-expanded={editing}
        >
          {editing ? <X /> : <Pencil />}
          {editing ? "Tutup edit" : "Edit"}
        </Button>
      </div>

      {dirty && !editing ? (
        <p className="text-xs text-ink-muted">
          Ada perubahan yang belum disimpan. Buka “Edit” untuk simpan.
        </p>
      ) : null}

      {editing ? (
        <div className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {dirty ? "Simpan design" : "Tersimpan"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              <RotateCcw />
              Kembali ke asal
            </Button>
          </div>

          <div>
            <Label htmlFor="creative-name">Nama design</Label>
            <Input
              id="creative-name"
              className="mt-1.5"
              value={creative.name}
              onChange={(e) => apply({ ...creative, name: e.target.value })}
              maxLength={80}
            />
            <p className="mt-1.5 text-xs text-ink-muted">
              {FORMAT_LABEL[creative.format]} · nama fail bila dimuat turun
            </p>
          </div>

          {slots.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                {slots.length > 1 ? `Gambar (${slots.length})` : "Gambar"}
              </h3>
              {slots.map((slot, index) => (
                <PhotoSlot
                  key={slot.id}
                  slot={slot}
                  index={index}
                  total={slots.length}
                  busy={uploading === slot.id}
                  onPick={() => {
                    targetSlot.current = slot.id;
                    fileRef.current?.click();
                  }}
                  onClear={() => clearImage(slot)}
                />
              ))}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </section>
          ) : null}

          <section className="space-y-4">
            <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
              Teks di poster
            </h3>
            {texts.map((text) => (
              <TextField
                key={text.id}
                element={text}
                onChange={(value) => apply(editText(creative, text.id, value))}
              />
            ))}
            <p className="text-xs leading-relaxed text-ink-muted">
              Caption penuh dan hashtag kekal di luar poster — poster hanya bawa
              mesej utama supaya senang dibaca.
            </p>
          </section>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One picture in the design.
 *
 * Numbered when there is more than one, because a collage's three frames are
 * three separate decisions and "Gambar" three times over is a guessing game.
 */
function PhotoSlot({
  slot,
  index,
  total,
  busy,
  onPick,
  onClear,
}: {
  slot: ImageElement;
  index: number;
  total: number;
  busy: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  const has = Boolean(slot.source);

  return (
    <div className="rounded-[var(--radius-field)] border border-dashed border-line-strong bg-paper p-3.5">
      <p className="text-sm leading-relaxed text-ink-soft">
        {total > 1 ? (
          <span className="font-semibold text-ink">Gambar {index + 1}. </span>
        ) : null}
        {has
          ? "Gambar anda sedang digunakan."
          : /* Deliberately empty rather than filled with a stock photo: a
               picture of somebody else's food presented as theirs is the same
               problem as an invented promotion. */
            "Belum ada gambar. Muat naik gambar makanan anda sendiri — kami tak letak gambar orang lain."}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onPick}
          disabled={busy}
        >
          {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
          {has ? "Tukar gambar" : "Muat naik gambar"}
        </Button>
        {has ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClear}
            disabled={busy}
          >
            <Trash2 />
            Buang
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One editable line of the poster.
 *
 * A textarea rather than an input because a headline wraps, and seeing the
 * break while typing is the difference between a poster that fits and one that
 * shrinks itself to fit.
 */
function TextField({
  element,
  onChange,
}: {
  element: TextElement;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={`creative-text-${element.id}`}>
        {ROLE_LABEL[element.role]}
      </Label>
      <Textarea
        id={`creative-text-${element.id}`}
        className="mt-1.5 min-h-16"
        rows={2}
        value={element.text}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
