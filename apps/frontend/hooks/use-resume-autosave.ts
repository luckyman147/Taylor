'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseResumeAutosaveArgs<T> {
  /** Whether auto-save is possible at all (e.g. a resumeId exists). */
  enabled: boolean;
  /** Whether the resume data has finished loading (skip while loading/restoring). */
  loaded: boolean;
  /** Current editor state; auto-save is skipped while it deep-equals lastSaved. */
  current: T;
  /** Last successfully persisted state. */
  lastSaved: T;
  /** Debounce delay in ms. */
  delayMs?: number;
  /** Persists a snapshot; must return the canonicalized data to store as lastSaved. */
  save: (data: T) => Promise<T>;
  /** Called with the canonicalized data after a successful save. */
  onPersisted: (next: T) => void;
}

/**
 * Debounced auto-save with a serialized, latest-wins queue: saves run one at a
 * time so rapid edits can't reorder full-document PATCHes on the server. The
 * pending snapshot is refreshed on every flush call, so the newest state always
 * wins without dropping intermediate changes.
 */
export function useResumeAutosave<T>({
  enabled,
  loaded,
  current,
  lastSaved,
  delayMs = 1500,
  save,
  onPersisted,
}: UseResumeAutosaveArgs<T>) {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const pendingRef = useRef<T | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(
    async (data: T) => {
      if (!enabled) return;
      pendingRef.current = data;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setStatus('saving');
      let firstError: unknown = null;
      try {
        while (pendingRef.current !== null) {
          const snapshot = pendingRef.current;
          pendingRef.current = null;
          try {
            const next = await save(snapshot);
            onPersisted(next);
            setStatus('saved');
          } catch (error) {
            setStatus('error');
            firstError ??= error;
          }
        }
      } finally {
        inFlightRef.current = false;
      }
      if (firstError) throw firstError;
    },
    [enabled, save, onPersisted]
  );

  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !loaded) return;
    if (JSON.stringify(current) === JSON.stringify(lastSaved)) return;

    cancelPending();
    timerRef.current = setTimeout(() => {
      setStatus('saving');
      void flush(current).catch(() => {
        // Failure is surfaced via status; a later change retries.
      });
    }, delayMs);

    return cancelPending;
  }, [enabled, loaded, current, lastSaved, delayMs, flush, cancelPending]);

  return { status, flush, cancelPending };
}
