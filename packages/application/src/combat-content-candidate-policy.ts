import type {
  AICandidate,
  AiCandidateId,
  AiOperationId,
  AiRequestId,
  CampaignId,
  GenerationRecordId,
  IsoTimestamp,
  JsonValue,
} from '@ember-tavern/contracts';
import {
  AICandidateTransitionError,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';

import {
  AICandidateUseCases,
  type ProposeAICandidate,
  type ReviseAICandidate,
} from './ai-candidate-use-cases.js';

export const COMBAT_CANDIDATE_REQUIRED_CHECKS = [
  'combat:schema',
  'combat:mechanical-intent',
  'combat:ai-exposure',
  'combat:power-budget',
  'combat:build-exploit',
  'combat:tooltip-flavor',
] as const;

export type CombatContentSubmissionPolicy = 'USER_REQUESTED' | 'BACKGROUND_WORLD_CONTENT';

export interface CombatCandidateValidationResult {
  readonly canonicalPayload: JsonValue;
  readonly checks: readonly string[];
}

export interface CombatCandidateValidator {
  validate(payload: unknown): CombatCandidateValidationResult;
}

export interface CombatCandidateProvenance {
  readonly requestId: AiRequestId;
  readonly providerId: string;
  readonly modelName: string;
  readonly resolvedModelFingerprint: string;
  readonly contextManifestHash: string;
}

export interface GeneratedCombatCandidate {
  readonly id: AiCandidateId;
  readonly campaignId: CampaignId;
  readonly operationId: AiOperationId;
  readonly generationRecordId: GenerationRecordId | null;
  readonly submissionPolicy: CombatContentSubmissionPolicy;
  readonly payload: unknown;
  readonly provenance: CombatCandidateProvenance;
  readonly expectedRevision: number;
}

export interface ReviseUserCombatCandidate {
  readonly sourceCandidateId: AiCandidateId;
  readonly id: AiCandidateId;
  readonly operationId: AiOperationId;
  readonly generationRecordId: GenerationRecordId | null;
  readonly payload: unknown;
  readonly provenance: CombatCandidateProvenance;
  readonly kind: ReviseAICandidate['kind'];
}

export type CombatDomainCommit = (canonicalPayload: JsonValue, expectedRevision: number) => void;

interface CombatCandidateEnvelope {
  readonly [key: string]: JsonValue;
  readonly schemaVersion: 1;
  readonly submissionPolicy: CombatContentSubmissionPolicy;
  readonly approvedDefinition: JsonValue;
}

export class CombatCandidatePolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CombatCandidatePolicyError';
  }
}

