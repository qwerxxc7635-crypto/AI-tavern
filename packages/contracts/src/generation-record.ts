import type { JsonValue } from './pending-ai-request.js';
import type {
  AiRequestId,
  CampaignId,
  GenerationRecordId,
  IsoTimestamp,
  ModelProfileId,
  PromptVersion,
} from './foundation.js';

export interface GenerationValidationIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}

export interface GenerationValidationError {
  readonly code: string;
  readonly issues: readonly GenerationValidationIssue[];
}

export interface GenerationRecord {
  readonly id: GenerationRecordId;
  readonly campaignId: CampaignId;
  readonly requestId: AiRequestId;
  readonly task: string;
  readonly modelProfileId: ModelProfileId | null;
  readonly promptVersion: PromptVersion;
  readonly request: JsonValue;
  readonly rawResponseText: string | null;
  readonly validatedOutput: JsonValue | null;
  readonly validationError: GenerationValidationError | null;
  readonly startedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp | null;
}
