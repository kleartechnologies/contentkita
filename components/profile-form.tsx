"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, LogOut, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import { GeneratingScreen } from "@/components/generating-screen";
import { UploadField } from "@/components/upload-field";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardDescription, CardTitle } from "@/components/ui/card";
import { ChoiceGrid, ChoiceGroup } from "@/components/ui/choice";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { TagInput } from "@/components/ui/tag-input";
import {
  COPY_STYLE_OPTIONS,
  LANGUAGE_OPTIONS,
  PLATFORM_OPTIONS,
  TONE_OPTIONS,
  VISUAL_STYLE_OPTIONS,
  type BrandTone,
  type ContentLanguage,
  type CopyStyle,
  type GenerationStage,
  type Platform,
  type RestaurantProfile,
  type VisualStyle,
} from "@/lib/content";
import { useApp } from "@/lib/store";

export function ProfileForm() {
  const { status, profile, saveProfile, signOut } = useApp();

  if (status !== "ready" || !profile) return <ProfileSkeleton />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          Maklumat restoran
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Semua content dijana daripada maklumat di bawah. Pelan yang sedia ada
          kekal sampai anda jana semula sendiri.
        </p>
      </header>

      {/* Remounts when the saved profile changes so the inputs never keep stale
          values behind them. */}
      <ProfileFields
        key={profile.updatedAt}
        profile={profile}
        onSave={async (next) => {
          await saveProfile(next);
          toast.success("Maklumat disimpan", {
            description: "Pelan sedia ada tak berubah.",
          });
        }}
      />

      <RegenerateCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Akaun</CardTitle>
          <CardDescription className="mt-1">
            Log keluar daripada peranti ini. Maklumat restoran dan pelan
            content anda kekal tersimpan.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <Button
            variant="ghost"
            block
            className="sm:w-auto"
            // No redirect here on purpose. Signing out flips the auth state,
            // and the gate around this screen is what decides where a
            // signed-out visitor goes — two navigations would race each other.
            onClick={() => signOut()}
          >
            <LogOut />
            Log keluar
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * Regenerating throws away thirty days the owner may already have posted, so it
 * is never a side effect of saving — it is a deliberate action, behind a
 * confirmation. Edited days are called out by name in that confirmation,
 * because those are the ones nobody can get back.
 */
function RegenerateCard() {
  const router = useRouter();
  const { plan, regeneratePlan, regeneratingPlan } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [stage, setStage] = useState<GenerationStage | null>(null);
  const edited = plan?.items.filter((i) => i.edited).length ?? 0;

  async function run() {
    setStage("brief");
    try {
      await regeneratePlan(setStage);
      setConfirming(false);
      toast.success("Pelan baharu siap", {
        description: "30 hari content guna maklumat terkini anda.",
      });
      router.push("/dashboard");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Tak jadi jana semula pelan.",
      );
    } finally {
      setStage(null);
    }
  }

  if (stage) return <GeneratingScreen stage={stage} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pelan content</CardTitle>
        <CardDescription className="mt-1">
          {confirming
            ? `Pelan sekarang akan diganti dengan 30 hari content baharu. Content lama tak boleh dikembalikan.${
                edited > 0
                  ? ` Termasuk ${edited} hari yang anda dah edit sendiri.`
                  : ""
              }`
            : "Jana semula bila maklumat anda dah banyak berubah. Pelan sekarang akan diganti."}
        </CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-2 sm:flex-row">
        {confirming ? (
          <>
            <Button
              block
              className="sm:w-auto"
              onClick={run}
              disabled={regeneratingPlan}
            >
              {regeneratingPlan ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              {regeneratingPlan ? "Menjana…" : "Ya, jana semula"}
            </Button>
            <Button
              variant="ghost"
              block
              className="sm:w-auto"
              onClick={() => setConfirming(false)}
              disabled={regeneratingPlan}
            >
              Batal
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            block
            className="sm:w-auto"
            onClick={() => setConfirming(true)}
          >
            <RefreshCw />
            Jana semula pelan 30 hari
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function ProfileFields({
  profile,
  onSave,
}: {
  profile: RestaurantProfile;
  onSave: (next: RestaurantProfile) => Promise<void>;
}) {
  // One piece of state per field rather than a draft object, so a field that
  // has not been touched cannot be rewritten by a stale spread.
  const [name, setName] = useState(profile.name);
  const [cuisine, setCuisine] = useState(profile.cuisine);
  const [location, setLocation] = useState(profile.location);
  const [description, setDescription] = useState(profile.description);
  const [targetCustomers, setTargetCustomers] = useState(profile.targetCustomers);
  const [bestSellers, setBestSellers] = useState<string[]>(profile.bestSellers);
  const [menuNotes, setMenuNotes] = useState(profile.menuNotes);
  const [menuFile, setMenuFile] = useState(profile.menuFile);
  const [promotion, setPromotion] = useState(profile.promotion ?? "");
  const [promotionDates, setPromotionDates] = useState(profile.promotionDates);
  const [promotionConditions, setPromotionConditions] = useState(
    profile.promotionConditions,
  );
  const [logo, setLogo] = useState(profile.logo);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(profile.visualStyle);
  const [brandColours, setBrandColours] = useState(profile.brandColours);
  const [referenceDesigns, setReferenceDesigns] = useState(profile.referenceDesigns);
  const [platforms, setPlatforms] = useState<Platform[]>(profile.platforms);
  const [language, setLanguage] = useState<ContentLanguage>(profile.language);
  const [tone, setTone] = useState<BrandTone>(profile.tone);
  const [copyStyles, setCopyStyles] = useState<CopyStyle[]>(profile.copyStyles);
  const [exampleCaption, setExampleCaption] = useState(profile.exampleCaption);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasPromotion = Boolean(promotion.trim());

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return setError("Sila isi nama restoran anda.");
    if (!cuisine.trim()) return setError("Sila isi jenis masakan anda.");
    if (bestSellers.length === 0)
      return setError("Isi sekurang-kurangnya satu menu paling laris.");

    setError(null);
    setBusy(true);
    try {
      await onSave({
        ...profile,
        name: name.trim(),
        cuisine: cuisine.trim(),
        location: location.trim(),
        description: description.trim(),
        targetCustomers: targetCustomers.trim(),
        bestSellers,
        menuNotes: menuNotes.trim(),
        menuFile,
        promotion: promotion.trim() || null,
        // Dropped with the offer they belong to, so a stale "Setiap Jumaat"
        // cannot outlive the promotion it described.
        promotionDates: hasPromotion ? promotionDates.trim() : "",
        promotionConditions: hasPromotion ? promotionConditions.trim() : "",
        logo,
        visualStyle,
        brandColours: brandColours.trim(),
        referenceDesigns: referenceDesigns.trim(),
        platforms,
        language,
        tone,
        copyStyles,
        exampleCaption: exampleCaption.trim(),
      });
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Tak dapat simpan maklumat anda. Cuba lagi sekejap lagi.",
      );
    } finally {
      setBusy(false);
    }
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
          <Field label="Cerita ringkas kedai anda" optional>
            {(props) => (
              <Textarea
                {...props}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={400}
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
            label="Menu atau produk lain yang kami patut tahu"
            optional
            hint="Ini yang kami guna untuk tulis caption — bukan kandungan fail menu."
          >
            {(props) => (
              <Textarea
                {...props}
                value={menuNotes}
                onChange={(e) => setMenuNotes(e.target.value)}
                maxLength={1200}
              />
            )}
          </Field>

          <UploadField
            uid={profile.id}
            kind="menu"
            label="Fail menu"
            hint="PNG, JPG atau PDF."
            value={menuFile}
            onChange={setMenuFile}
          />

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

          {hasPromotion ? (
            <>
              <Field label="Bila promosi ini berjalan" optional>
                {(props) => (
                  <Input
                    {...props}
                    value={promotionDates}
                    onChange={(e) => setPromotionDates(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Syarat promosi" optional>
                {(props) => (
                  <Input
                    {...props}
                    value={promotionConditions}
                    onChange={(e) => setPromotionConditions(e.target.value)}
                  />
                )}
              </Field>
            </>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand &amp; gaya gambar</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <UploadField
            uid={profile.id}
            kind="logo"
            label="Logo restoran"
            hint="PNG atau JPG."
            value={logo}
            onChange={setLogo}
          />

          <div>
            <p className="mb-3 text-sm font-semibold text-ink">
              Gaya gambar yang anda suka
            </p>
            <ChoiceGroup<VisualStyle>
              name="visualStyle"
              legend="Gaya gambar"
              options={VISUAL_STYLE_OPTIONS}
              value={visualStyle}
              onChange={setVisualStyle}
            />
          </div>

          <Field label="Warna jenama anda" optional>
            {(props) => (
              <Input
                {...props}
                value={brandColours}
                onChange={(e) => setBrandColours(e.target.value)}
                placeholder="Merah bata dan krim"
              />
            )}
          </Field>

          <Field label="Design atau akaun yang anda suka" optional>
            {(props) => (
              <Textarea
                {...props}
                value={referenceDesigns}
                onChange={(e) => setReferenceDesigns(e.target.value)}
                maxLength={300}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform &amp; bahasa</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <div>
            <p className="mb-3 text-sm font-semibold text-ink">Di mana anda post</p>
            <ChoiceGrid<Platform>
              name="platforms"
              legend="Platform"
              options={PLATFORM_OPTIONS}
              value={platforms}
              onChange={setPlatforms}
            />
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold text-ink">Bahasa content</p>
            <ChoiceGroup<ContentLanguage>
              name="language"
              legend="Bahasa content"
              options={LANGUAGE_OPTIONS}
              value={language}
              onChange={setLanguage}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gaya bahasa &amp; copywriting</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <ChoiceGroup<BrandTone>
            name="tone"
            legend="Gaya bahasa"
            options={TONE_OPTIONS}
            value={tone}
            onChange={setTone}
          />
          <div>
            <p className="mb-3 text-sm font-semibold text-ink">
              Macam mana caption ditulis
            </p>
            <ChoiceGrid<CopyStyle>
              name="copyStyles"
              legend="Style copywriting"
              options={COPY_STYLE_OPTIONS}
              value={copyStyles}
              onChange={setCopyStyles}
            />
          </div>
          <Field label="Contoh caption anda sendiri" optional>
            {(props) => (
              <Textarea
                {...props}
                value={exampleCaption}
                onChange={(e) => setExampleCaption(e.target.value)}
                maxLength={600}
              />
            )}
          </Field>
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
          {busy ? "Menyimpan…" : "Simpan maklumat"}
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
