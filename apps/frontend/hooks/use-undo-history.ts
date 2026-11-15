'use client';

import { useCallback, useRef, useState } from 'react';

interface UseUndoHistoryOptions {
  limit?: number;
  coalesceMs?: number;
}

export function useUndoHistory<T>({ limit = 50, coalesceMs = 800 }: UseUndoHistoryOptions = {}) {
  const stackRef = useRef<T[]>([]);
  const lastPushAtRef = useRef(0);
  const [canUndo, setCanUndo] = useState(false);

  const push = useCallback(
    (snapshot: T, immediate = false) => {
      const now = Date.now();
      if (!immediate && stackRef.current.length > 0 && now - lastPushAtRef.current < coalesceMs) {
        return;
      }

      stackRef.current.push(structuredClone(snapshot));
      if (stackRef.current.length > limit) {
        stackRef.current.shift();
      }
      lastPushAtRef.current = now;
      setCanUndo(true);
    },
    [coalesceMs, limit]
  );

  const undo = useCallback((): T | null => {
    const snapshot = stackRef.current.pop();
    lastPushAtRef.current = 0;
    setCanUndo(stackRef.current.length > 0);
    return snapshot ?? null;
  }, []);

  const clear = useCallback(() => {
    stackRef.current = [];
    lastPushAtRef.current = 0;
    setCanUndo(false);
  }, []);

  return { push, undo, clear, canUndo };
}
