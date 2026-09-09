import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Check,
  ClipboardCopy,
  MessageSquare,
  Repeat,
  ShieldCheck,
  Sparkle,
  Store,
} from "lucide-react";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { HeroPreview, SampleContent } from "@/components/marketing/sample-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Examples />
        <WhatYouGet />
        <WhyUs />
        <Pricing />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Section({
  className,
  children,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section className={cn("px-4 py-16 sm:px-6 sm:py-20", className)} {...props}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold uppercase tracking-[0.1em] text-brand">
      {children}
    </p>
  );
}

function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-2xl font-extrabold tracking-tight text-ink sm:text-3xl",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="border-b border-line bg-gradient-to-b from-brand-tint/50 to-paper px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
      <div className="mx-auto w-full max-w-3xl text-center">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-brand-line bg-surface px-3 py-1.5 text-xs font-semibold text-brand-ink">
          <Sparkle className="size-3.5" aria-hidden />
          Untuk restoran, kafe &amp; kedai makan di Malaysia
        </p>

        <h1 className="mt-5 text-[2rem] font-extrabold leading-[1.1] tracking-tight text-ink sm:text-5xl">
          Bisnes Tak Lagi Kehabisan Content.
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          Bagi ContentKita tahu tentang restoran anda — menu, logo dan gaya
          bahasa. Dapatkan 30 hari idea, caption, CTA dan pelan content yang
          disesuaikan dengan bisnes anda.
        </p>

        <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg" block className="sm:w-auto">
            <Link href="/signup">
              Mulakan Sekarang
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary" block className="sm:w-auto">
            <Link href="#contoh">Lihat Contoh</Link>
          </Button>
        </div>

        {/* Wraps between claims rather than mid-phrase on a narrow phone. */}
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          {["Tak perlu kad kredit", "Upload logo & menu", "Semua dalam BM"].map(
            (claim, i) => (
              <li key={claim} className="flex items-center gap-2">
                {i > 0 ? <span aria-hidden>·</span> : null}
                {claim}
              </li>
            ),
          )}
        </ul>
      </div>

      <div className="mx-auto mt-12 w-full max-w-lg">
        <HeroPreview />
      </div>
    </section>
  );
}

const PROBLEMS = [
  {
    title: "“Hari ni nak post apa?”",
    body: "Buka Instagram, tengok skrin kosong, tutup balik. Esok sama juga.",
  },
  {
    title: "Caption ambil masa lama",
    body: "Gambar dah ada, tapi tulis ayat sepuluh minit pun tak jadi-jadi.",
  },
  {
    title: "Post ikut mood",
    body: "Seminggu tiga kali, lepas tu senyap sebulan. Reach pun jatuh.",
  },
  {
    title: "Reels sentiasa tertangguh",
    body: "Tahu penting, tapi fikir idea video jadi satu lagi kerja.",
  },
];

