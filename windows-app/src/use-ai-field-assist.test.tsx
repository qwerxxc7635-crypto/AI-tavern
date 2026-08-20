// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FieldAssistStateError } from './ai-field-assist-state.js';
import { useAIFieldAssist } from './use-ai-field-assist.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useAIFieldAssist', () => {
  it('does not publish generated text until apply, then can undo it', async () => {
    const publish = vi.fn();
    const generate = vi.fn(async () => ['候选文本']);
    const { result } = renderHook(() =>
      useAIFieldAssist({ initialValue: '原文', generate, onValueChange: publish }),
    );
    await act(() => result.current.start('IMPROVE'));
    expect(result.current.state).toMatchObject({ phase: 'CANDIDATE', value: '原文' });
    expect(publish).not.toHaveBeenCalled();
    act(() => result.current.apply());
    expect(publish).toHaveBeenLastCalledWith('候选文本');
    act(() => result.current.undo());
    expect(publish).toHaveBeenLastCalledWith('原文');
  });

  it('aborts cancellation and ignores the late completion', async () => {
    const pending = deferred<readonly string[]>();
    let signal: AbortSignal | undefined;
    const { result } = renderHook(() =>
      useAIFieldAssist({
        initialValue: '原文',
        generate: ({ signal: activeSignal }) => {
          signal = activeSignal;
          return pending.promise;
        },
        onValueChange: vi.fn(),
      }),
    );
    let work!: Promise<void>;
    act(() => {
      work = result.current.start('GENERATE');
    });
    act(() => result.current.cancel());
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(['迟到结果']);
      await work;
    });
    expect(result.current.state).toMatchObject({ phase: 'IDLE', value: '原文' });
  });

  it('rejects concurrent starts and maps provider failures to safe codes', async () => {
    const pending = deferred<readonly string[]>();
    const generate = vi
      .fn<() => Promise<readonly string[]>>()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error('secret provider detail'));
    const { result } = renderHook(() =>
      useAIFieldAssist({ initialValue: '', generate, onValueChange: vi.fn() }),
    );
    let first!: Promise<void>;
    act(() => {
      first = result.current.start('GENERATE');
    });
    await expect(result.current.start('EXPAND')).rejects.toMatchObject({
      name: FieldAssistStateError.name,
      code: 'FIELD_BUSY',
    });
    act(() => result.current.cancel());
    pending.resolve(['ignored']);
    await first;
    await act(() => result.current.start('GENERATE'));
    expect(result.current.state).toMatchObject({ phase: 'ERROR', errorCode: 'GENERATION_FAILED' });
    expect(JSON.stringify(result.current.state)).not.toContain('secret provider detail');
  });

  it('synchronizes an external bulk edit and isolates the superseded request', async () => {
    const pending = deferred<readonly string[]>();
    const { result, rerender } = renderHook(
      ({ value }) =>
        useAIFieldAssist({
          initialValue: value,
          generate: () => pending.promise,
          onValueChange: vi.fn(),
        }),
      { initialProps: { value: '旧值' } },
    );
    let work!: Promise<void>;
    act(() => {
      work = result.current.start('GENERATE');
    });
    rerender({ value: '外部更新' });
    expect(result.current.state).toMatchObject({ phase: 'IDLE', value: '外部更新' });
    pending.resolve(['迟到候选']);
    await work;
    expect(result.current.state).toMatchObject({ phase: 'IDLE', value: '外部更新' });
  });
});
