"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { getAuthClient } from "@/lib/auth";

type Mode = "signup" | "login";

const COPY = {
  signup: {
    title: "Daftar akaun",
    subtitle: "Percuma. Lepas ni kami tanya sikit pasal restoran anda.",
    submit: "Daftar & Teruskan",
    swapText: "Dah ada akaun?",
    swapLink: "Log masuk",
    swapHref: "/login",
    next: "/onboarding",
    toast: "Akaun siap. Jom isi maklumat restoran.",
  },
  login: {
    title: "Log masuk",
    subtitle: "Sambung semula pelan content anda.",
    submit: "Log Masuk",
    swapText: "Belum ada akaun?",
    swapLink: "Daftar percuma",
    swapHref: "/signup",
    next: "/dashboard",
    toast: "Selamat kembali.",
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const client = getAuthClient();
    const result =
      mode === "signup"
        ? await client.signUp({ email, password })
        : await client.signIn({ email, password });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    toast.success(copy.toast);
    router.push(copy.next);
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mx-auto mb-8 flex w-fit items-center rounded-md py-2">
          <Wordmark className="text-xl" />
        </Link>

        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-7">
          <h1 className="text-xl font-extrabold tracking-tight text-ink">
            {copy.title}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
            {copy.subtitle}
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            <Field label="Emel">
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  placeholder="nama@emel.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              )}
            </Field>

            <Field
              label="Kata laluan"
              hint={mode === "signup" ? "Sekurang-kurangnya 6 aksara." : undefined}
            >
              {(props) => (
                <div className="relative">
                  <Input
                    {...props}
                    type={reveal ? "text" : "password"}
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    placeholder="••••••••"
                    className="pr-11"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((r) => !r)}
                    className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-[var(--radius-field)] text-ink-muted hover:text-ink"
                    aria-label={
                      reveal ? "Sembunyikan kata laluan" : "Tunjuk kata laluan"
                    }
                  >
                    {reveal ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
              )}
            </Field>

            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-[var(--radius-field)] border border-tint-rose-line bg-tint-rose px-3 py-2.5 text-sm font-medium text-tint-rose-fg"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" block disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Sekejap…" : copy.submit}
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-ink-soft">
          {copy.swapText}{" "}
          <Link
            href={copy.swapHref}
            className="inline-block py-2 font-semibold text-brand hover:text-brand-hover"
          >
            {copy.swapLink}
          </Link>
        </p>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-muted">
          Nak tengok dulu tanpa daftar?{" "}
          <Link
            href="/dashboard"
            className="inline-block py-2 font-semibold underline underline-offset-2"
          >
            Lihat contoh
          </Link>
        </p>
      </div>
    </main>
  );
}