export class CombatContentCandidatePolicy {
  private readonly candidates: AICandidateUseCases;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly validator: CombatCandidateValidator,
    private readonly now: () => IsoTimestamp,
  ) {
    this.candidates = new AICandidateUseCases(database, now);
  }

  public acceptGenerated(
    input: GeneratedCombatCandidate,
    domainCommit?: CombatDomainCommit,
  ): AICandidate {
    const proposal = this.buildProposal(input, 'INITIAL');
    if (input.submissionPolicy === 'USER_REQUESTED') {
      if (domainCommit !== undefined) {
        throw new CombatCandidatePolicyError(
          'User-requested combat content cannot commit before explicit confirmation',
        );
      }
      return this.candidates.propose(proposal);
    }
    if (domainCommit === undefined) {
      throw new CombatCandidatePolicyError(
        'Background combat content requires an automatic domain commit',
      );
    }
    return this.candidates.autoAccept({
      candidate: proposal,
      commit: (payload, expectedRevision) => {
        const envelope = requireEnvelope(payload, 'BACKGROUND_WORLD_CONTENT');
        const validated = this.validate(envelope.approvedDefinition);
        domainCommit(validated.canonicalPayload, expectedRevision);
      },
    });
  }

  public previewUserCandidate(id: AiCandidateId): AICandidate {
    const candidate = this.candidates.preview(id);
    requireEnvelope(candidate.payload, 'USER_REQUESTED');
    return candidate;
  }

  public reviseUserCandidate(command: ReviseUserCombatCandidate): AICandidate {
    const source = this.previewUserCandidate(command.sourceCandidateId);
    if (source.status !== 'PROPOSED') {
      throw new AICandidateTransitionError('Only a proposed combat candidate can be revised');
    }
    const validated = this.validate(command.payload);
    return this.candidates.revise({
      sourceCandidateId: command.sourceCandidateId,
      id: command.id,
      operationId: command.operationId,
      generationRecordId: command.generationRecordId,
      payload: envelope('USER_REQUESTED', validated.canonicalPayload),
      validation: validationEvidence(validated.checks, this.now()),
      provenance: command.provenance,
      kind: command.kind,
    });
  }

  public confirmUserCandidate(
    id: AiCandidateId,
    campaignId: CampaignId,
    expectedRevision: number,
    domainCommit: CombatDomainCommit,
  ): 'COMMITTED' | 'ALREADY_COMMITTED' {
    const candidate = this.previewUserCandidate(id);
    if (candidate.campaignId !== campaignId) {
      throw new AICandidateTransitionError('Combat candidate belongs to another campaign');
    }
    return this.candidates.confirm({
      id,
      campaignId,
      expectedRevision,
      commit: (payload, revision) => {
        const stored = requireEnvelope(payload, 'USER_REQUESTED');
        const validated = this.validate(stored.approvedDefinition);
        domainCommit(validated.canonicalPayload, revision);
      },
    });
  }

  public rejectUserCandidate(id: AiCandidateId): AICandidate {
    this.previewUserCandidate(id);
    return this.candidates.reject(id);
  }

  private buildProposal(
    input: GeneratedCombatCandidate,
    revisionKind: 'INITIAL',
  ): ProposeAICandidate {
    const validated = this.validate(input.payload);
    return {
      id: input.id,
      campaignId: input.campaignId,
      operationId: input.operationId,
      task: 'COMBAT_CONTENT_GENERATION',
      generationRecordId: input.generationRecordId,
      payload: envelope(input.submissionPolicy, validated.canonicalPayload),
      validation: validationEvidence(validated.checks, this.now()),
      provenance: { ...input.provenance, revisionKind },
      expectedRevision: input.expectedRevision,
    };
  }

  private validate(payload: unknown): CombatCandidateValidationResult {
    const result = this.validator.validate(payload);
    const checks = [...result.checks];
    if (
      checks.length !== new Set(checks).size ||
      checks.some((check) => check.length === 0 || check.trim() !== check) ||
      COMBAT_CANDIDATE_REQUIRED_CHECKS.some((required) => !checks.includes(required))
    ) {
      throw new CombatCandidatePolicyError(
        'Combat candidate is missing canonical Gate E validation evidence',
      );
    }
    return {
      canonicalPayload: result.canonicalPayload,
      checks: Object.freeze([...checks].sort()),
    };
  }
}

function envelope(
  submissionPolicy: CombatContentSubmissionPolicy,
  approvedDefinition: JsonValue,
): CombatCandidateEnvelope {
  return Object.freeze({ schemaVersion: 1, submissionPolicy, approvedDefinition });
}

function requireEnvelope(
  value: JsonValue,
  expectedPolicy: CombatContentSubmissionPolicy,
): CombatCandidateEnvelope {
  const record = value as Readonly<Record<string, JsonValue>>;
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    record['schemaVersion'] !== 1 ||
    record['submissionPolicy'] !== expectedPolicy ||
    !Object.hasOwn(record, 'approvedDefinition') ||
    Object.keys(record).some(
      (key) => !['schemaVersion', 'submissionPolicy', 'approvedDefinition'].includes(key),
    )
  ) {
    throw new CombatCandidatePolicyError(
      'Combat candidate envelope is invalid or has wrong policy',
    );
  }
  return value as unknown as CombatCandidateEnvelope;
}

function validationEvidence(checks: readonly string[], validatedAt: IsoTimestamp) {
  return {
    schemaValid: true as const,
    domainValid: true as const,
    validatedAt,
    checks,
  };
}
