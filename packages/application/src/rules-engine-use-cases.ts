import type {
  IdempotencyKey,
  IsoTimestamp,
  RulesCommand,
  RulesEventId,
} from '@ember-tavern/contracts';
import type { RulesCommitResult, RulesEngineRepository } from '@ember-tavern/persistence';

export interface RulesEventIdentityFactory {
  nextRulesEventId(): RulesEventId;
}

export interface ExecuteRulesCommand {
  readonly command: RulesCommand;
  readonly idempotencyKey: IdempotencyKey;
  readonly expectedRevision: number;
  readonly occurredAt: IsoTimestamp;
}

export class RulesEngineUseCases {
  public constructor(
    private readonly repository: RulesEngineRepository,
    private readonly identities: RulesEventIdentityFactory,
  ) {}

  public execute(input: ExecuteRulesCommand): RulesCommitResult {
    return this.repository.commitOnce({
      eventId: this.identities.nextRulesEventId(),
      idempotencyKey: input.idempotencyKey,
      command: input.command,
      expectedRevision: input.expectedRevision,
      occurredAt: input.occurredAt,
    });
  }
}
