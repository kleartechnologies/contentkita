/**
 * The authentication boundary.
 *
 * Every screen talks to `getAuthClient()` and nothing else. Milestone 1 shipped
 * this interface with a local stub behind it; Milestone 2 replaced the stub
 * with Firebase Authentication. The interface gained auth *state* — a stub with
 * no session did not need it, a real one does.
 *
 * There is deliberately no mock implementation left in this file. A fallback
 * that accepts arbitrary credentials is the kind of thing that survives into
 * production by accident, so the only way to run ContentKita is against a real
 * Firebase project. A missing configuration throws (see `lib/firebase/config`)
 * rather than quietly degrading into a fake session.
 */

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

import { firebaseAuth } from "./firebase/client";
import { friendlyMessage } from "./firebase/errors";

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
  /**
   * Fires immediately with the restored session (or `null`), then on every
   * change. This — not localStorage — is the source of truth for "is somebody
   * signed in".
   */
  subscribe(listener: (user: AuthUser | null) => void): () => void;
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

function toAuthUser(user: User): AuthUser {
  return { id: user.uid, email: user.email ?? "" };
}

class FirebaseAuthClient implements AuthClient {
  readonly kind = "firebase";

  async signUp(input: Credentials): Promise<AuthResult> {
    const problem = validate(input);
    if (problem) return { ok: false, error: problem };
    try {
      const credential = await createUserWithEmailAndPassword(
        firebaseAuth(),
        input.email.trim(),
        input.password,
      );
      return { ok: true, user: toAuthUser(credential.user) };
    } catch (error) {
      return { ok: false, error: friendlyMessage(error) };
    }
  }

  async signIn(input: Credentials): Promise<AuthResult> {
    const problem = validate(input);
    if (problem) return { ok: false, error: problem };
    try {
      const credential = await signInWithEmailAndPassword(
        firebaseAuth(),
        input.email.trim(),
        input.password,
      );
      return { ok: true, user: toAuthUser(credential.user) };
    } catch (error) {
      return { ok: false, error: friendlyMessage(error) };
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(firebaseAuth());
  }

  subscribe(listener: (user: AuthUser | null) => void): () => void {
    return onAuthStateChanged(firebaseAuth(), (user) => {
      listener(user ? toAuthUser(user) : null);
    });
  }
}

let cached: AuthClient | null = null;

export function getAuthClient(): AuthClient {
  cached ??= new FirebaseAuthClient();
  return cached;
}
