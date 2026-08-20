import { createContext, useContext, type ReactNode } from 'react';

import type { UniversalCharacterDraft } from '@ember-tavern/contracts';

import { AIFieldAssist } from './ui/game-components.js';
import type {
  UniversalCharacterCreationService,
  UniversalCharacterCreationSnapshot,
} from './universal-character-creation-service.js';
import { useAIFieldAssist } from './use-ai-field-assist.js';

type CharacterAIActions = Pick<UniversalCharacterCreationService, 'assistField'>;

interface SharedProps {
  readonly path: string;
  readonly label: string;
  readonly locked: boolean;
  readonly onLock: (path: string) => void;
}

interface CharacterAIFieldContextValue {
  readonly snapshot: UniversalCharacterCreationSnapshot;
  readonly draft: UniversalCharacterDraft;
  readonly lockedFields: readonly string[];
  readonly service: CharacterAIActions;
}

const CharacterAIFieldContext = createContext<CharacterAIFieldContextValue | null>(null);

export function CharacterAIFieldProvider({
  snapshot,
  draft,
  lockedFields,
  service,
  children,
}: CharacterAIFieldContextValue & { readonly children: ReactNode }) {
  return (
    <CharacterAIFieldContext.Provider value={{ snapshot, draft, lockedFields, service }}>
      {children}
    </CharacterAIFieldContext.Provider>
  );
}

export function CharacterAITextField({
  path,
  label,
  value,
  onChange,
  ...shared
}: SharedProps & {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const context = useCharacterAIFieldContext();
  const controller = useAIFieldAssist({
    initialValue: value,
    generate: ({ operation, signal }) =>
      context.service.assistField(
        context.snapshot,
        context.draft,
        context.lockedFields,
        path,
        operation,
        signal,
      ),
    onValueChange: onChange,
  });
  const state = shared.locked ? 'LOCKED' : fieldAssistState(controller.state.phase);
  return (
    <div data-character-field={path} data-ai-field={`character:${path}`}>
      <label>
        {label}
        <textarea
          value={value}
          disabled={shared.locked || controller.state.phase === 'GENERATING'}
          onChange={(event) => controller.edit(event.target.value)}
        />
      </label>
      <AIFieldAssist
        state={state}
        candidates={controller.state.candidates}
        selectedCandidate={controller.state.selectedCandidate ?? 0}
        {...optionalError(controller.state.errorCode)}
        onOperation={(operation) => void controller.start(operation)}
        onApply={controller.apply}
        onCancel={controller.cancel}
        onSelect={controller.select}
        onUndo={controller.undo}
        onRetry={() => void controller.retry()}
        onLock={() => shared.onLock(path)}
        onUnlock={() => shared.onLock(path)}
      />
    </div>
  );
}

export function CharacterAIListField({
  path,
  label,
  values,
  onChange,
  ...shared
}: SharedProps & {
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
}) {
  const context = useCharacterAIFieldContext();
  const value = values.join('\n');
  const controller = useAIFieldAssist({
    initialValue: value,
    generate: ({ operation, signal }) =>
      context.service.assistField(
        context.snapshot,
        context.draft,
        context.lockedFields,
        path,
        operation,
        signal,
      ),
    onValueChange: (next) => onChange(lines(next)),
  });
  const state = shared.locked ? 'LOCKED' : fieldAssistState(controller.state.phase);
  return (
    <div data-character-field={path} data-ai-field={`character:${path}`}>
      <label>
        {label}
        <textarea
          value={value}
          disabled={shared.locked || controller.state.phase === 'GENERATING'}
          onChange={(event) => controller.edit(event.target.value)}
        />
      </label>
      <AIFieldAssist
        state={state}
        candidates={controller.state.candidates}
        selectedCandidate={controller.state.selectedCandidate ?? 0}
        {...optionalError(controller.state.errorCode)}
        onOperation={(operation) => void controller.start(operation)}
        onApply={controller.apply}
        onCancel={controller.cancel}
        onSelect={controller.select}
        onUndo={controller.undo}
        onRetry={() => void controller.retry()}
        onLock={() => shared.onLock(path)}
        onUnlock={() => shared.onLock(path)}
      />
    </div>
  );
}

function useCharacterAIFieldContext(): CharacterAIFieldContextValue {
  const value = useContext(CharacterAIFieldContext);
  if (value === null) throw new Error('Character AI field context is missing');
  return value;
}

function fieldAssistState(
  phase: ReturnType<typeof useAIFieldAssist>['state']['phase'],
): Parameters<typeof AIFieldAssist>[0]['state'] {
  return phase === 'GENERATING' ? 'LOADING' : phase;
}

function safeFieldError(code: string | null): string | undefined {
  if (code === null) return undefined;
  return code === 'GENERATION_TIMEOUT' ? '命运回应超时，请重试。' : '命运辅助未完成，请重试。';
}

function optionalError(code: string | null): { readonly error?: string } {
  const error = safeFieldError(code);
  return error === undefined ? {} : { error };
}

function lines(value: string): readonly string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
