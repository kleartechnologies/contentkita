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
import { ensureUserDoc, loadRestaurant, saveRestaurant } from "@/lib/firebase/data";
import {
  loadPacks,
  savePackItem,
  savePackName,
  savePackPlan,
  savePackStatus,
} from "@/lib/firebase/packs";
import { friendlyMessage } from "@/lib/firebase/errors";
import { packSummary } from "@/lib/packs/codecs";
import type { Pack, PackSummary } from "@/lib/packs/types";
import { migrateLegacyPack, startCheckout } from "@/lib/payment/checkout";

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
/*                                                                            */
/* ## Since M5: packs, not "the plan"                                          */
/*                                                                            */
/* An owner no longer has one plan. They have a list of packs, one per         */
/* purchase, and the screens look at whichever one is active. Generation       */
/* writes into that pack and no other — which is the whole reason a second     */
/* RM39.90 does not overwrite the first month.                                 */
/*                                                                            */
/* Nothing here can create a pack or mark one paid. Both are server-side, off  */
/* the back of a signed Billplz callback; this file only ever reads the        */
/* entitlement and writes content into a pack that already has one.            */
/* -------------------------------------------------------------------------- */

export type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

/**
 * `needs-onboarding` is a signed-in owner with no restaurant saved yet — the
 * only legitimate way to reach onboarding. `ready` means the restaurant is
 * saved; there may still be no pack, because buying one and generating into it
 * are explicit acts the owner asks for rather than things that happen to them.
 */
export type DataStatus = "loading" | "needs-onboarding" | "ready" | "error";

