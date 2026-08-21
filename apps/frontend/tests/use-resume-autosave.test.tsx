import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useResumeAutosave } from '@/hooks/use-resume-autosave';

describe('useResumeAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(
    current: unknown,
    lastSaved: unknown,
    overrides: Partial<Parameters<typeof useResumeAutosave<unknown>>[0]> = {}
  ) {
    const save = vi.fn<(data: unknown) => Promise<unknown>>();
    const onPersisted = vi.fn<(next: unknown) => void>();
    const { result, rerender } = renderHook(
      (props: { current: unknown; lastSaved: unknown }) =>
        useResumeAutosave({
          enabled: true,
          loaded: true,
          current: props.current,
          lastSaved: props.lastSaved,
          save,
          onPersisted,
          ...overrides,
        }),
      { initialProps: { current, lastSaved } }
    );
    return { result, rerender, save, onPersisted };
  }

  it('does not save before the debounce delay elapses', async () => {
    const { save } = setup({ a: 1 }, {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ a: 1 });
  });

  it('re-schedules the timer when data changes again during the debounce', async () => {
    const { save, rerender } = setup({ a: 1 }, {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    rerender({ current: { a: 2 }, lastSaved: {} });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ a: 2 });
  });

  it('skips saving when current equals lastSaved', async () => {
    const { save } = setup({ a: 1 }, { a: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not schedule when disabled (no resume id)', async () => {
    const save = vi.fn();
    renderHook(() =>
      useResumeAutosave({
        enabled: false,
        loaded: true,
        current: { a: 1 },
        lastSaved: {},
        save,
        onPersisted: vi.fn(),
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not schedule before the resume finished loading', async () => {
    const save = vi.fn();
    renderHook(() =>
      useResumeAutosave({
        enabled: true,
        loaded: false,
        current: { a: 1 },
        lastSaved: {},
        save,
        onPersisted: vi.fn(),
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('reports saved with the canonicalized result', async () => {
    const save = vi.fn().mockResolvedValue({ canonical: true });
    const onPersisted = vi.fn();
    const { result } = renderHook(() =>
      useResumeAutosave({
        enabled: true,
        loaded: true,
        current: { a: 1 },
        lastSaved: {},
        save,
        onPersisted,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(onPersisted).toHaveBeenCalledWith({ canonical: true });
    expect(result.current.status).toBe('saved');
  });

  it('serializes saves and persists the latest snapshot (latest-wins)', async () => {
    let resolveFirst!: (v: unknown) => void;
    const save = vi
      .fn<(data: unknown) => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce({ done: true });
    const onPersisted = vi.fn();
    const { result } = renderHook(() =>
      useResumeAutosave({
        enabled: true,
        loaded: true,
        current: { v: 1 },
        lastSaved: {},
        save,
        onPersisted,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(save).toHaveBeenCalledTimes(1);

    // A second flush arrives while the first is still in flight.
    await act(async () => {
      await result.current.flush({ v: 2 });
    });
    // First save still in flight; the second snapshot is queued, not dropped.
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ first: true });
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    // The queued snapshot is sent after the first completes.
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ v: 2 });
    expect(onPersisted).toHaveBeenLastCalledWith({ done: true });
  });

  it('marks status as error when a save fails and surfaces the error to the caller', async () => {
    const save = vi.fn().mockRejectedValue(new Error('network'));
    const onPersisted = vi.fn();
    const { result } = renderHook(() =>
      useResumeAutosave({
        enabled: true,
        loaded: true,
        current: { a: 1 },
        lastSaved: {},
        save,
        onPersisted,
      })
    );

    let caught: unknown = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await result.current.flush({ a: 1 }).catch((e) => (caught = e));
    });

    expect(caught).toBeInstanceOf(Error);
    expect(result.current.status).toBe('error');
    expect(onPersisted).not.toHaveBeenCalled();
  });

  it('cancels a pending save', async () => {
    const save = vi.fn();
    const { result } = setup({ a: 1 }, {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      result.current.cancelPending();
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('unmounts safely with a pending timer', async () => {
    const save = vi.fn().mockResolvedValue({});
    const { unmount } = renderHook(() =>
      useResumeAutosave({
        enabled: true,
        loaded: true,
        current: { a: 1 },
        lastSaved: {},
        save,
        onPersisted: vi.fn(),
      })
    );
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(save).not.toHaveBeenCalled();
  });
});
