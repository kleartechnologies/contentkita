"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  addDays,
  getContentGenerator,
  todayIso,
  type ContentItem,
  type ContentPlan,
  type GenerationStage,
  type RestaurantProfile,
} from "@/lib/content";
import { getAuthClient, type AuthUser } from "@/lib/auth";
import { replaceItem } from "@/lib/firebase/codecs";
import {
  ensureUserDoc,
  loadPlan,
  loadRestaurant,
  savePackName,
  savePlan,
  savePlanItem,
  saveRestaurant,
} from "@/lib/firebase/data";
import { friendlyMessage } from "@/lib/firebase/errors";

/* -------------------------------------------------------------------------- */
/* Application state, backed by Firebase                                      */
/*                                                                            */
/* Milestone 1 kept everything in localStorage. Now Firebase Auth owns the     */
/* session and Firestore owns the data, so this file is the place where the    */
/* two meet: an auth listener drives loading, and every mutation writes        */
/* through to Firestore before it is considered done.                         */
/*                                                                            */
/* localStorage is deliberately not consulted for anything. It is not the      */
/* source of truth for who is signed in, nor for what they have saved.        */
/* -------------------------------------------------------------------------- */

export type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

/**
 * `needs-onboarding` is a signed-in owner with no restaurant saved yet — the
 * only legitimate way to reach onboarding. `ready` means the restaurant is
 * saved; the plan may still be `null`, because generating one is an explicit
 * act the owner asks for rather than something that happens to them.
 */
export type DataStatus = "loading" | "needs-onboarding" | "ready" | "error";