function Problem() {
  return (
    <Section>
      <div className="max-w-2xl">
        <Eyebrow>Masalahnya</Eyebrow>
        <SectionTitle className="mt-3">
          Bukan sebab malas. Sebab tak sempat fikir.
        </SectionTitle>
        <p className="mt-3 text-base leading-relaxed text-ink-soft">
          Anda sibuk masak, layan pelanggan dan urus stok. Content selalu jadi
          kerja terakhir — dan selalunya tak jadi.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {PROBLEMS.map((p) => (
          <div
            key={p.title}
            className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
          >
            <h3 className="text-base font-bold tracking-tight text-ink">
              {p.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
              {p.body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

const STEPS = [
  {
    icon: Store,
    title: "Isi maklumat restoran",
    body: "Nama, jenis masakan, lokasi, menu paling laris dan gaya bahasa anda. Boleh upload logo dan fail menu sekali.",
  },
  {
    icon: Sparkle,
    title: "Kami susun 30 hari",
    body: "Setiap hari dapat hook, caption penuh, CTA, idea gambar dan idea video bila sesuai.",
  },
  {
    icon: ClipboardCopy,
    title: "Buka, salin, post",
    body: "Pagi-pagi buka dashboard, tekan salin, terus paste ke Instagram atau TikTok.",
  },
];

function HowItWorks() {
  return (
    <Section className="border-y border-line bg-surface">
      <div className="max-w-2xl">
        <Eyebrow>Macam mana ia jalan</Eyebrow>
        <SectionTitle className="mt-3">Tiga langkah sahaja.</SectionTitle>
      </div>

      <ol className="mt-10 grid gap-6 sm:grid-cols-3">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="relative">
              <div className="flex size-11 items-center justify-center rounded-[var(--radius-field)] border border-brand-line bg-brand-tint text-brand">
                <Icon className="size-5" aria-hidden />
              </div>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
                Langkah {i + 1}
              </p>
              <h3 className="mt-1 text-lg font-bold tracking-tight text-ink">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                {step.body}
              </p>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function Examples() {
  return (
    <Section id="contoh">
      <div className="max-w-2xl">
        <Eyebrow>Contoh sebenar</Eyebrow>
        <SectionTitle className="mt-3">Ini rupa content anda.</SectionTitle>
        <p className="mt-3 text-base leading-relaxed text-ink-soft">
          Contoh di bawah dijana untuk sebuah warung masakan Melayu di Kajang.
          Content anda akan guna nama, menu dan gaya bahasa anda sendiri.
        </p>
      </div>

      <div className="mt-10">
        <SampleContent />
      </div>

      <Button asChild variant="quiet" className="mt-6">
        <Link href="/signup">
          Jana pelan 30 hari untuk kedai anda
          <ArrowRight />
        </Link>
      </Button>
    </Section>
  );
}

const INCLUDED = [
  { icon: MessageSquare, text: "Caption penuh yang siap untuk paste" },
  { icon: Sparkle, text: "Hook untuk hentikan orang scroll" },
  { icon: ArrowRight, text: "CTA jelas — orang tahu nak buat apa" },
  { icon: Camera, text: "Idea gambar untuk setiap hari" },
  { icon: Repeat, text: "Idea Reels dan video pendek" },
  { icon: Check, text: "Cadangan platform: IG, TikTok, FB, WhatsApp" },
];

function WhatYouGet() {
  return (
    <Section className="border-y border-line bg-surface">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <Eyebrow>Apa anda dapat</Eyebrow>
          <SectionTitle className="mt-3">
            Satu pelan penuh, bukan senarai idea kosong.
          </SectionTitle>
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            Setiap hari dalam pelan sudah lengkap. Tiada hari yang tertulis
            “fikir sendiri”.
          </p>
          <Button asChild size="lg" className="mt-6">
            <Link href="/signup">
              Jana pelan saya
              <ArrowRight />
            </Link>
          </Button>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {INCLUDED.map((item) => {
            const Icon = item.icon;
            return (
              <li
                key={item.text}
                className="flex items-start gap-3 rounded-[var(--radius-field)] border border-line bg-paper px-4 py-3"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                <span className="text-sm font-medium leading-relaxed text-ink">
                  {item.text}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

function WhyUs() {
  return (
    <Section>
      <div className="max-w-2xl">
        <Eyebrow>Kenapa ContentKita</Eyebrow>
        <SectionTitle className="mt-3">
          Content yang bunyi macam anda, bukan macam iklan.
        </SectionTitle>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <div className="rounded-[var(--radius-card)] border border-brand-line bg-brand-tint p-6 md:col-span-2">
          <ShieldCheck className="size-6 text-brand" aria-hidden />
          <h3 className="mt-3 text-lg font-bold tracking-tight text-brand-ink">
            Kami tak reka fakta pasal kedai anda.
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-brand-ink/85">
            Kalau anda tak beritahu ada promosi, kami takkan cipta promosi.
            Tiada anugerah palsu, tiada harga yang anda tak sebut, tiada review
            yang tak wujud. Apa yang tertulis, datang daripada maklumat yang
            anda isi sendiri.
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h3 className="text-lg font-bold tracking-tight text-ink">
            BM yang orang guna betul-betul
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Bukan bahasa karangan sekolah. Ayat pendek, santai, macam anda
            bercakap dengan pelanggan sendiri.
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h3 className="text-lg font-bold tracking-tight text-ink">
            30 hari yang berbeza
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Bukan 30 versi “datang ke restoran kami hari ini”. Ada cerita,
            behind the scenes, soalan, pelanggan dan barulah jualan.
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 md:col-span-2">
          <h3 className="text-lg font-bold tracking-tight text-ink">
            Post jualan diletak berpada-pada
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Dalam 30 hari, hanya beberapa hari sahaja yang menjual secara terus.
            Selebihnya membina kepercayaan — sebab feed yang asyik menjual akan
            dilangkau orang.
          </p>
        </div>
      </div>
    </Section>
  );
}

function Pricing() {
  return (
    <Section className="border-y border-line bg-surface">
      <div className="max-w-2xl">
        <Eyebrow>Harga</Eyebrow>
        <SectionTitle className="mt-3">Satu harga, satu pelan penuh.</SectionTitle>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
        <div className="rounded-[var(--radius-card)] border-2 border-brand bg-paper p-6">
          <h3 className="text-base font-bold text-ink">
            30 Hari Content Untuk Restoran Anda
          </h3>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold tracking-tight text-ink">
              RM39
            </span>
            <span className="text-sm font-medium text-ink-muted">sebulan</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Satu restoran, pelan 30 hari penuh, upload logo dan menu, edit
            sendiri dan jana semula bila-bila masa.
          </p>

          {/*
            Saying this out loud matters more than the price does. There is no
            payment flow yet, so an owner who signs up today is not charged and
            must not be left wondering whether they have been.
          */}
          <p className="mt-4 rounded-[var(--radius-field)] border border-brand-line bg-brand-tint/40 px-3 py-2.5 text-sm leading-relaxed text-brand-ink">
            Semasa pelancaran, kami belum ambil sebarang bayaran. Daftar dan
            guna dulu — kami akan beritahu awal sebelum apa-apa caj bermula.
          </p>

          <Button asChild block className="mt-5">
            <Link href="/signup">Mulakan sekarang</Link>
          </Button>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-ink">Lebih daripada satu kedai</h3>
            <span className="rounded-full border border-line bg-sunken px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-muted">
              Akan datang
            </span>
          </div>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink-muted">
            —
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Pelan baharu setiap bulan, berbilang cawangan dan lebih banyak versi
            untuk setiap post. Kami sedang bina.
          </p>
          <Button block variant="secondary" className="mt-5" disabled>
            Belum tersedia
          </Button>
        </div>
      </div>
    </Section>
  );
}

function FinalCta() {
  return (
    <Section className="text-center">
      <div className="mx-auto max-w-xl">
        <SectionTitle>Esok, tak payah fikir lagi.</SectionTitle>
        <p className="mt-3 text-base leading-relaxed text-ink-soft">
          Isi maklumat restoran anda sekali, dan pelan 30 hari terus siap.
        </p>
        <Button asChild size="lg" className="mt-7">
          <Link href="/signup">
            Jana content saya
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </Section>
  );
}
