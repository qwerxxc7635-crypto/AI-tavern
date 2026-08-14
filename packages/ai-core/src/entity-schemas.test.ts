import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CareerOutputSchema,
  DirectorActionOutputSchema,
  NpcLodInputSchema,
  QuestGraphOutputSchema,
  STRUCTURED_ENTITY_KINDS,
  STRUCTURED_ENTITY_SCHEMAS,
  structuredEntitySchemas,
  type StructuredEntityKind,
} from './entity-schemas.js';

interface EntityFixture {
  readonly kind: StructuredEntityKind;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
}

const fixtures = JSON.parse(
  readFileSync(new URL('./entity-schema-contract.fixture.json', import.meta.url), 'utf8'),
) as readonly EntityFixture[];

const fixtureFor = (kind: StructuredEntityKind): EntityFixture => {
  const fixture = fixtures.find((candidate) => candidate.kind === kind);
  if (fixture === undefined) throw new Error(`Missing fixture for ${kind}`);
  return fixture;
};

describe('structured entity schemas', () => {
  it('registers exactly the closed V0.3 entity set with versioned input and output', () => {
    expect(Object.keys(STRUCTURED_ENTITY_SCHEMAS)).toEqual(STRUCTURED_ENTITY_KINDS);
    expect(fixtures.map(({ kind }) => kind)).toEqual(STRUCTURED_ENTITY_KINDS);

    for (const kind of STRUCTURED_ENTITY_KINDS) {
      const definition = structuredEntitySchemas(kind);
      const fixture = fixtureFor(kind);
      expect(definition.schemaVersion).toBe(1);
      expect(definition.input.parse(fixture.input)).toEqual(fixture.input);
      expect(definition.output.parse(fixture.output)).toEqual(fixture.output);
    }
  });

  it.each(STRUCTURED_ENTITY_KINDS)('%s rejects missing fields and unknown versions', (kind) => {
    const definition = structuredEntitySchemas(kind);
    const fixture = fixtureFor(kind);
    expect(definition.input.safeParse({ schemaVersion: 1 }).success).toBe(false);
    expect(definition.output.safeParse({ schemaVersion: 1 }).success).toBe(false);
    expect(definition.input.safeParse({ ...fixture.input, schemaVersion: 2 }).success).toBe(false);
    expect(definition.output.safeParse({ ...fixture.output, schemaVersion: 2 }).success).toBe(
      false,
    );
  });

  it('rejects out-of-range values and resource overflows', () => {
    const careerFixture = fixtureFor('CAREER');
    expect(
      structuredEntitySchemas('CAREER').input.safeParse({
        ...careerFixture.input,
        requestedCount: 25,
      }).success,
    ).toBe(false);

    const career = CareerOutputSchema.parse(careerFixture.output).careers[0];
    if (career === undefined) throw new Error('Career fixture is empty');
    expect(
      CareerOutputSchema.safeParse({
        schemaVersion: 1,
        careers: Array.from({ length: 25 }, (_, index) => ({ ...career, id: `career-${index}` })),
      }).success,
    ).toBe(false);

    expect(
      DirectorActionOutputSchema.safeParse({
        schemaVersion: 1,
        actions: Array.from({ length: 33 }, (_, index) => ({
          id: `action-${index}`,
          kind: 'WORLD_CHANGE',
          actorEntityId: null,
          targetEntityIds: [],
          rationale: 'A bounded proposal',
          proposedEffects: [],
          urgency: 'LOW',
          cooldownKey: `cooldown-${index}`,
        })),
      }).success,
    ).toBe(false);
  });

  it('rejects unknown data instead of stripping it silently', () => {
    const fixture = fixtureFor('ITEM');
    const output = structuredClone(fixture.output);
    const items = output['items'];
    if (!Array.isArray(items) || items[0] === undefined) throw new Error('Item fixture is empty');
    items[0] = { ...(items[0] as object), numericDamage: 999 };
    expect(structuredEntitySchemas('ITEM').output.safeParse(output).success).toBe(false);
    expect(
      structuredEntitySchemas('ITEM').input.safeParse({
        ...fixture.input,
        providerApiKey: 'secret',
      }).success,
    ).toBe(false);
  });

  it('keeps parse separate from business validation', () => {
    const quest = fixtureFor('QUEST_GRAPH').output;
    const parsed = QuestGraphOutputSchema.parse(quest);
    const firstQuest = parsed.quests[0];
    if (firstQuest === undefined) throw new Error('Quest fixture is empty');

    expect(
      QuestGraphOutputSchema.safeParse({
        ...quest,
        edges: [
          {
            fromQuestId: 'missing-source',
            toQuestId: firstQuest.id,
            kind: 'REQUIRES',
            condition: 'A domain validator must resolve this reference',
          },
        ],
      }).success,
    ).toBe(true);

    const npcInput = fixtureFor('NPC_LOD').input;
    expect(NpcLodInputSchema.safeParse({ ...npcInput, currentLod: 3, targetLod: 1 }).success).toBe(
      true,
    );
  });

  it('makes the fixture envelope itself strict for cross-language consumers', () => {
    const envelope = z
      .object({
        kind: z.enum(STRUCTURED_ENTITY_KINDS),
        input: z.record(z.string(), z.unknown()),
        output: z.record(z.string(), z.unknown()),
      })
      .strict();
    expect(fixtures.every((fixture) => envelope.safeParse(fixture).success)).toBe(true);
    expect(envelope.safeParse({ ...fixtures[0], kind: 'UNKNOWN_ENTITY' }).success).toBe(false);
    expect(envelope.safeParse({ ...fixtures[0], ignored: true }).success).toBe(false);
  });
});
