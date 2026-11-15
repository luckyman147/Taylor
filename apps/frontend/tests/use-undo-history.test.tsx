import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useUndoHistory } from '@/hooks/use-undo-history';

describe('useUndoHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty', () => {
    const { result } = renderHook(() => useUndoHistory<string>());

    expect(result.current.canUndo).toBe(false);

    let restored: string | null = null;
    act(() => {
      restored = result.current.undo();
    });

    expect(restored).toBeNull();
  });

  it('undoes snapshots in LIFO order', () => {
    const { result } = renderHook(() => useUndoHistory<string>({ coalesceMs: 0 }));

    act(() => {
      result.current.push('first');
      result.current.push('second');
    });
    expect(result.current.canUndo).toBe(true);

    let restored: string | null = null;
    act(() => {
      restored = result.current.undo();
    });
    expect(restored).toBe('second');

    act(() => {
      restored = result.current.undo();
    });
    expect(restored).toBe('first');
    expect(result.current.canUndo).toBe(false);
  });

  it('coalesces rapid pushes into a single undo step', () => {
    const { result } = renderHook(() => useUndoHistory<string>({ coalesceMs: 800 }));

    act(() => {
      result.current.push('before burst');
      result.current.push('mid burst');
      result.current.push('later in burst');
    });

    let restored: string | null = null;
    act(() => {
      restored = result.current.undo();
    });

    expect(restored).toBe('before burst');
    expect(result.current.canUndo).toBe(false);
  });

  it('records a new step after the coalesce window', () => {
    const { result } = renderHook(() => useUndoHistory<string>({ coalesceMs: 800 }));

    act(() => {
      result.current.push('first');
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    act(() => {
      result.current.push('second');
    });

    let restored: string | null = null;
    act(() => {
      restored = result.current.undo();
    });
    expect(restored).toBe('second');

    act(() => {
      restored = result.current.undo();
    });
    expect(restored).toBe('first');
  });

  it('bypasses coalescing for immediate pushes', () => {
    const { result } = renderHook(() => useUndoHistory<string>({ coalesceMs: 800 }));

    act(() => {
      result.current.push('first');
      result.current.push('immediate', true);
    });

    let restored: string | null = null;
    act(() => {
      restored = result.current.undo();
    });
    expect(restored).toBe('immediate');

    act(() => {
      restored = result.current.undo();
    });
    expect(restored).toBe('first');
  });

  it('drops the oldest snapshots beyond the limit', () => {
    const { result } = renderHook(() => useUndoHistory<number>({ limit: 2, coalesceMs: 0 }));

    act(() => {
      result.current.push(1);
      result.current.push(2);
      result.current.push(3);
    });

    const restored: Array<number | null> = [];
    act(() => {
      restored.push(result.current.undo());
      restored.push(result.current.undo());
      restored.push(result.current.undo());
    });

    expect(restored).toEqual([3, 2, null]);
  });

  it('clears the history', () => {
    const { result } = renderHook(() => useUndoHistory<string>());

    act(() => {
      result.current.push('change');
    });
    act(() => {
      result.current.clear();
    });

    expect(result.current.canUndo).toBe(false);

    let restored: string | null = null;
    act(() => {
      restored = result.current.undo();
    });
    expect(restored).toBeNull();
  });

  it('stores an isolated copy of the snapshot', () => {
    const { result } = renderHook(() => useUndoHistory<{ value: number }>());
    const state = { value: 1 };

    act(() => {
      result.current.push(state);
    });
    state.value = 2;

    let restored: { value: number } | null = null;
    act(() => {
      restored = result.current.undo();
    });

    expect(restored).toEqual({ value: 1 });
  });

  it('records a new step immediately after an undo', () => {
    const { result } = renderHook(() => useUndoHistory<string>({ coalesceMs: 800 }));

    act(() => {
      result.current.push('first');
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.push('after undo');
    });

    let restored: string | null = null;
    act(() => {
      restored = result.current.undo();
    });

    expect(restored).toBe('after undo');
  });
});
