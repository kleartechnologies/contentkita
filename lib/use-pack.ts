"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ContentItem } from "@/lib/content";
import {
  assignPhotos,
  composePackDay,
  daysNeedingPhotos,
  missingItems,
  packStatus,
  photoPool,
  runPack,
  type Creative,
  type PackFailure,
  type PackStatus,
} from "@/lib/creative";
import { loadPackCreatives, savePackCreative } from "@/lib/firebase/packs";
import { friendlyMessage } from "@/lib/firebase/errors";
import { useApp } from "@/lib/store";

/**
 * The whole month of designs, as one screen's worth of state.
 *
 * ## Which month this is
 *
 * Every read and write is addressed to one pack. The designs for September's
 * pack live under that pack and nowhere else, so buying a second month adds
 * thirty more designs beside the first thirty rather than on top of them.
 *
 * ## Why this runs in the browser
 *
 * Every write here is made by the owner's own signed-in Firebase client. The
 * product deliberately has no Admin SDK, so there is no server that holds an
 * owner's credentials and could do this on their behalf — and that is the
 * point: a generation run cannot touch anybody else's plan because it has no
 * way to authenticate as anybody else. The security rules see exactly the
 * same request they see when the owner edits one poster by hand.
 *
 * ## Why it is safe to press twice
 *
 * Everything starts from what is already saved. `missingItems` is the
 * difference between the plan and Firestore, so a second run generates the
 * days that are missing and nothing else: thirty creatives, never sixty, and
 * never on top of a design the owner has edited. A run that half-finishes is
 * resumed by pressing the same button again.
 *
 * ## What it costs
 *
 * Nothing beyond the Firestore writes. No model is called anywhere in this
 * file or in `lib/creative/pack.ts` — the words were written and validated
 * once, during content generation, and composition only arranges them.
 */

export type PackDayStatus = "missing" | "generating" | "ready" | "failed";

export interface PackDay {
  item: ContentItem;
  creative: Creative | null;
  status: PackDayStatus;
  /** Why the last attempt failed, in the owner's language. */
  message: string | null;
}

/**
 * What one run actually did.
 *
 * Returned rather than only reported through state, so a caller that is
 * driving a sequence — words, then designs, then photographs — can tell
 * whether to move on or to stop and say something. Reading the hook's counters
 * straight after an `await` would read the render before the one that
 * recorded the result.
 */
export interface PackRunSummary {
  /** Designs saved by this run. */
  saved: number;
  /** Days this run could not save. Zero means the pack is complete. */
  failed: number;
}

export interface PackState {
  loading: boolean;
  /** A load failure. Generation failures live on the days themselves. */
  error: string | null;
  days: PackDay[];
  status: PackStatus;
  ready: number;
  total: number;
  running: boolean;
  /** Days whose last attempt failed, in day order. */
  failures: PackFailure[];
  /** How many of the owner's own photographs the pack has to work with. */
  photos: number;
  /** Saved designs with an empty photo slot the owner has not edited. */
  gaps: number;
  /** Generates every day that has no design yet. */
  generate: () => Promise<PackRunSummary>;
  /** Regenerates only the days whose last attempt failed. */
  retryFailed: () => Promise<PackRunSummary>;
  /** Puts the owner's uploaded photographs onto days that have none. */
  fillPhotos: () => Promise<void>;
}

/**
 * The designs one owner has saved, tagged with whose they are.
 *
 * The same shape the store uses for the plan itself, for the same reason:
 * carrying the uid alongside the data means the previous owner's work stops
 * being visible the instant the uid stops matching, with no cleanup step that
 * could be forgotten or arrive late.
 */
interface Loaded {
  uid: string;
  /** Which pack these designs belong to. Switching packs discards them. */
  packId: string;
  saved: Map<string, Creative>;
}

const NO_CREATIVES: Map<string, Creative> = new Map();

