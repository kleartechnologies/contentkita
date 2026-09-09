/**
 * The authentication boundary.
 *
 * Milestone 1 ships the interface and a local stub, not a backend. Every screen
 * talks to `getAuthClient()` and nothing else, so connecting Supabase Auth means
 * adding a `SupabaseAuthClient` here and choosing it in `getAuthClient()` — no
 * screen or form changes.
 */

export interface Credentials {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: string };

export interface AuthClient {
  kind: string;
  signUp(input: Credentials): Promise<AuthResult>;
  signIn(input: Credentials): Promise<AuthResult>;
  signOut(): Promise<void>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 6;

/** Client-side checks, in the wording the screens show. Reused by both forms. */
export function validate({ email, password }: Credentials): string | null {
  if (!email.trim()) return "Sila masukkan emel anda.";
  if (!EMAIL.test(email.trim())) return "Emel ini nampak tak lengkap.";
  if (!password) return "Sila masukkan kata laluan.";
  if (password.length < MIN_PASSWORD)
    return `Kata laluan perlu sekurang-kurangnya ${MIN_PASSWORD} aksara.`;
  return null;
}

/**
 * Accepts any valid-looking credentials and creates no session. It exists so
 * the forms have real submitting, error and success states to render.
 */
class LocalAuthClient implements AuthClient {
  readonly kind = "local-stub";

  private async settle(input: Credentials): Promise<AuthResult> {
    const problem = validate(input);
    if (problem) return { ok: false, error: problem };
    // A short delay so the pending state is visible rather than a flash.
    await new Promise((resolve) => setTimeout(resolve, 450));
    return {
      ok: true,
      user: { id: `local-${input.email.trim().toLowerCase()}`, email: input.email.trim() },
    };
  }

  signUp(input: Credentials) {
    return this.settle(input);
  }

  signIn(input: Credentials) {
    return this.settle(input);
  }

  async signOut() {
    // Nothing to tear down until a real session exists.
  }
}

let cached: AuthClient | null = null;

export function getAuthClient(): AuthClient {
  cached ??= new LocalAuthClient();
  return cached;
}
