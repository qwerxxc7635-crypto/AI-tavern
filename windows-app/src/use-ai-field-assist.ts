import { useCallback, useEffect, useRef, useState } from 'react';

import {
  initialFieldAssistState,
  reduceFieldAssist,
  type FieldAssistEvent,
  type FieldAssistOperation,
  type FieldAssistState,
} from './ai-field-assist-state.js';

export interface FieldAssistGenerationRequest {
  readonly operation: FieldAssistOperation;
  readonly value: string;
  readonly signal: AbortSignal;
}

export interface UseFieldAssistOptions {
  readonly initialValue: string;
  readonly hardLocked?: boolean;
  readonly generate: (request: FieldAssistGenerationRequest) => Promise<readonly string[]>;
  readonly onValueChange: (value: string) => void;
}

export interface FieldAssistController {
  readonly state: FieldAssistState;
  readonly start: (operation: FieldAssistOperation) => Promise<void>;
  readonly cancel: () => void;
  readonly select: (index: number) => void;
  readonly apply: () => void;
  readonly undo: () => void;
  readonly retry: () => Promise<void>;
  readonly edit: (value: string) => void;
  readonly lock: (hard?: boolean) => void;
  readonly unlock: () => void;
}

let requestSequence = 0;

export function useAIFieldAssist({
  initialValue,
  hardLocked = false,
  generate,
  onValueChange,
}: UseFieldAssistOptions): FieldAssistController {
  const [state, setState] = useState(() => initialFieldAssistState(initialValue, hardLocked));
  const stateRef = useRef(state);
  const abortRef = useRef<AbortController | null>(null);

  const transition = useCallback((event: FieldAssistEvent) => {
    const updated = reduceFieldAssist(stateRef.current, event);
    stateRef.current = updated;
    setState(updated);
    return updated;
  }, []);

  const start = useCallback(
    async (operation: FieldAssistOperation) => {
      const requestId = `field-assist:${++requestSequence}`;
      const controller = new AbortController();
      const startingValue = stateRef.current.value;
      transition({ type: 'START', operation, requestId });
      abortRef.current = controller;
      try {
        const candidates = await generate({
          operation,
          value: startingValue,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          transition({ type: 'RESOLVE', requestId, candidates });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          transition({ type: 'FAIL', requestId, code: generationErrorCode(error) });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [generate, transition],
  );

  const cancel = useCallback(() => {
    const requestId = stateRef.current.activeRequestId;
    if (requestId === null) return;
    abortRef.current?.abort();
    abortRef.current = null;
    transition({ type: 'CANCEL', requestId });
  }, [transition]);

  const select = useCallback(
    (index: number) => transition({ type: 'SELECT', index }),
    [transition],
  );
  const apply = useCallback(() => {
    const updated = transition({ type: 'APPLY' });
    onValueChange(updated.value);
  }, [onValueChange, transition]);
  const undo = useCallback(() => {
    const updated = transition({ type: 'UNDO' });
    onValueChange(updated.value);
  }, [onValueChange, transition]);
  const retry = useCallback(async () => {
    const operation = stateRef.current.lastOperation;
    if (operation === null) return;
    await start(operation);
  }, [start]);
  const edit = useCallback(
    (value: string) => {
      const updated = transition({ type: 'EDIT', value });
      onValueChange(updated.value);
    },
    [onValueChange, transition],
  );
  const lock = useCallback((hard = false) => transition({ type: 'LOCK', hard }), [transition]);
  const unlock = useCallback(() => transition({ type: 'UNLOCK' }), [transition]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (initialValue !== stateRef.current.value) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
    transition({ type: 'SYNC', value: initialValue });
  }, [initialValue, transition]);

  return { state, start, cancel, select, apply, undo, retry, edit, lock, unlock };
}

function generationErrorCode(error: unknown) {
  if (error instanceof Error && error.name === 'TimeoutError') return 'GENERATION_TIMEOUT';
  return 'GENERATION_FAILED';
}