export function usePack(): PackState {
  const { user, profile, plan, activePackId } = useApp();
  const uid = user?.id ?? null;
  const packId = activePackId;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<
    { uid: string; packId: string; message: string } | null
  >(null);
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  const mine =
    loaded && loaded.uid === uid && loaded.packId === packId ? loaded : null;
  const saved = mine?.saved ?? NO_CREATIVES;
  const error =
    failure && failure.uid === uid && failure.packId === packId
      ? failure.message
      : null;
  const loading = !mine && !error;

  /** Records one saved design, against the owner and pack it belongs to. */
  const remember = useCallback(
    (owner: string, pack: string, creative: Creative) => {
      setLoaded((prev) =>
        prev && prev.uid === owner && prev.packId === pack
          ? { ...prev, saved: new Map(prev.saved).set(creative.itemId, creative) }
          : prev,
      );
    },
    [],
  );

  // Read inside a run without making the run depend on a render, and used to
  // drop late results after the owner signs out or the screen goes away.
  const alive = useRef(true);
  const state = useRef({ saved, profile, plan });
  useEffect(() => {
    state.current = { saved, profile, plan };
  }, [saved, profile, plan]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* --- what is already saved ---------------------------------------------- */

  useEffect(() => {
    const owner = uid;
    const pack = packId;
    if (!owner || !pack) return;
    let cancelled = false;

    (async () => {
      try {
        const list = await loadPackCreatives(owner, pack);
        if (cancelled) return;
        setLoaded({
          uid: owner,
          packId: pack,
          saved: new Map(list.map((creative) => [creative.itemId, creative])),
        });
      } catch (err) {
        if (!cancelled) {
          setFailure({ uid: owner, packId: pack, message: friendlyMessage(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, packId]);

  const items = useMemo(() => plan?.items ?? [], [plan]);
  const pool = useMemo(
    () => photoPool([...saved.values()], profile?.photos ?? []),
    [saved, profile],
  );

  const days = useMemo<PackDay[]>(
    () =>
      items.map((item) => {
        const creative = saved.get(item.id) ?? null;
        const message = failed.get(item.id) ?? null;
        const status: PackDayStatus = busy.has(item.id)
          ? "generating"
          : creative
            ? "ready"
            : message
              ? "failed"
              : "missing";
        return { item, creative, status, message };
      }),
    [items, saved, failed, busy],
  );

  const readyCount = days.filter((day) => day.status === "ready").length;
  const failures = useMemo<PackFailure[]>(
    () =>
      days
        .filter((day) => day.status === "failed")
        .map((day) => ({
          itemId: day.item.id,
          day: day.item.day,
          message: day.message ?? "",
        })),
    [days],
  );

  /* --- generating ---------------------------------------------------------- */

  /**
   * Composes and saves a set of days.
   *
   * The photograph assignment is computed over the whole plan rather than over
   * the targets, so retrying two failed days in the middle of the month hands
   * them the same pictures the first attempt would have — a retry repairs a
   * gap, it does not reshuffle the month.
   */
  const write = useCallback(
    async (targets: ContentItem[]): Promise<PackRunSummary> => {
      const owner = uid;
      const pack = packId;
      const restaurant = state.current.profile;
      const current = state.current.plan;
      if (!owner || !pack || !restaurant || !current || targets.length === 0) {
        // Nothing to do is not a failure: a pack that is already complete
        // reports a clean run, which is what it is.
        return { saved: 0, failed: 0 };
      }

      const photos = assignPhotos(
        current.items,
        photoPool([...state.current.saved.values()], restaurant.photos),
      );
      const ids = new Set(targets.map((item) => item.id));

      setRunning(true);
      setBusy(ids);
      setFailed((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.delete(id);
        return next;
      });

      try {
        const result = await runPack(
          targets,
          (item) => composePackDay(restaurant, current.id, item, photos),
          (creative) => savePackCreative(owner, pack, creative),
          {
            onSaved: (creative) => {
              if (!alive.current) return;
              // Counted up one day at a time, from designs that are actually
              // in Firestore — not from an estimate of how far along we are.
              remember(owner, pack, creative);
              setBusy((prev) => {
                const next = new Set(prev);
                next.delete(creative.itemId);
                return next;
              });
            },
            onFailed: (failure) => {
              if (!alive.current) return;
              setFailed((prev) =>
                new Map(prev).set(failure.itemId, failure.message),
              );
              setBusy((prev) => {
                const next = new Set(prev);
                next.delete(failure.itemId);
                return next;
              });
            },
          },
        );
        return { saved: result.saved.length, failed: result.failures.length };
      } finally {
        if (alive.current) {
          setRunning(false);
          setBusy(new Set());
        }
      }
    },
    [uid, packId, remember],
  );

  const generate = useCallback(async () => {
    const current = state.current.plan;
    if (!current) return { saved: 0, failed: 0 };
    return write(missingItems(current.items, [...state.current.saved.values()]));
  }, [write]);

  const retryFailed = useCallback(async () => {
    const current = state.current.plan;
    if (!current) return { saved: 0, failed: 0 };
    // Only days with no design saved: a day that has one is not a failure,
    // whatever an earlier attempt reported.
    const stale = new Set(
      current.items
        .filter((item) => !state.current.saved.has(item.id))
        .map((item) => item.id),
    );
    return write(current.items.filter((item) => stale.has(item.id)));
  }, [write]);

  /* --- photographs --------------------------------------------------------- */

  const gapDays = useMemo(
    () =>
      pool.length === 0
        ? []
        : daysNeedingPhotos([...saved.values()], assignPhotos(items, pool)),
    [pool, saved, items],
  );

  /**
   * Rebuilds the days that should be showing a photograph and are not.
   *
   * Recomposed rather than patched. A pack generated before the owner uploaded
   * anything is thirty typographic posters — there is no empty slot to drop a
   * picture into, because a layout with a hole in it was never composed in the
   * first place. Handing those days photographs means giving them the layouts
   * that are built around photographs, which is what the composer does when it
   * is told there are pictures.
   *
   * Separate from generation, and never automatic: quietly rewriting posters
   * the owner has already looked at is not help. Days they have edited are
   * left alone entirely.
   */
  const fillPhotos = useCallback(async () => {
    const owner = uid;
    const pack = packId;
    const current = state.current.plan;
    const restaurant = state.current.profile;
    if (!owner || !pack || !current || !restaurant) return;

    const all = [...state.current.saved.values()];
    const photos = assignPhotos(
      current.items,
      photoPool(all, restaurant.photos),
    );
    const gaps = daysNeedingPhotos(all, photos);
    if (gaps.length === 0) return;

    const byId = new Map(current.items.map((item) => [item.id, item]));
    setRunning(true);
    setBusy(new Set(gaps.map((creative) => creative.itemId)));
    try {
      for (const creative of gaps) {
        const item = byId.get(creative.itemId);
        if (!item) continue;
        // The owner's own filename survives: they may have renamed the day,
        // and this action is about the picture, not the label.
        const next: Creative = {
          ...composePackDay(restaurant, current.id, item, photos),
          name: creative.name,
          createdAt: creative.createdAt,
        };
        try {
          await savePackCreative(owner, pack, next);
          if (!alive.current) return;
          remember(owner, pack, next);
        } catch (err) {
          if (!alive.current) return;
          setFailed((prev) =>
            new Map(prev).set(next.itemId, friendlyMessage(err)),
          );
        }
      }
    } finally {
      if (alive.current) {
        setRunning(false);
        setBusy(new Set());
      }
    }
  }, [uid, packId, remember]);

  return {
    loading,
    error,
    days,
    status: packStatus({
      total: items.length,
      ready: readyCount,
      failed: failures.length,
      running,
    }),
    ready: readyCount,
    total: items.length,
    running,
    failures,
    photos: pool.length,
    gaps: gapDays.length,
    generate,
    retryFailed,
    fillPhotos,
  };
}
