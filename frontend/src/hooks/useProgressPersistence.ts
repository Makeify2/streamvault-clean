import { useRef, useCallback, useEffect } from 'react';

interface SavedProgress {
  t: number;
  d: number;
  at: number;
}

const progressKey = (torrentId: number | string, fileId: number | string) =>
  `sv-progress:${torrentId}:${fileId}`;

/**
 * Manages resume-position persistence to localStorage.
 *
 *  - `saveProgress()` is throttled to once every 5 seconds unless `force` is true.
 *  - `restorePosition()` reads the saved position and seeks the video; returns the
 *    timestamp (for the "Resumed from …" toast) or null.
 *  - `clearProgress()` removes the entry (video ended, "Start Over").
 *  - On unmount, a final `saveProgress(video, true)` is called.
 *  - The "resumed from" toast auto-dismiss timer is tracked and cleaned up on unmount.
 */
export function useProgressPersistence(
  torrentId: number | string,
  fileId: number | string,
) {
  const lastSaveRef = useRef(0);
  const resumedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup the resumed-toast timer on unmount.
  useEffect(() => {
    return () => {
      if (resumedTimeoutRef.current !== null) {
        clearTimeout(resumedTimeoutRef.current);
        resumedTimeoutRef.current = null;
      }
    };
  }, []);

  /**
   * Write current playback position to localStorage.
   * Skips if less than 5 s since the last write (unless `force`).
   * Entries where the viewer is past 96 % are removed (considered "finished").
   */
  const saveProgress = useCallback(
    (video: HTMLVideoElement | null, force = false) => {
      if (!video || !video.duration || isNaN(video.duration)) return;
      const now = Date.now();
      if (!force && now - lastSaveRef.current < 5000) return;
      lastSaveRef.current = now;

      const key = progressKey(torrentId, fileId);
      const ratio = video.currentTime / video.duration;
      if (video.currentTime > 30 && ratio < 0.96) {
        localStorage.setItem(
          key,
          JSON.stringify({ t: video.currentTime, d: video.duration, at: now } satisfies SavedProgress),
        );
        window.dispatchEvent(new CustomEvent('sv-progress'));
      } else if (ratio >= 0.96) {
        localStorage.removeItem(key);
        window.dispatchEvent(new CustomEvent('sv-progress'));
      }
    },
    [torrentId, fileId],
  );

  /**
   * Read the saved position and seek the video. Returns the saved timestamp
   * (for the "Resumed from …" toast) or null if nothing was saved / not applicable.
   */
  const restorePosition = useCallback(
    (video: HTMLVideoElement): number | null => {
      try {
        const raw = localStorage.getItem(progressKey(torrentId, fileId));
        if (!raw) return null;
        const { t } = JSON.parse(raw) as SavedProgress;
        if (typeof t === 'number' && t > 60 && video.duration && t < video.duration * 0.95) {
          video.currentTime = t;
          return t;
        }
      } catch { /* corrupt entry — ignore */ }
      return null;
    },
    [torrentId, fileId],
  );

  /** Remove the saved position (video ended, user clicked "Start Over"). */
  const clearProgress = useCallback(() => {
    localStorage.removeItem(progressKey(torrentId, fileId));
    window.dispatchEvent(new CustomEvent('sv-progress'));
  }, [torrentId, fileId]);

  /**
   * Schedule the "Resumed from …" toast to auto-dismiss after `ms` milliseconds.
   * Any previously scheduled dismissal is cancelled first.
   * Returns a setter the caller can use to update the `resumedFrom` state.
   */
  const scheduleResumedDismiss = useCallback(
    (setResumedFrom: (v: number | null) => void, ms = 8000) => {
      if (resumedTimeoutRef.current !== null) {
        clearTimeout(resumedTimeoutRef.current);
      }
      resumedTimeoutRef.current = setTimeout(() => {
        setResumedFrom(null);
        resumedTimeoutRef.current = null;
      }, ms);
    },
    [],
  );

  /** Cancel any pending resumed-toast dismiss (e.g. user manually dismissed). */
  const cancelResumedDismiss = useCallback(() => {
    if (resumedTimeoutRef.current !== null) {
      clearTimeout(resumedTimeoutRef.current);
      resumedTimeoutRef.current = null;
    }
  }, []);

  return {
    saveProgress,
    restorePosition,
    clearProgress,
    scheduleResumedDismiss,
    cancelResumedDismiss,
  } as const;
}
