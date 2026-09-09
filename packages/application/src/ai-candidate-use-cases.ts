import type {
  AICandidate,
  AiCandidateId,
  AiOperationId,
  CampaignId,
  GenerationRecordId,
  IsoTimestamp,
  JsonValue,
} from '@ember-tavern/contracts';
import {
  AICandidateRepository,
  AICandidateTransitionError,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';

export type ProposeAICandidate = Pick<
  AICandidate,
  | 'id'
  | 'campaignId'
  | 'operationId'
  | 'task'
  | 'generationRecordId'
  | 'payload'
  | 'validation'
  | 'provenance'
  | 'expectedRevision'
>;

export interface ReviseAICandidate {
  readonly sourceCandidateId: AiCandidateId;
  readonly id: AiCandidateId;
  readonly operationId: AiOperationId;
  readonly generationRecordId: GenerationRecordId | null;
  readonly payload: JsonValue;
  readonly validation: AICandidate['validation'];
  readonly provenance: Omit<AICandidate['provenance'], 'revisionKind'>;
  readonly kind: 'EDIT' | 'REGENERATE';
}

export interface ConfirmAICandidate {
  readonly id: AiCandidateId;
  readonly campaignId: CampaignId;
  readonly expectedRevision: number;
  readonly commit: (payload: JsonValue, expectedRevision: number) => void;
}

export interface AutoAcceptAICandidate {
  readonly candidate: ProposeAICandidate;
  readonly commit: ConfirmAICandidate['commit'];
}

export class AICandidateUseCases {
  private readonly candidates: AICandidateRepository;

  public constructor(
    private readonly database: TransactionalSqliteDatabase,
    private readonly now: () => IsoTimestamp,
  ) {
    this.candidates = new AICandidateRepository(database);
  }

  public propose(input: ProposeAICandidate): AICandidate {
    if (input.provenance.revisionKind !== 'INITIAL') {
      throw new AICandidateTransitionError('Initial candidate must use INITIAL provenance');
    }
    return this.candidates.create({
      ...input,
      supersedesCandidateId: null,
      createdAt: this.now(),
    });
  }

  public preview(id: AiCandidateId): AICandidate {
    return this.candidates.require(id);
  }

  public revise(command: ReviseAICandidate): AICandidate {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const source = this.candidates.require(command.sourceCandidateId);
      if (source.status !== 'PROPOSED') {
        throw new AICandidateTransitionError('Only a proposed candidate can be revised');
      }
      const timestamp = this.now();
      const replacement = this.candidates.create({
        id: command.id,
        campaignId: source.campaignId,
        operationId: command.operationId,
        task: source.task,
        generationRecordId: command.generationRecordId,
        payload: command.payload,
        validation: command.validation,
        provenance: { ...command.provenance, revisionKind: command.kind },
        expectedRevision: source.expectedRevision,
        supersedesCandidateId: source.id,
        createdAt: timestamp,
      });
      this.candidates.markSuperseded(source.id, replacement.id, timestamp);
      this.database.exec('COMMIT');
      return replacement;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public reject(id: AiCandidateId): AICandidate {
    return this.candidates.transition(id, 'REJECTED', this.now());
  }

  public confirm(command: ConfirmAICandidate): 'COMMITTED' | 'ALREADY_COMMITTED' {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const candidate = this.candidates.require(command.id);
      if (candidate.campaignId !== command.campaignId) {
        throw new AICandidateTransitionError('Candidate belongs to another campaign');
      }
      if (candidate.status === 'ACCEPTED') {
        this.database.exec('COMMIT');
        return 'ALREADY_COMMITTED';
      }
      if (candidate.status !== 'PROPOSED') {
        throw new AICandidateTransitionError('Only a proposed candidate can be confirmed');
      }
      if (candidate.expectedRevision !== command.expectedRevision) {
        throw new AICandidateTransitionError('Candidate aggregate revision is stale');
      }
      command.commit(candidate.payload, candidate.expectedRevision);
      this.candidates.transition(candidate.id, 'ACCEPTED', this.now());
      this.database.exec('COMMIT');
      return 'COMMITTED';
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public autoAccept(command: AutoAcceptAICandidate): AICandidate {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.candidates.get(command.candidate.id);
      if (existing !== null) {
        requireSameAutoAcceptCandidate(existing, command.candidate);
        if (existing.status !== 'ACCEPTED') {
          throw new AICandidateTransitionError(
            'A replayed automatic candidate must already be accepted',
          );
        }
        this.database.exec('COMMIT');
        return existing;
      }

      const candidate = this.propose(command.candidate);
      command.commit(candidate.payload, candidate.expectedRevision);
      const accepted = this.candidates.transition(candidate.id, 'ACCEPTED', this.now());
      this.database.exec('COMMIT');
      return accepted;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function requireSameAutoAcceptCandidate(existing: AICandidate, replay: ProposeAICandidate): void {
  const expected = {
    id: replay.id,
    campaignId: replay.campaignId,
    operationId: replay.operationId,
    task: replay.task,
    generationRecordId: replay.generationRecordId,
    payload: replay.payload,
    validation: {
      schemaValid: replay.validation.schemaValid,
      domainValid: replay.validation.domainValid,
      checks: replay.validation.checks,
    },
    provenance: replay.provenance,
    expectedRevision: replay.expectedRevision,
  };
  const actual = {
    id: existing.id,
    campaignId: existing.campaignId,
    operationId: existing.operationId,
    task: existing.task,
    generationRecordId: existing.generationRecordId,
    payload: existing.payload,
    validation: {
      schemaValid: existing.validation.schemaValid,
      domainValid: existing.validation.domainValid,
      checks: existing.validation.checks,
    },
    provenance: existing.provenance,
    expectedRevision: existing.expectedRevision,
  };
  if (stableJson(actual) !== stableJson(expected)) {
    throw new AICandidateTransitionError('Automatic candidate replay identity does not match');
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