interface AppState {
  authStatus: AuthStatus;
  user: AuthUser | null;
  status: DataStatus;
  /** `null` until onboarding is complete. */
  profile: RestaurantProfile | null;
  /** The content of the pack currently being looked at. */
  plan: ContentPlan | null;
  /** Every pack this owner has bought or been grandfathered, newest first. */
  packs: PackSummary[];
  /** Which pack the rest of this state describes. */
  activePackId: string | null;
  /** The active pack itself, for screens that need its entitlement state. */
  activePack: Pack | null;
  /** Day number of the plan that maps to today, 1-30. */
  todayDay: number;
  /** A user-facing message in BM when loading failed. Never a raw SDK string. */
  error: string | null;
  /** Onboarding: save the restaurant. Does not generate anything. */
  completeOnboarding: (profile: RestaurantProfile) => Promise<void>;
  /** Profile edits. Deliberately does not touch any existing pack. */
  saveProfile: (profile: RestaurantProfile) => Promise<void>;
  /**
   * Builds all 30 days into the active pack. Always owner-initiated.
   *
   * Requires a pack that has been paid for. It writes into that pack and no
   * other, so a second purchase is generated separately and the first month is
   * never overwritten. A failure leaves the pack paid and marked `failed`, so
   * pressing the button again costs nothing.
   */
  regeneratePlan: (
    onStage?: (stage: GenerationStage) => void,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<void>;
  /** Switches which pack the screens are showing. */
  selectPack: (packId: string) => void;
  /**
   * Starts a purchase and hands back the hosted checkout URL.
   *
   * Creates no pack and grants nothing — a pack appears only when Billplz
   * tells our server, over a signed callback, that the money arrived.
   */
  buyPack: () => Promise<string>;
  /** Re-reads the owner's packs, after paying or after generating. */
  refreshPacks: () => Promise<void>;
  regenerateDay: (day: number) => Promise<void>;
  /**
   * Renames the active pack. The pack's days are not touched.
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
 * previous owner's restaurant and packs stop being visible the instant the uid
 * stops matching, with no cleanup step that could be forgotten or arrive late.
 */
interface Loaded {
  uid: string;
  profile: RestaurantProfile | null;
  packs: Pack[];
  activePackId: string | null;
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

const NO_PACKS: Pack[] = [];
const NO_SUMMARIES: PackSummary[] = [];

/** Shown when generation is asked for with nothing paid for to put it in. */
const NEEDS_PACK =
  "Anda belum ada pack untuk dijana. Beli pack 30 hari dahulu.";

/**
 * Which pack the screens should be looking at.
 *
 * Keeps the owner's choice when it still exists, and otherwise falls to the
 * newest pack — which after a purchase is the one they just paid for and are
 * waiting to generate.
 */
function pickActive(packs: Pack[], preferred?: string | null): string | null {
  if (preferred && packs.some((pack) => pack.id === preferred)) return preferred;
  return packs[0]?.id ?? null;
}

function findPack(packs: Pack[], packId: string | null): Pack | null {
  if (!packId) return null;
  return packs.find((pack) => pack.id === packId) ?? null;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

async function buildPlan(
  profile: RestaurantProfile,
  packId: string,
  startDate: string,
  onStage?: (stage: GenerationStage) => void,
  onProgress?: (done: number, total: number) => void,
) {
  return getContentGenerator().generatePlan({
    restaurant: profile,
    // Carried through to the route, which checks it against the pack document
    // before spending anything. The browser saying "paid" is not what makes it
    // paid; this is only the id of the thing to go and check.
    packId,
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
          setLoaded({ uid: owner, profile: null, packs: [], activePackId: null });
          return;
        }

        let packs = await loadPacks(owner);
        if (cancelled) return;

        // An owner from before payment existed has a month at
        // `contentPlans/{uid}` and no packs. The server grandfathers it into
        // one — never charging for it, never deleting the original, and never
        // twice. Anything that goes wrong here leaves them with no packs
        // rather than with an error screen over content they already own.
        if (packs.length === 0) {
          const migrated = await migrateLegacyPack().catch(() => false);
          if (cancelled) return;
          if (migrated) packs = await loadPacks(owner);
          if (cancelled) return;
        }

        // Deliberately no generation here. A paid pack with nothing in it gets
        // a dashboard that offers to build it; generating on load would spend
        // an owner's month of content on a page refresh, and would do it again
        // every time the browser reloaded before the write landed.
        setLoaded({
          uid: owner,
          profile: restaurant,
          packs,
          activePackId: pickActive(packs),
        });
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
  const owned = mine?.packs ?? NO_PACKS;
  const activePackId = mine?.activePackId ?? null;
  const activePack = useMemo(
    () => findPack(owned, activePackId),
    [owned, activePackId],
  );
  const plan = activePack?.plan ?? null;
  const packs = useMemo(
    () => (owned.length === 0 ? NO_SUMMARIES : owned.map(packSummary)),
    [owned],
  );
  const error = failure && failure.uid === uid ? failure.message : null;

  /**
   * The same data, readable without waiting for a render.
   *
   * Onboarding saves the restaurant and then immediately acts on it, both
   * inside one click handler. React has not re-rendered in between, so a
   * callback that closed over `profile` would still be looking at the `null`
   * from before the save — which is exactly what a brand new owner would hit on
   * their very first attempt. The mutations below read through this ref so they
   * act on what is true now, not on what was true when they were created.
   */
  const latest = useRef<{
    profile: RestaurantProfile | null;
    packs: Pack[];
    activePackId: string | null;
  }>({ profile: null, packs: NO_PACKS, activePackId: null });
  useEffect(() => {
    latest.current = { profile, packs: owned, activePackId };
  }, [profile, owned, activePackId]);

  const status: DataStatus = error
    ? "error"
    : !mine
      ? "loading"
      : mine.profile
        ? "ready"
        : "needs-onboarding";

  /* --- Mutations ---------------------------------------------------------- */

  /** Replaces one pack in place, and only for the owner it belongs to. */
  const patchPack = useCallback(
    (owner: string, packId: string, change: (pack: Pack) => Pack) => {
      setLoaded((prev) => {
        if (!prev || prev.uid !== owner) return prev;
        if (!prev.packs.some((pack) => pack.id === packId)) return prev;
        return {
          ...prev,
          packs: prev.packs.map((pack) =>
            pack.id === packId ? change(pack) : pack,
          ),
        };
      });
      latest.current = {
        ...latest.current,
        packs: latest.current.packs.map((pack) =>
          pack.id === packId ? change(pack) : pack,
        ),
      };
    },
    [],
  );

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
        // Buying and generating are separate, explicit steps, so a failure in
        // either never costs the owner the twenty answers they just typed —
        // those are already saved by the time anything else runs.
        latest.current = { ...latest.current, profile: saved };
        setLoaded((prev) => ({
          uid,
          profile: saved,
          packs: prev && prev.uid === uid ? prev.packs : [],
          activePackId: prev && prev.uid === uid ? prev.activePackId : null,
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
        // The packs stay exactly as they are. Rebuilding thirty days because
        // someone fixed a typo in their address would throw away posts they may
        // already have used — regeneration is the owner's call, not a side
        // effect of saving.
        await saveRestaurant(uid, saved);
        latest.current = { ...latest.current, profile: saved };
        setLoaded((prev) =>
          prev && prev.uid === uid ? { ...prev, profile: saved } : prev,
        );
      }),
    [uid],
  );

  /* --- Packs and paying for them ------------------------------------------ */

  const refreshPacks = useCallback(
    async () =>
      guarded(async () => {
        if (!uid) return;
        const fresh = await loadPacks(uid);
        latest.current = {
          ...latest.current,
          packs: fresh,
          activePackId: pickActive(fresh, latest.current.activePackId),
        };
        setLoaded((prev) =>
          prev && prev.uid === uid
            ? {
                ...prev,
                packs: fresh,
                activePackId: pickActive(fresh, prev.activePackId),
              }
            : prev,
        );
      }),
    [uid],
  );

  const selectPack = useCallback((packId: string) => {
    setLoaded((prev) =>
      prev && prev.packs.some((pack) => pack.id === packId)
        ? { ...prev, activePackId: packId }
        : prev,
    );
    latest.current = { ...latest.current, activePackId: packId };
  }, []);

  /**
   * Asks the server to start a purchase.
   *
   * Everything that matters happens on the other side of this call: the price,
   * the order, the bill. What comes back is a URL and nothing more — no pack,
   * no entitlement, no claim that anything has been paid.
   */
  const buyPack = useCallback(async () => {
    // Not wrapped in `guarded`: checkout failures already arrive as one
    // finished Malay sentence, and re-mapping them would lose the specific
    // reason in favour of a generic one.
    const checkout = await startCheckout();
    return checkout.checkoutUrl;
  }, []);

  /* --- Generating into a pack --------------------------------------------- */

  const regeneratePlan = useCallback(
    async (
      onStage?: (stage: GenerationStage) => void,
      onProgress?: (done: number, total: number) => void,
    ) =>
      guarded(async () => {
        const current = latest.current.profile;
        if (!uid || !current) throw new Error("Nothing to regenerate");

        const pack = findPack(latest.current.packs, latest.current.activePackId);
        if (!pack) throw new Error(NEEDS_PACK);
        // The rules say the same thing and are what actually enforces it. This
        // is here so an owner gets a sentence instead of a permission error.
        if (pack.paymentStatus !== "paid") throw new Error(NEEDS_PACK);

        setRegeneratingPlan(true);
        try {
          // Recorded before the model is called, so a browser that closes
          // mid-run leaves a pack that says what happened to it.
          await savePackStatus(uid, pack.id, "generating");
          patchPack(uid, pack.id, (p) => ({ ...p, generationStatus: "generating" }));

          const built = await buildPlan(
            current,
            pack.id,
            todayIso(),
            onStage,
            onProgress,
          );
          // The name is the owner's, not the generator's. Rebuilding the month
          // is not a reason to take their label off it.
          const fresh = { ...built, packName: pack.name || built.packName };
          onStage?.("saving");
          await savePackPlan(uid, pack.id, fresh, "ready");
          patchPack(uid, pack.id, (p) => ({
            ...p,
            plan: fresh,
            generationStatus: "ready",
            updatedAt: new Date().toISOString(),
          }));
        } catch (err) {
          // The pack stays paid. Only the generation failed, and the retry is
          // free — that separation is the entire reason the two statuses are
          // two fields.
          patchPack(uid, pack.id, (p) => ({ ...p, generationStatus: "failed" }));
          await savePackStatus(uid, pack.id, "failed").catch(() => {});
          throw err;
        } finally {
          setRegeneratingPlan(false);
        }
      }),
    [uid, patchPack],
  );

  const regenerateDay = useCallback(
    async (day: number) => {
      if (!uid || !profile || !plan || !activePack) return;
      const current = plan.items.find((i) => i.day === day);
      if (!current) return;

      const packId = activePack.id;
      setPending((days) => [...days, day]);
      // Normalised so the index cycles through the available alternatives
      // instead of growing without bound.
      const nextIndex =
        (current.variantIndex + 1) % Math.max(current.variantCount, 1);

      try {
        const item: ContentItem = await getContentGenerator().regenerateDay(
          {
            restaurant: profile,
            packId,
            startDate: plan.startDate,
            variants: { [day]: nextIndex },
            // So a rewrite is a different post, not a paraphrase of the one
            // already on screen.
            avoidHooks: [current.hook],
          },
          day,
        );
        // Show it straight away, then persist. Only this one day changes; the
        // other twenty-nine are written back exactly as they were loaded, and
        // only into this pack.
        patchPack(uid, packId, (p) =>
          p.plan ? { ...p, plan: replaceItem(p.plan, item) } : p,
        );
        await savePackItem(uid, packId, plan, item);
      } catch (err) {
        // Put the original day back so the screen never shows a version that
        // did not reach the database.
        patchPack(uid, packId, (p) =>
          p.plan ? { ...p, plan: replaceItem(p.plan, current) } : p,
        );
        throw new Error(friendlyMessage(err));
      } finally {
        setPending((days) => days.filter((d) => d !== day));
      }
    },
    [uid, profile, plan, activePack, patchPack],
  );

  const editDay = useCallback(
    async (day: number, patch: EditableFields) => {
      if (!uid || !plan || !activePack) return;
      const current = plan.items.find((i) => i.day === day);
      if (!current) return;

      const packId = activePack.id;
      const next: ContentItem = {
        ...current,
        ...trimmed(patch),
        // Marked so regeneration can warn before overwriting the owner's own
        // words, and so the screen can show which days they have touched.
        edited: true,
      };

      patchPack(uid, packId, (p) =>
        p.plan ? { ...p, plan: replaceItem(p.plan, next) } : p,
      );

      try {
        await savePackItem(uid, packId, plan, next);
      } catch (err) {
        patchPack(uid, packId, (p) =>
          p.plan ? { ...p, plan: replaceItem(p.plan, current) } : p,
        );
        throw new Error(friendlyMessage(err));
      }
    },
    [uid, plan, activePack, patchPack],
  );

  const renamePack = useCallback(
    async (name: string) =>
      guarded(async () => {
        const pack = findPack(latest.current.packs, latest.current.activePackId);
        if (!uid || !pack) return;
        const next = name.trim().slice(0, 80);
        if (!next || next === pack.name) return;

        // Shown first, then persisted. A failure puts the old name back rather
        // than leaving the owner looking at one that never landed.
        patchPack(uid, pack.id, (p) => ({
          ...p,
          name: next,
          plan: p.plan ? { ...p.plan, packName: next } : p.plan,
        }));
        try {
          await savePackName(uid, pack.id, next);
        } catch (err) {
          patchPack(uid, pack.id, (p) => ({
            ...p,
            name: pack.name,
            plan: p.plan ? { ...p.plan, packName: pack.name } : p.plan,
          }));
          throw err;
        }
      }),
    [uid, patchPack],
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
      packs,
      activePackId,
      activePack,
      todayDay,
      error,
      completeOnboarding,
      saveProfile,
      regeneratePlan,
      selectPack,
      buyPack,
      refreshPacks,
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
      packs,
      activePackId,
      activePack,
      todayDay,
      error,
      completeOnboarding,
      saveProfile,
      regeneratePlan,
      selectPack,
      buyPack,
      refreshPacks,
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

/** Looks up one day from the active pack. */
export function useContentDay(day: number): ContentItem | null {
  const { plan } = useApp();
  return plan?.items.find((i) => i.day === day) ?? null;
}

export { addDays };
