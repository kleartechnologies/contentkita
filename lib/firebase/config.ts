/**
 * Firebase Web configuration.
 *
 * Every value here is public by design: it identifies the project to Firebase
 * and ships in the browser bundle. Access control lives in Firestore Security
 * Rules and Firebase Auth, never in hiding these strings.
 *
 * Nothing secret belongs in this file or in any NEXT_PUBLIC_ variable — no
 * service account, no Admin SDK credential, no private key. Those would be
 * compiled straight into the client bundle.
 *
 * Next.js inlines NEXT_PUBLIC_* at build time only for statically analysable
 * member expressions, so each variable is read literally rather than through a
 * loop over a list of names.
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const RAW: Record<keyof FirebaseConfig, string | undefined> = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const ENV_NAME: Record<keyof FirebaseConfig, string> = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
};

/** Which required variables are missing. Empty array means fully configured. */
export function missingConfigKeys(): string[] {
  return (Object.keys(RAW) as (keyof FirebaseConfig)[])
    .filter((key) => !RAW[key]?.trim())
    .map((key) => ENV_NAME[key]);
}

export function isFirebaseConfigured(): boolean {
  return missingConfigKeys().length === 0;
}

export class FirebaseConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Firebase is not configured. Missing environment ${
        missing.length === 1 ? "variable" : "variables"
      }: ${missing.join(", ")}. Copy .env.example to .env.local and fill in the values from the Firebase console (Project settings › Your apps › Web app).`,
    );
    this.name = "FirebaseConfigError";
    this.missing = missing;
  }
}

/**
 * The config, or a loud failure.
 *
 * Deliberately throws rather than returning a partial object: a half-configured
 * Firebase app fails later with an opaque SDK error, and — more importantly —
 * a missing configuration must never quietly degrade into a fake local session.
 */
export function getFirebaseConfig(): FirebaseConfig {
  const missing = missingConfigKeys();
  if (missing.length > 0) throw new FirebaseConfigError(missing);

  return {
    apiKey: RAW.apiKey!,
    authDomain: RAW.authDomain!,
    projectId: RAW.projectId!,
    storageBucket: RAW.storageBucket!,
    messagingSenderId: RAW.messagingSenderId!,
    appId: RAW.appId!,
  };
}
