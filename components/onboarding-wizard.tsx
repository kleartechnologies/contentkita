"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkle } from "lucide-react";

import { BrandLink } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { TagInput } from "@/components/ui/tag-input";
import { EMPTY_PROFILE, TONE_OPTIONS, type BrandTone } from "@/lib/content";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Restoran anda", blurb: "Asas yang kami perlukan untuk mula." },
  { title: "Cerita & pelanggan", blurb: "Supaya content bunyi macam kedai anda." },
  { title: "Menu & tawaran", blurb: "Apa yang orang datang untuk makan." },
  { title: "Gaya bahasa", blurb: "Macam mana anda nak bercakap." },
] as const;

interface Draft {
  name: string;
  cuisine: string;
  location: string;
  description: string;
  targetCustomers: string;
  bestSellers: string[];
  promotion: string;
  tone: BrandTone;
}

export function OnboardingWizard() {
  const router = useRouter();
  const { user, completeOnboarding } = useApp();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // This screen only ever runs for an owner with no restaurant saved yet —
  // anyone who has finished is sent to the dashboard — so it starts blank.
  // Editing an existing restaurant happens on the profile screen.
  const [draft, setDraft] = useState<Draft>({
    name: "",
    cuisine: "",
    location: "",
    description: "",
    targetCustomers: "",
    bestSellers: [],
    promotion: "",
    tone: "friendly",
  });

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  }

  function problemWith(index: number): string | null {
    if (index === 0) {
      if (!draft.name.trim()) return "Sila isi nama restoran anda.";
      if (!draft.cuisine.trim()) return "Sila isi jenis masakan anda.";
    }
    if (index === 2 && draft.bestSellers.length === 0) {
      return "Isi sekurang-kurangnya satu menu paling laris.";
    }
    return null;
  }

  function next() {
    const problem = problemWith(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0 });
  }

  async function generate() {
    for (let i = 0; i < STEPS.length; i++) {
      const problem = problemWith(i);
      if (problem) {
        setStep(i);
        setError(problem);
        return;
      }
    }

    setGenerating(true);
    setError(null);

    try {
      await Promise.all([
        completeOnboarding({
          ...EMPTY_PROFILE(user?.id ?? ""),
          name: draft.name.trim(),
          cuisine: draft.cuisine.trim(),
          location: draft.location.trim(),
          description: draft.description.trim(),
          targetCustomers: draft.targetCustomers.trim(),
          bestSellers: draft.bestSellers,
          // An empty field must stay empty: a blank promotion is not a promotion.
          promotion: draft.promotion.trim() || null,
          tone: draft.tone,
        }),
        // Saving is quick; the floor is what makes the step legible.
        new Promise((resolve) => setTimeout(resolve, 900)),
      ]);
      router.replace("/dashboard");
    } catch (err) {
      // Back to the last step with their answers intact, so nothing is retyped.
      setGenerating(false);
      setStep(STEPS.length - 1);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Tak dapat simpan maklumat anda. Cuba lagi sekejap lagi.",
      );
    }
  }

  if (generating) return <GeneratingScreen name={draft.name.trim()} />;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

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

        <div className="mt-7 space-y-5">
          {step === 0 ? <StepIdentity draft={draft} set={set} /> : null}
          {step === 1 ? <StepStory draft={draft} set={set} /> : null}
          {step === 2 ? <StepMenu draft={draft} set={set} /> : null}
          {step === 3 ? <StepTone draft={draft} set={set} /> : null}
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
            <Button size="lg" block className="sm:w-auto" onClick={generate}>
              <Sparkle />
              Jana Content Saya
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
    </>
  );
}

function StepStory({ draft, set }: StepProps) {
  return (
    <>
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
            maxLength={280}
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

function StepMenu({ draft, set }: StepProps) {
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
        label="Promosi semasa"
        optional
        hint="Biar kosong kalau tiada. Kami takkan cipta promosi yang anda tak beritahu."
      >
        {(props) => (
          <Input
            {...props}
            value={draft.promotion}
            onChange={(e) => set("promotion", e.target.value)}
            placeholder="Set Lunch RM12.90"
          />
        )}
      </Field>
    </>
  );
}

function StepTone({ draft, set }: StepProps) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">
        Pilih gaya bahasa content anda
      </legend>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {TONE_OPTIONS.map((option) => {
          const active = draft.tone === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border p-4 transition-colors",
                active
                  ? "border-brand bg-brand-tint"
                  : "border-line bg-surface hover:border-line-strong hover:bg-sunken",
              )}
            >
              <input
                type="radio"
                name="tone"
                value={option.value}
                checked={active}
                onChange={() => set("tone", option.value)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
                  active ? "border-brand bg-brand text-white" : "border-line-strong",
                )}
              >
                {active ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <span>
                <span
                  className={cn(
                    "block text-[0.9375rem] font-bold",
                    active ? "text-brand-ink" : "text-ink",
                  )}
                >
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
                  {option.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function GeneratingScreen({ name }: { name: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-6 text-center">
      <div>
        <Loader2 className="mx-auto size-8 animate-spin text-brand" aria-hidden />
        <h1 className="mt-5 text-xl font-extrabold tracking-tight text-ink">
          Menyusun 30 hari content…
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Sekejap ya{name ? `, ${name}` : ""}. Kami sedang atur hook, caption dan
          idea gambar untuk sebulan.
        </p>
      </div>
    </div>
  );
}
