"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { BrandLink } from "@/components/brand";
import { PhotoPoolField } from "@/components/photo-pool-field";
import { UploadField } from "@/components/upload-field";
import { Button } from "@/components/ui/button";
import { ChoiceGrid, ChoiceGroup } from "@/components/ui/choice";
import { Field, Input, Textarea } from "@/components/ui/field";
import { TagInput } from "@/components/ui/tag-input";
import {
  COPY_STYLE_OPTIONS,
  EMPTY_PROFILE,
  LANGUAGE_OPTIONS,
  PLATFORM_OPTIONS,
  TONE_OPTIONS,
  VISUAL_STYLE_OPTIONS,
  type BrandTone,
  type ContentLanguage,
  type CopyStyle,
  type Platform,
  type RestaurantProfile,
  type VisualStyle,
} from "@/lib/content";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * The one time an owner is asked everything.
 *
 * Five steps, in the order somebody actually thinks about their own shop: what
 * it is, what it sells, what it looks like, how it should look, how it talks.
 * Every question is phrased
 * the way it would be asked across a counter — there is no "brand positioning"
 * or "content pillar" anywhere on this screen, because the person filling it in
 * runs a kedai, not a marketing department.
 *
 * Only three answers are required. Everything else may be left blank, and a
 * blank answer is honoured: the generator is told the fact is missing and
 * writes around it rather than inventing something plausible.
 */

const STEPS = [
  { title: "Kenali restoran anda", blurb: "Asas yang kami perlukan untuk mula." },
  { title: "Menu & promosi", blurb: "Apa yang orang datang untuk makan." },
  {
    title: "Gambar restoran anda",
    blurb: "Bahan mentah untuk setiap poster anda.",
  },
  { title: "Brand & gaya content", blurb: "Macam mana content anda patut nampak." },
  { title: "Style copywriting", blurb: "Macam mana anda nak bercakap." },
] as const;

type Draft = Omit<RestaurantProfile, "id" | "createdAt" | "updatedAt">;

