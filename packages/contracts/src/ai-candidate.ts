import type {
  AiCandidateId,
  AiOperationId,
  AiRequestId,
  CampaignId,
  GenerationRecordId,
  IsoTimestamp,
} from './foundation.js';
import type { JsonValue } from './pending-ai-request.js';

export const AI_CANDIDATE_STATUSES = ['PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'] as const;
export type AICandidateStatus = (typeof AI_CANDIDATE_STATUSES)[number];

export interface AICandidateValidationEvidence {
  readonly schemaValid: true;
  readonly domainValid: true;
  readonly validatedAt: IsoTimestamp;
  readonly checks: readonly string[];
}

export interface AICandidateProvenance {
  readonly revisionKind: 'INITIAL' | 'EDIT' | 'REGENERATE';
  readonly requestId: AiRequestId;
  readonly providerId: string;
  readonly modelName: string;
  readonly resolvedModelFingerprint: string;
  readonly contextManifestHash: string;
}

export interface AICandidate {
  readonly id: AiCandidateId;
  readonly campaignId: CampaignId;
  readonly operationId: AiOperationId;
  readonly task: string;
  readonly generationRecordId: GenerationRecordId | null;
  readonly payload: JsonValue;
  readonly validation: AICandidateValidationEvidence;
  readonly provenance: AICandidateProvenance;
  readonly expectedRevision: number;
  readonly status: AICandidateStatus;
  readonly supersedesCandidateId: AiCandidateId | null;
  readonly supersededByCandidateId: AiCandidateId | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