interface AppState {
  authStatus: AuthStatus;
  user: AuthUser | null;
  status: DataStatus;
  /** `null` until onboarding is complete. */
  profile: RestaurantProfile | null;
  plan: ContentPlan | null;
  /** Day number of the plan that maps to today, 1-30. */
  todayDay: number;
  /** A user-facing message in BM when loading failed. Never a raw SDK string. */
  error: string | null;
  /** Onboarding: save the restaurant. Does not generate anything. */
  completeOnboarding: (profile: RestaurantProfile) => Promise<void>;
  /** Profile edits. Deliberately does not touch the existing plan. */
  saveProfile: (profile: RestaurantProfile) => Promise<void>;
  /**
   * Builds all 30 days and stores them, replacing any existing plan. Always
   * owner-initiated — from the end of onboarding, or from the profile screen.
   */
  regeneratePlan: (
    onStage?: (stage: GenerationStage) => void,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<void>;
  regenerateDay: (day: number) => Promise<void>;
  /**
   * Renames the content pack. The plan's days are not touched.
   *
   * Separate from `editDay` because it is the owner labelling their month of
   * work, not editing any post in it.
   */
  renamePack: (name: string) => Promise<void>;
  /** Owner edits to one day's copy. Persisted, and marks the day as edited. */
  editDay: (day: number, patch: EditableFields) => Promise<void>;
  /** Days currently mid-regeneration, so buttons can show progress. */
  pendingDays: number[];
  /** True while a full-plan regeneration is running. */
  regeneratingPlan: boolean;
  signOut: () => Promise<void>;
  retry: () => void;
}

const AppContext = createContext<AppState | null>(null);

/**
 * What one owner has loaded, tagged with whose it is.
 *
 * Carrying the uid alongside the data is what makes signing out safe: the
 * previous owner's restaurant stops being visible the instant the uid stops
 * matching, with no cleanup step that could be forgotten or arrive late.
 */
interface Loaded {
  uid: string;
  profile: RestaurantProfile | null;
  plan: ContentPlan | null;
}

interface Failure {
  uid: string;
  message: string;
}

/** The parts of a day an owner may rewrite by hand. */
export interface EditableFields {
  hook?: string;
  caption?: string;
  cta?: string;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

async function buildPlan(
  profile: RestaurantProfile,
  startDate: string,
  onStage?: (stage: GenerationStage) => void,
  onProgress?: (done: number, total: number) => void,
) {
  return getContentGenerator().generatePlan({
    restaurant: profile,
    startDate,
    onStage,
    onProgress,
  });
}

/**
 * Every mutation funnels its failures through here, so a screen that catches an
 * error can show `err.message` without ever putting a raw SDK string — or an
 * internal guard clause — in front of an owner.
 */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw new Error(friendlyMessage(err));
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("unknown");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState<number[]>([]);
  const [regeneratingPlan, setRegeneratingPlan] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    return getAuthClient().subscribe((next) => {
      setUser(next);
      setAuthStatus(next ? "authenticated" : "unauthenticated");
    });
  }, []);

  const uid = user?.id ?? null;

  useEffect(() => {
    if (authStatus !== "authenticated" || !user) return;

    const owner = user.id;
    let cancelled = false;

    (async () => {
      try {
        await ensureUserDoc(owner, user.email);
        const restaurant = await loadRestaurant(owner);
        if (cancelled) return;

        if (!restaurant) {
          setLoaded({ uid: owner, profile: null, plan: null });
          return;
        }

        const existing = await loadPlan(owner);
        if (cancelled) return;

        // Deliberately no generation here. A restaurant with no plan gets a
        // dashboard that offers to build one; generating on load would spend
        // an owner's month of content on a page refresh, and would do it again
        // every time the browser reloaded before the write landed.
        setLoaded({ uid: owner, profile: restaurant, plan: existing });
      } catch (err) {
        if (cancelled) return;
        setFailure({ uid: owner, message: friendlyMessage(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, user, attempt]);

  /* --- Derived, never synchronised ---------------------------------------- */

  const mine = loaded && loaded.uid === uid ? loaded : null;
  const profile = mine?.profile ?? null;
  const plan = mine?.plan ?? null;
  const error = failure && failure.uid === uid ? failure.message : null;

  /**
   * The same data, readable without waiting for a render.
   *
   * Onboarding saves the restaurant and then immediately generates a plan, both
   * inside one click handler. React has not re-rendered in between, so a
   * callback that closed over `profile` would still be looking at the `null`
   * from before the save and would refuse to generate — which is exactly what
   * a brand new owner would hit on their very first attempt. The mutations
   * below read through this ref so they act on what is true now, not on what
   * was true when they were created.
   */
  const latest = useRef<{ profile: RestaurantProfile | null; plan: ContentPlan | null }>({
    profile: null,
    plan: null,
  });
  useEffect(() => {
    latest.current = { profile, plan };
  }, [profile, plan]);

  const status: DataStatus = error
    ? "error"
    : !mine
      ? "loading"
      : mine.profile
        ? "ready"
        : "needs-onboarding";

  /* --- Mutations ---------------------------------------------------------- */

  const completeOnboarding = useCallback(
    async (next: RestaurantProfile) =>
      guarded(async () => {
        if (!uid) throw new Error("Not signed in");
        const saved: RestaurantProfile = {
          ...next,
          id: uid,
          updatedAt: new Date().toISOString(),
        };
        await saveRestaurant(uid, saved);
        // The plan is generated by a separate, explicit step so that a
        // generation failure never costs the owner the twenty answers they
        // just typed — those are already saved by the time it runs.
        latest.current = { profile: saved, plan: latest.current.plan };
        setLoaded((prev) => ({
          uid,
          profile: saved,
          plan: prev && prev.uid === uid ? prev.plan : null,
        }));
      }),
    [uid],
  );

  const saveProfile = useCallback(
    async (next: RestaurantProfile) =>
      guarded(async () => {
        if (!uid) throw new Error("Not signed in");
        const saved: RestaurantProfile = {
          ...next,
          id: uid,
          updatedAt: new Date().toISOString(),
        };
        // The plan stays exactly as it is. Rebuilding thirty days because
        // someone fixed a typo in their address would throw away posts they may
        // already have used — regeneration is the owner's call, not a side
        // effect of saving.
        await saveRestaurant(uid, saved);
        latest.current = { profile: saved, plan: latest.current.plan };
        setLoaded((prev) =>
          prev && prev.uid === uid ? { ...prev, profile: saved } : prev,
        );
      }),
    [uid],
  );

  const regeneratePlan = useCallback(
    async (
      onStage?: (stage: GenerationStage) => void,
      onProgress?: (done: number, total: number) => void,
    ) =>
      guarded(async () => {
        const current = latest.current.profile;
        if (!uid || !current) throw new Error("Nothing to regenerate");
        setRegeneratingPlan(true);
        try {
          const built = await buildPlan(current, todayIso(), onStage, onProgress);
          // The name is the owner's, not the generator's. Rebuilding the month
          // is not a reason to take their label off it.
          const fresh = { ...built, packName: latest.current.plan?.packName ?? "" };
          onStage?.("saving");
          await savePlan(uid, fresh);
          latest.current = { profile: current, plan: fresh };
          setLoaded((prev) =>
            prev && prev.uid === uid ? { ...prev, plan: fresh } : prev,
          );
        } finally {
          setRegeneratingPlan(false);
        }
      }),
    [uid],
  );

  const regenerateDay = useCallback(
    async (day: number) => {
      if (!uid || !profile || !plan) return;
      const current = plan.items.find((i) => i.day === day);
      if (!current) return;

      setPending((days) => [...days, day]);
      // Normalised so the index cycles through the available alternatives
      // instead of growing without bound.
      const nextIndex =
        (current.variantIndex + 1) % Math.max(current.variantCount, 1);

      try {
        const item: ContentItem = await getContentGenerator().regenerateDay(
          {
            restaurant: profile,
            startDate: plan.startDate,
            variants: { [day]: nextIndex },
            // So a rewrite is a different post, not a paraphrase of the one
            // already on screen.
            avoidHooks: [current.hook],
          },
          day,
        );
        // Show it straight away, then persist. Only this one day changes; the
        // other twenty-nine are written back exactly as they were loaded.
        setLoaded((prev) =>
          prev && prev.uid === uid && prev.plan
            ? { ...prev, plan: replaceItem(prev.plan, item) }
            : prev,
        );
        await savePlanItem(uid, plan, item);
      } catch (err) {
        // Put the original day back so the screen never shows a version that
        // did not reach the database.
        setLoaded((prev) =>
          prev && prev.uid === uid && prev.plan
            ? { ...prev, plan: replaceItem(prev.plan, current) }
            : prev,
        );
        throw new Error(friendlyMessage(err));
      } finally {
        setPending((days) => days.filter((d) => d !== day));
      }
    },
    [uid, profile, plan],
  );

  const editDay = useCallback(
    async (day: number, patch: EditableFields) => {
      if (!uid || !plan) return;
      const current = plan.items.find((i) => i.day === day);
      if (!current) return;

      const next: ContentItem = {
        ...current,
        ...trimmed(patch),
        // Marked so regeneration can warn before overwriting the owner's own
        // words, and so the screen can show which days they have touched.
        edited: true,
      };

      setLoaded((prev) =>
        prev && prev.uid === uid && prev.plan
          ? { ...prev, plan: replaceItem(prev.plan, next) }
          : prev,
      );

      try {
        await savePlanItem(uid, plan, next);
      } catch (err) {
        setLoaded((prev) =>
          prev && prev.uid === uid && prev.plan
            ? { ...prev, plan: replaceItem(prev.plan, current) }
            : prev,
        );
        throw new Error(friendlyMessage(err));
      }
    },
    [uid, plan],
  );

  const renamePack = useCallback(
    async (name: string) =>
      guarded(async () => {
        const current = latest.current.plan;
        if (!uid || !current) return;
        const next = name.trim().slice(0, 80);
        if (!next || next === current.packName) return;

        // Shown first, then persisted. A failure puts the old name back rather
        // than leaving the owner looking at one that never landed.
        setLoaded((prev) =>
          prev && prev.uid === uid && prev.plan
            ? { ...prev, plan: { ...prev.plan, packName: next } }
            : prev,
        );
        try {
          await savePackName(uid, next);
        } catch (err) {
          setLoaded((prev) =>
            prev && prev.uid === uid && prev.plan
              ? { ...prev, plan: { ...prev.plan, packName: current.packName ?? "" } }
              : prev,
          );
          throw err;
        }
      }),
    [uid],
  );

  const signOut = useCallback(
    async () => guarded(() => getAuthClient().signOut()),
    [],
  );

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  const todayDay = useMemo(() => {
    if (!plan) return 1;
    const elapsed = daysBetween(plan.startDate, todayIso());
    return Math.min(Math.max(elapsed + 1, 1), plan.items.length || 30);
  }, [plan]);

  // Stable identity so the context value below does not change every render.
  const pendingDays = useMemo(() => (mine ? pending : []), [mine, pending]);

  const value = useMemo<AppState>(
    () => ({
      authStatus,
      user,
      status,
      profile,
      plan,
      todayDay,
      error,
      completeOnboarding,
      saveProfile,
      regeneratePlan,
      regenerateDay,
      editDay,
      renamePack,
      pendingDays,
      regeneratingPlan,
      signOut,
      retry,
    }),
    [
      authStatus,
      user,
      status,
      profile,
      plan,
      todayDay,
      error,
      completeOnboarding,
      saveProfile,
      regeneratePlan,
      regenerateDay,
      editDay,
      renamePack,
      pendingDays,
      regeneratingPlan,
      signOut,
      retry,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * Empty edits are dropped rather than saved.
 *
 * Clearing a caption to nothing is almost always a slip, and an owner who meant
 * it can regenerate the day. Saving the blank would lose the only copy.
 */
function trimmed(patch: EditableFields): EditableFields {
  const out: EditableFields = {};
  for (const key of ["hook", "caption", "cta"] as const) {
    const value = patch[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
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
