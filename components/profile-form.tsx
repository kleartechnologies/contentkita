"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Info, Loader2, LogOut, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { TagInput } from "@/components/ui/tag-input";
import { TONE_OPTIONS, type BrandTone } from "@/lib/content";
import { getAuthClient } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ProfileForm() {
  const router = useRouter();
  const { status, profile, isDemo, saveProfile, clearProfile } = useApp();

  if (status === "loading") return <ProfileSkeleton />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          Maklumat restoran
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Semua content dijana daripada maklumat di bawah. Ubah apa-apa, pelan 30
          hari akan disusun semula.
        </p>
      </header>

      {isDemo ? (
        <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-brand-line bg-brand-tint p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-brand-ink">
              Ini maklumat contoh.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-brand-ink/85">
              Isi maklumat restoran anda sendiri untuk dapat content yang betul-betul
              berkaitan.{" "}
              <Link
                href="/onboarding"
                className="inline-block py-2 font-bold underline underline-offset-2"
              >
                Mula isi
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      {/* Remounts when the underlying profile changes so the inputs never keep
          stale values after a reset back to the sample. */}
      <ProfileFields
        key={profile.id}
        profile={profile}
        onSave={(next) => {
          saveProfile(next);
          toast.success("Maklumat disimpan", {
            description: "Pelan 30 hari anda dijana semula.",
          });
          router.push("/dashboard");
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Akaun</CardTitle>
          <CardDescription className="mt-1">
            Log keluar atau padam maklumat yang tersimpan dalam pelayar ini.
          </CardDescription>
        </CardHeader>
        <CardBody className="flex flex-col gap-2 sm:flex-row">
          {!isDemo ? (
            <Button
              variant="secondary"
              block
              className="sm:w-auto"
              onClick={() => {
                clearProfile();
                toast("Maklumat dipadam", {
                  description: "Anda kembali melihat contoh Warung Kak Ina.",
                });
              }}
            >
              <RotateCcw />
              Padam maklumat saya
            </Button>
          ) : null}
          <Button
            variant="ghost"
            block
            className="sm:w-auto"
            onClick={async () => {
              await getAuthClient().signOut();
              router.push("/");
            }}
          >
            <LogOut />
            Log keluar
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface ProfileShape {
  id: string;
  name: string;
  cuisine: string;
  location: string;
  description: string;
  targetCustomers: string;
  bestSellers: string[];
  promotion: string | null;
  tone: BrandTone;
  createdAt: string;
  updatedAt: string;
}

function ProfileFields({
  profile,
  onSave,
}: {
  profile: ProfileShape;
  onSave: (next: ProfileShape) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [cuisine, setCuisine] = useState(profile.cuisine);
  const [location, setLocation] = useState(profile.location);
  const [description, setDescription] = useState(profile.description);
  const [targetCustomers, setTargetCustomers] = useState(profile.targetCustomers);
  const [bestSellers, setBestSellers] = useState<string[]>(profile.bestSellers);
  const [promotion, setPromotion] = useState(profile.promotion ?? "");
  const [tone, setTone] = useState<BrandTone>(profile.tone);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return setError("Sila isi nama restoran anda.");
    if (!cuisine.trim()) return setError("Sila isi jenis masakan anda.");
    if (bestSellers.length === 0)
      return setError("Isi sekurang-kurangnya satu menu paling laris.");

    setError(null);
    setBusy(true);
    onSave({
      ...profile,
      name: name.trim(),
      cuisine: cuisine.trim(),
      location: location.trim(),
      description: description.trim(),
      targetCustomers: targetCustomers.trim(),
      bestSellers,
      promotion: promotion.trim() || null,
      tone,
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Restoran</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <Field label="Nama restoran">
            {(props) => (
              <Input {...props} value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Jenis masakan">
            {(props) => (
              <Input
                {...props}
                value={cuisine}
                onChange={(e) => setCuisine(e.target.value)}
              />
            )}
          </Field>
          <Field label="Lokasi" optional hint="Bandar atau kawasan sahaja.">
            {(props) => (
              <Input
                {...props}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cerita &amp; pelanggan</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <Field label="Cerita ringkas kedai anda" optional>
            {(props) => (
              <Textarea
                {...props}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={280}
              />
            )}
          </Field>
          <Field label="Siapa pelanggan anda" optional>
            {(props) => (
              <Input
                {...props}
                value={targetCustomers}
                onChange={(e) => setTargetCustomers(e.target.value)}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Menu &amp; tawaran</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <Field label="Menu paling laris" hint="Sampai 5 menu.">
            {(props) => (
              <TagInput {...props} value={bestSellers} onChange={setBestSellers} />
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
                value={promotion}
                onChange={(e) => setPromotion(e.target.value)}
                placeholder="Contoh: Set Lunch RM12.90"
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gaya bahasa</CardTitle>
        </CardHeader>
        <CardBody>
          <fieldset>
            <legend className="sr-only">Gaya bahasa</legend>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {TONE_OPTIONS.map((option) => {
                const active = tone === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "cursor-pointer rounded-[var(--radius-field)] border px-4 py-3 transition-colors",
                      active
                        ? "border-brand bg-brand-tint"
                        : "border-line bg-surface hover:bg-sunken",
                    )}
                  >
                    <input
                      type="radio"
                      name="tone"
                      value={option.value}
                      checked={active}
                      onChange={() => setTone(option.value)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "block text-sm font-bold",
                        active ? "text-brand-ink" : "text-ink",
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-soft">
                      {option.hint}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardBody>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-field)] border border-tint-rose-line bg-tint-rose px-3.5 py-2.5 text-sm font-medium text-tint-rose-fg"
        >
          {error}
        </p>
      ) : null}

      {/* Sticky so the save action is always in reach on a long form; the fade
          keeps the fields behind it readable instead of showing through. */}
      <div className="sticky bottom-20 z-10 -mx-1 bg-gradient-to-t from-paper via-paper to-transparent px-1 pb-1 pt-6 sm:bottom-4">
        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          {busy ? "Menyimpan…" : "Simpan & jana semula pelan"}
        </Button>
      </div>
    </form>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-5 h-11 w-full" />
          <Skeleton className="mt-4 h-11 w-full" />
        </div>
      ))}
    </div>
  );
}
