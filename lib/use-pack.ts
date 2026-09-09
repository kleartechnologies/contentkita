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
  setImage,
  isImage,
  type Creative,
  type PackFailure,
  type PackStatus,
} from "@/lib/creative";
import { loadCreatives, saveCreative } from "@/lib/firebase/data";
import { friendlyMessage } from "@/lib/firebase/errors";
import { useApp } from "@/lib/store";

/**
 * The whole month of designs, as one screen's worth of state.
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
  generate: () => Promise<void>;
  /** Regenerates only the days whose last attempt failed. */
  retryFailed: () => Promise<void>;
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
  saved: Map<string, Creative>;
}

const NO_CREATIVES: Map<string, Creative> = new Map();

export function usePack(): PackState {
  const { user, profile, plan } = useApp();
  const uid = user?.id ?? null;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ uid: string; message: string } | null>(
    null,
  );
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  const mine = loaded && loaded.uid === uid ? loaded : null;
  const saved = mine?.saved ?? NO_CREATIVES;
  const error = failure && failure.uid === uid ? failure.message : null;
  const loading = !mine && !error;

  /** Records one saved design, and only against the owner it belongs to. */
  const remember = useCallback((owner: string, creative: Creative) => {
    setLoaded((prev) =>
      prev && prev.uid === owner
        ? { uid: owner, saved: new Map(prev.saved).set(creative.itemId, creative) }
        : prev,
    );
  }, []);

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
    if (!owner) return;
    let cancelled = false;

    (async () => {
      try {
        const list = await loadCreatives(owner);
        if (cancelled) return;
        setLoaded({
          uid: owner,
          saved: new Map(list.map((creative) => [creative.itemId, creative])),
        });
      } catch (err) {
        if (!cancelled) setFailure({ uid: owner, message: friendlyMessage(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  const items = useMemo(() => plan?.items ?? [], [plan]);
  const pool = useMemo(() => photoPool([...saved.values()]), [saved]);

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
    async (targets: ContentItem[]) => {
      const owner = uid;
      const restaurant = state.current.profile;
      const current = state.current.plan;
      if (!owner || !restaurant || !current || targets.length === 0) return;

      const photos = assignPhotos(
        current.items,
        photoPool([...state.current.saved.values()]),
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
        await runPack(
          targets,
          (item) => composePackDay(restaurant, current.id, item, photos),
          (creative) => saveCreative(owner, creative),
          {
            onSaved: (creative) => {
              if (!alive.current) return;
              // Counted up one day at a time, from designs that are actually
              // in Firestore — not from an estimate of how far along we are.
              remember(owner, creative);
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
      } finally {
        if (alive.current) {
          setRunning(false);
          setBusy(new Set());
        }
      }
    },
    [uid, remember],
  );

  const generate = useCallback(async () => {
    const current = state.current.plan;
    if (!current) return;
    await write(missingItems(current.items, [...state.current.saved.values()]));
  }, [write]);

  const retryFailed = useCallback(async () => {
    const current = state.current.plan;
    if (!current) return;
    // Only days with no design saved: a day that has one is not a failure,
    // whatever an earlier attempt reported.
    const stale = new Set(
      current.items
        .filter((item) => !state.current.saved.has(item.id))
        .map((item) => item.id),
    );
    await write(current.items.filter((item) => stale.has(item.id)));
  }, [write]);

  /* --- photographs --------------------------------------------------------- */

  const gapDays = useMemo(
    () => (pool.length === 0 ? [] : daysNeedingPhotos([...saved.values()])),
    [pool, saved],
  );

  /**
   * Puts the owner's photographs into the days that are showing an empty slot.
   *
   * Separate from generation, and never automatic after the fact: the first
   * run had no photographs to give those days, and quietly rewriting posters
   * the owner has already looked at is not help. Days they have edited are
   * left alone entirely.
   */
  const fillPhotos = useCallback(async () => {
    const owner = uid;
    const current = state.current.plan;
    if (!owner || !current) return;

    const all = [...state.current.saved.values()];
    const gaps = daysNeedingPhotos(all);
    if (gaps.length === 0) return;

    const photos = assignPhotos(current.items, photoPool(all));
    const targets = gaps
      .map((creative) => ({ creative, photo: photos.get(creative.itemId) }))
      .filter((entry) => Boolean(entry.photo));
    if (targets.length === 0) return;

    setRunning(true);
    setBusy(new Set(targets.map((entry) => entry.creative.itemId)));
    try {
      for (const { creative, photo } of targets) {
        const slot = creative.elements.find(isImage);
        if (!slot || !photo) continue;
        const next = setImage(creative, slot.id, photo);
        try {
          await saveCreative(owner, next);
          if (!alive.current) return;
          remember(owner, next);
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
  }, [uid, remember]);

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