export function OnboardingWizard() {
  const router = useRouter();
  const { user, completeOnboarding } = useApp();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // This screen only ever runs for an owner with no restaurant saved yet —
  // anyone who has finished is sent to the dashboard — so it starts blank.
  // Editing an existing restaurant happens on the profile screen.
  const [draft, setDraft] = useState<Draft>(() => EMPTY_PROFILE(""));

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  }

  function problemWith(index: number): string | null {
    if (index === 0) {
      if (!draft.name.trim()) return "Sila isi nama restoran anda.";
      if (!draft.cuisine.trim()) return "Sila isi jenis masakan anda.";
    }
    if (index === 1 && draft.bestSellers.length === 0) {
      return "Isi sekurang-kurangnya satu menu paling laris.";
    }
    return null;
  }

  function next() {
    const problem = problemWith(step);
    if (problem) return setError(problem);
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0 });
  }

  /**
   * Saves the restaurant and hands over to the dashboard.
   *
   * Deliberately does not generate anything. Content costs RM39.90 and comes
   * from a pack the owner has bought; charging a stranger's card at the end of
   * a form they were told was "maklumat restoran" would be a trick, and there
   * is nothing here to generate into anyway.
   */
  async function finish() {
    for (let i = 0; i < STEPS.length; i++) {
      const problem = problemWith(i);
      if (problem) {
        setStep(i);
        setError(problem);
        return;
      }
    }

    setError(null);
    setSaving(true);

    try {
      await completeOnboarding({
        ...EMPTY_PROFILE(user?.id ?? ""),
        ...draft,
        name: draft.name.trim(),
        cuisine: draft.cuisine.trim(),
        location: draft.location.trim(),
        description: draft.description.trim(),
        targetCustomers: draft.targetCustomers.trim(),
        menuNotes: draft.menuNotes.trim(),
        // An empty field must stay empty: a blank promotion is not a promotion.
        promotion: draft.promotion?.trim() || null,
      });
    } catch (err) {
      setSaving(false);
      setStep(STEPS.length - 1);
      setError(message(err, "Tak dapat simpan maklumat anda. Cuba lagi sekejap lagi."));
      return;
    }

    router.replace("/dashboard");
  }

  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  const uid = user?.id ?? "";

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between px-4 sm:px-6">
          <BrandLink />
          <span className="text-sm font-medium text-ink-muted">
            Langkah {step + 1} / {STEPS.length}
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <Progress step={step} />

        <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-ink">
          {current.title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          {current.blurb}
        </p>

        <div className="mt-7 space-y-6">
          {step === 0 ? <StepIdentity draft={draft} set={set} /> : null}
          {step === 1 ? <StepMenu draft={draft} set={set} uid={uid} /> : null}
          {step === 2 ? <StepPhotos draft={draft} set={set} uid={uid} /> : null}
          {step === 3 ? <StepBrand draft={draft} set={set} uid={uid} /> : null}
          {step === 4 ? <StepCopy draft={draft} set={set} /> : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-[var(--radius-field)] border border-tint-rose-line bg-tint-rose px-3.5 py-2.5 text-sm font-medium text-tint-rose-fg"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-between">
          {step > 0 ? (
            <Button variant="ghost" size="lg" onClick={back} className="sm:w-auto">
              <ArrowLeft />
              Kembali
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}

          {last ? (
            <Button
              size="lg"
              block
              className="sm:w-auto"
              onClick={finish}
              disabled={saving}
            >
              {saving ? "Menyimpan…" : "Simpan maklumat restoran"}
              <ArrowRight />
            </Button>
          ) : (
            <Button size="lg" block className="sm:w-auto" onClick={next}>
              Seterusnya
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/* -------------------------------------------------------------------------- */

function Progress({ step }: { step: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-valuenow={step + 1}
      aria-label={`Langkah ${step + 1} daripada ${STEPS.length}`}
      className="flex gap-1.5"
    >
      {STEPS.map((s, i) => (
        <span
          key={s.title}
          className={cn(
            "h-1.5 flex-1 rounded-full transition-colors duration-300",
            i <= step ? "bg-brand" : "bg-line",
          )}
        />
      ))}
    </div>
  );
}

interface StepProps {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}

function StepIdentity({ draft, set }: StepProps) {
  return (
    <>
      <Field label="Nama restoran">
        {(props) => (
          <Input
            {...props}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Warung Kak Ina"
            autoComplete="organization"
          />
        )}
      </Field>

      <Field
        label="Jenis masakan"
        hint="Contoh: Masakan Melayu, Kafe & brunch, Western, Mamak, Thai."
      >
        {(props) => (
          <Input
            {...props}
            value={draft.cuisine}
            onChange={(e) => set("cuisine", e.target.value)}
            placeholder="Masakan Melayu"
          />
        )}
      </Field>

      <Field
        label="Lokasi"
        optional
        hint="Bandar atau kawasan sahaja. Kami guna ini untuk content komuniti setempat."
      >
        {(props) => (
          <Input
            {...props}
            value={draft.location}
            onChange={(e) => set("location", e.target.value)}
            placeholder="Kajang"
          />
        )}
      </Field>

      <Field
        label="Cerita ringkas kedai anda"
        optional
        hint="Satu atau dua ayat. Apa yang buat kedai anda lain daripada yang lain."
      >
        {(props) => (
          <Textarea
            {...props}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Warung keluarga yang masak harian guna resipi rumah."
            maxLength={400}
          />
        )}
      </Field>

      <Field
        label="Siapa pelanggan anda"
        optional
        hint="Contoh: Keluarga, pekerja pejabat, pelajar."
      >
        {(props) => (
          <Input
            {...props}
            value={draft.targetCustomers}
            onChange={(e) => set("targetCustomers", e.target.value)}
            placeholder="Keluarga, pekerja pejabat, pelajar"
          />
        )}
      </Field>
    </>
  );
}

function StepMenu({ draft, set, uid }: StepProps & { uid: string }) {
  const hasPromotion = Boolean(draft.promotion?.trim());
  return (
    <>
      <Field
        label="Menu paling laris"
        hint="Sampai 5 menu. Ini yang paling banyak kami guna dalam content."
      >
        {(props) => (
          <TagInput
            {...props}
            value={draft.bestSellers}
            onChange={(next) => set("bestSellers", next)}
            placeholder="Nasi Ayam Penyet"
          />
        )}
      </Field>

      <Field
        label="Menu atau produk lain yang kami patut tahu"
        optional
        hint="Tulis apa sahaja yang penting — bahan, tahap pedas, apa yang istimewa. Ini yang kami guna untuk tulis caption."
      >
        {(props) => (
          <Textarea
            {...props}
            value={draft.menuNotes}
            onChange={(e) => set("menuNotes", e.target.value)}
            placeholder="Nasi Ayam Penyet paling popular. Teh Ais buat sendiri, tak guna premix."
            maxLength={1200}
          />
        )}
      </Field>

      <UploadField
        uid={uid}
        kind="menu"
        label="Muat naik menu"
        hint="PNG, JPG atau PDF. Kami simpan untuk rujukan anda."
        value={draft.menuFile}
        onChange={(next) => set("menuFile", next)}
      />
      <p className="-mt-3 text-xs leading-relaxed text-ink-muted">
        Kami tak baca kandungan fail menu lagi. Apa yang anda taip di atas itulah
        yang kami guna untuk tulis content.
      </p>

      <Field
        label="Promosi semasa"
        optional
        hint="Biar kosong kalau tiada. Kami takkan cipta promosi yang anda tak beritahu."
      >
        {(props) => (
          <Input
            {...props}
            value={draft.promotion ?? ""}
            onChange={(e) => set("promotion", e.target.value || null)}
            placeholder="Set Lunch RM12.90"
          />
        )}
      </Field>

      {/* Only asked once there is an offer for them to describe. */}
      {hasPromotion ? (
        <>
          <Field label="Bila promosi ini berjalan" optional>
            {(props) => (
              <Input
                {...props}
                value={draft.promotionDates}
                onChange={(e) => set("promotionDates", e.target.value)}
                placeholder="Isnin hingga Jumaat, 12 tengah hari - 3 petang"
              />
            )}
          </Field>
          <Field label="Syarat promosi" optional>
            {(props) => (
              <Input
                {...props}
                value={draft.promotionConditions}
                onChange={(e) => set("promotionConditions", e.target.value)}
                placeholder="Dine-in sahaja"
              />
            )}
          </Field>
        </>
      ) : null}
    </>
  );
}

/**
 * The photos, on a step of their own.
 *
 * They earn it. Everything else on this form changes what the posters say;
 * this is what they are made of, and a month built from an owner's own kitchen
 * looks like their restaurant in a way no amount of good copy can fake.
 */
function StepPhotos({ draft, set, uid }: StepProps & { uid: string }) {
  return (
    <>
      <PhotoPoolField
        uid={uid}
        value={draft.photos}
        onChange={(next) => set("photos", next)}
      />
      <p className="text-xs leading-relaxed text-ink-muted">
        Tiada gambar sekarang pun tak apa — kami ada design yang guna taip dan
        warna sahaja, dan anda boleh tambah gambar bila-bila masa dari halaman
        maklumat restoran.
      </p>
    </>
  );
}

function StepBrand({ draft, set, uid }: StepProps & { uid: string }) {
  return (
    <>
      <UploadField
        uid={uid}
        kind="logo"
        label="Logo restoran"
        hint="PNG atau JPG. Kami tunjuk balik pada dashboard anda."
        value={draft.logo}
        onChange={(next) => set("logo", next)}
      />

      <div>
        <p className="text-sm font-semibold text-ink">Gaya gambar yang anda suka</p>
        <p className="mb-3 mt-0.5 text-xs text-ink-muted">
          Ini jadi panduan untuk idea gambar dan arahan design setiap hari.
        </p>
        <ChoiceGroup<VisualStyle>
          name="visualStyle"
          legend="Gaya gambar"
          options={VISUAL_STYLE_OPTIONS}
          value={draft.visualStyle}
          onChange={(v) => set("visualStyle", v)}
        />
      </div>

      <Field
        label="Warna jenama anda"
        optional
        hint="Tulis dengan perkataan biasa. Contoh: merah bata dan krim."
      >
        {(props) => (
          <Input
            {...props}
            value={draft.brandColours}
            onChange={(e) => set("brandColours", e.target.value)}
            placeholder="Merah bata dan krim"
          />
        )}
      </Field>

      <Field
        label="Design atau akaun yang anda suka"
        optional
        hint="Nama akaun atau penerangan ringkas. Kami guna sebagai rujukan gaya sahaja."
      >
        {(props) => (
          <Textarea
            {...props}
            value={draft.referenceDesigns}
            onChange={(e) => set("referenceDesigns", e.target.value)}
            placeholder="Suka feed yang bersih, gambar makanan close-up, teks sikit sahaja."
            maxLength={300}
          />
        )}
      </Field>

      <div>
        <p className="text-sm font-semibold text-ink">Di mana anda post</p>
        <p className="mb-3 mt-0.5 text-xs text-ink-muted">
          Boleh pilih lebih daripada satu. Kami hanya beri content untuk platform
          yang anda guna.
        </p>
        <ChoiceGrid<Platform>
          name="platforms"
          legend="Platform"
          options={PLATFORM_OPTIONS}
          value={draft.platforms}
          onChange={(v) => set("platforms", v)}
        />
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold text-ink">Bahasa content</p>
        <ChoiceGroup<ContentLanguage>
          name="language"
          legend="Bahasa content"
          options={LANGUAGE_OPTIONS}
          value={draft.language}
          onChange={(v) => set("language", v)}
        />
      </div>
    </>
  );
}

function StepCopy({ draft, set }: StepProps) {
  return (
    <>
      <div>
        <p className="mb-3 text-sm font-semibold text-ink">
          Gaya bahasa content anda
        </p>
        <ChoiceGroup<BrandTone>
          name="tone"
          legend="Gaya bahasa"
          options={TONE_OPTIONS}
          value={draft.tone}
          onChange={(v) => set("tone", v)}
        />
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">Macam mana caption ditulis</p>
        <p className="mb-3 mt-0.5 text-xs text-ink-muted">
          Pilih satu atau lebih. Kami akan pusing gaya ini sepanjang bulan supaya
          feed anda tak bunyi sama setiap hari.
        </p>
        <ChoiceGrid<CopyStyle>
          name="copyStyles"
          legend="Style copywriting"
          options={COPY_STYLE_OPTIONS}
          value={draft.copyStyles}
          onChange={(v) => set("copyStyles", v)}
        />
      </div>

      <Field
        label="Contoh caption anda sendiri"
        optional
        hint="Kalau ada post lama yang anda suka, tampal di sini. Kami ikut cara anda menulis, bukan salin ayatnya."
      >
        {(props) => (
          <Textarea
            {...props}
            value={draft.exampleCaption}
            onChange={(e) => set("exampleCaption", e.target.value)}
            placeholder="Assalamualaikum semua! Hari ni kami masak…"
            maxLength={600}
          />
        )}
      </Field>
    </>
  );
}
