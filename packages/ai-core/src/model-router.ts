import type { ModelCapabilities, ModelInfo } from './protocol.js';

export type StructuredFormat = 'JSON_SCHEMA' | 'JSON_OBJECT' | 'TEXT';

export interface ModelRoutingRequirements {
  readonly minimumContextTokens: number;
  readonly streaming: boolean;
  readonly structuredOutput: boolean;
  readonly allowTextFallback: boolean;
}

export interface RoutableModel extends ModelInfo {
  readonly enabled?: boolean;
}

export interface ModelRoutingDecision {
  readonly model: RoutableModel;
  readonly format: StructuredFormat;
}

export function selectStructuredFormat(capabilities: ModelCapabilities): StructuredFormat {
  if (capabilities.jsonSchema) return 'JSON_SCHEMA';
  if (capabilities.jsonMode) return 'JSON_OBJECT';
  return 'TEXT';
}

export function routeModel(
  models: readonly RoutableModel[],
  requirements: ModelRoutingRequirements,
): ModelRoutingDecision {
  if (
    !Number.isSafeInteger(requirements.minimumContextTokens) ||
    requirements.minimumContextTokens < 0
  ) {
    throw new TypeError('Minimum context tokens must be a non-negative safe integer');
  }
  const eligible = models.filter(({ capabilities, enabled }) => {
    if (enabled === false) return false;
    if (!capabilities.text || (requirements.streaming && !capabilities.streaming)) return false;
    if (
      requirements.minimumContextTokens > 0 &&
      (capabilities.contextWindowTokens === null ||
        capabilities.contextWindowTokens < requirements.minimumContextTokens)
    ) {
      return false;
    }
    if (!requirements.structuredOutput) return true;
    return capabilities.jsonSchema || capabilities.jsonMode || requirements.allowTextFallback;
  });
  const model = requirements.structuredOutput
    ? eligible.reduce<RoutableModel | undefined>((best, candidate) => {
        if (best === undefined) return candidate;
        return structuredRank(candidate.capabilities) > structuredRank(best.capabilities)
          ? candidate
          : best;
      }, undefined)
    : eligible[0];
  if (model === undefined)
    throw new RangeError('No configured model satisfies the task requirements');
  return Object.freeze({
    model,
    format: requirements.structuredOutput ? selectStructuredFormat(model.capabilities) : 'TEXT',
  });
}

function structuredRank(capabilities: ModelCapabilities): number {
  if (capabilities.jsonSchema) return 2;
  if (capabilities.jsonMode) return 1;
  return 0;
}
