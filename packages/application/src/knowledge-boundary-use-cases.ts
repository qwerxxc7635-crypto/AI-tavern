import type {
  CampaignId,
  Claim,
  KnowledgeActor,
  Memory,
  WorldTruth,
} from '@ember-tavern/contracts';
import {
  knowledgeForPrompt,
  type ActorKnowledgeProjection,
  type PromptKnowledgeEntry,
} from '@ember-tavern/domain';
import {
  KnowledgeBoundaryRepository,
  type ForgetKnowledgeOnceInput,
  type KnowledgeCommitReceipt,
  type SaveKnowledgeOnceInput,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';

export class KnowledgeBoundaryUseCases {
  private readonly repository: KnowledgeBoundaryRepository;

  public constructor(database: TransactionalSqliteDatabase) {
    this.repository = new KnowledgeBoundaryRepository(database);
  }

  public saveWorldTruth(truth: WorldTruth, expectedRevision: number): WorldTruth {
    return this.repository.saveWorldTruth(truth, expectedRevision);
  }

  public saveClaim(claim: Claim, expectedRevision: number): Claim {
    return this.repository.saveClaim(claim, expectedRevision);
  }

  public saveKnowledgeOnce(input: SaveKnowledgeOnceInput): KnowledgeCommitReceipt {
    return this.repository.saveKnowledgeOnce(input);
  }

  public forgetKnowledgeOnce(input: ForgetKnowledgeOnceInput): KnowledgeCommitReceipt {
    return this.repository.forgetKnowledgeOnce(input);
  }

  public appendMemory(memory: Memory): Memory {
    return this.repository.appendMemory(memory);
  }

  public projectActor(campaignId: CampaignId, actor: KnowledgeActor): ActorKnowledgeProjection {
    return this.repository.projectActor(campaignId, actor);
  }

  public projectPromptKnowledge(
    campaignId: CampaignId,
    actor: KnowledgeActor,
  ): readonly PromptKnowledgeEntry[] {
    return knowledgeForPrompt(this.projectActor(campaignId, actor));
  }
}
