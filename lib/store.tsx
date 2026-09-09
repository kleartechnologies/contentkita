"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  DEMO_RESTAURANT,
  addDays,
  getContentGenerator,
  todayIso,
  type ContentItem,
  type ContentPlan,
  type RestaurantProfile,
} from "@/lib/content";

const PROFILE_KEY = "contentkita.profile.v1";
const VARIANTS_KEY = "contentkita.variants.v1";
const START_KEY = "contentkita.planStart.v1";

/* -------------------------------------------------------------------------- */
/* localStorage as an external store                                          */
/*                                                                            */
/* Milestone 1 has no backend, so the browser is the database. Reading it      */
/* through useSyncExternalStore keeps the server render and the hydration      */
/* render identical (both see `null`), then swaps in the real value on the     */
/* client. When Supabase arrives, only this section is replaced.               */
/* -------------------------------------------------------------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Keeps two open tabs of the same account in agreement.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private browsing or a full quota — the session still works in memory.
  }
  for (const listener of listeners) listener();
}

function parse<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const alwaysTrue = () => true;
const alwaysFalse = () => false;

function useStoredRaw(key: string): string | null {
  const getSnapshot = useCallback(() => readRaw(key), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/* -------------------------------------------------------------------------- */

interface AppState {
  /** `loading` until the browser has read local storage — drives skeletons. */
  status: "loading" | "generating" | "ready";
  /** The profile in use. Falls back to the sample restaurant before onboarding. */
  profile: RestaurantProfile;
  /** True while showing the built-in sample rather than the owner's own data. */
  isDemo: boolean;
  plan: ContentPlan | null;
  /** Day number of the plan that maps to today, 1-30. */
  todayDay: number;
  saveProfile: (profile: RestaurantProfile) => void;
  clearProfile: () => void;
  regenerateDay: (day: number) => Promise<void>;
  /** Days currently mid-regeneration, so buttons can show progress. */
  pendingDays: number[];
}

const AppContext = createContext<AppState | null>(null);

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useSyncExternalStore(subscribe, alwaysTrue, alwaysFalse);
  const rawProfile = useStoredRaw(PROFILE_KEY);
  const rawVariants = useStoredRaw(VARIANTS_KEY);
  const rawStart = useStoredRaw(START_KEY);

  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [pendingDays, setPendingDays] = useState<number[]>([]);

  const stored = useMemo(
    () => parse<RestaurantProfile>(rawProfile),
    [rawProfile],
  );
  const variants = useMemo(
    () => parse<Record<number, number>>(rawVariants) ?? {},
    [rawVariants],
  );
  const startDate = useMemo(
    () => parse<string>(rawStart) ?? todayIso(),
    [rawStart],
  );

  const profile = stored ?? DEMO_RESTAURANT;
  const isDemo = stored === null;

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    getContentGenerator()
      .generatePlan({ restaurant: profile, startDate, variants })
      .then((next) => {
        if (!cancelled) setPlan(next);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, profile, startDate, variants]);

  const saveProfile = useCallback((next: RestaurantProfile) => {
    const start = todayIso();
    const saved = { ...next, updatedAt: new Date().toISOString() };
    writeRaw(PROFILE_KEY, JSON.stringify(saved));
    // A new profile means a new plan: variants and the start date reset with it.
    writeRaw(VARIANTS_KEY, "{}");
    writeRaw(START_KEY, JSON.stringify(start));
  }, []);

  const clearProfile = useCallback(() => {
    writeRaw(PROFILE_KEY, null);
    writeRaw(VARIANTS_KEY, null);
    writeRaw(START_KEY, null);
  }, []);

  const regenerateDay = useCallback(
    async (day: number) => {
      setPendingDays((days) => [...days, day]);
      const current = variants[day] ?? 0;
      const item = await getContentGenerator().regenerateDay(
        { restaurant: profile, startDate, variants: { ...variants, [day]: current + 1 } },
        day,
      );

      // Normalised once the generator reports how many alternatives exist, so
      // the stored index cycles instead of growing without bound.
      writeRaw(
        VARIANTS_KEY,
        JSON.stringify({
          ...variants,
          [day]: (current + 1) % Math.max(item.variantCount, 1),
        }),
      );
      setPendingDays((days) => days.filter((d) => d !== day));
    },
    [profile, startDate, variants],
  );

  const todayDay = useMemo(() => {
    const elapsed = daysBetween(startDate, todayIso());
    return Math.min(Math.max(elapsed + 1, 1), plan?.items.length ?? 30);
  }, [startDate, plan?.items.length]);

  const status: AppState["status"] = !hydrated
    ? "loading"
    : plan
      ? "ready"
      : "generating";

  const value = useMemo<AppState>(
    () => ({
      status,
      profile,
      isDemo,
      plan,
      todayDay,
      saveProfile,
      clearProfile,
      regenerateDay,
      pendingDays,
    }),
    [
      status,
      profile,
      isDemo,
      plan,
      todayDay,
      saveProfile,
      clearProfile,
      regenerateDay,
      pendingDays,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

/** Looks up one day from the current plan. */
export function useContentDay(day: number): ContentItem | null {
  const { plan } = useApp();
  return plan?.items.find((i) => i.day === day) ?? null;
}

export { addDays };
