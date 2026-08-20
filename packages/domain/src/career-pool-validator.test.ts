import {
  campaignId,
  careerEvidenceFor,
  createCareerPool,
  generationRecordId,
  isoTimestamp,
  schemaVersion,
  type CareerCandidate,
  type CareerRarity,
  type WorldConstitution,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  createInitialCareerPool,
  createRuntimeCareers,
  requireCareerFromPool,
} from './career-pool-validator.js';

function world(key: 'fantasy' | 'investigation' | 'cyberpunk'): WorldConstitution {
  const settings: Record<
    'fantasy' | 'investigation' | 'cyberpunk',
    readonly [string, string, string, string]
  > = {
    fantasy: ['Late medieval', 'Guild towns', 'Coin and barter', 'Guild oaths define careers'],
    investigation: [
      '1920s industry',
      'Urban professional associations',
      'Wages and credit',
      'Careers require licenses and credible education',
    ],
    cyberpunk: [
      'Corporate cybernetics',
      'Megacity contract networks',
      'Credits and reputation',
      'Careers emerge from corps, crews, and street contracts',
    ],
  };
  const [technology, society, economy, careerRules] = settings[key];
  return {
    campaignId: campaignId(`campaign-${key}`),
    schemaVersion: schemaVersion(1),
    revision: 2,
    status: 'LOCKED',
    worldType: key,
    era: technology,
    technology,
    magic: 'No unbounded power',
    peoples: ['People'],
    society,
    politics: 'Local institutions compete',
    economy,
    combatScale: 'Personal',
    deathRules: 'Death is permanent',
    careerRules,
    equipmentRules: 'Equipment follows technology',
    npcRules: 'Knowledge is bounded',
    traitRules: 'Traits require tradeoffs',
    taboos: [],
    createdAt: isoTimestamp('2026-08-20T00:00:00.000Z'),
    updatedAt: isoTimestamp('2026-08-20T00:01:00.000Z'),
    lockedAt: isoTimestamp('2026-08-20T00:01:00.000Z'),
  };
}

const rarities: readonly CareerRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'SPECIAL'];

function candidates(constitution: WorldConstitution, prefix: string): readonly CareerCandidate[] {
  const archetypes = ['WARRIOR', 'ROGUE', 'SCHOLAR', 'DIPLOMAT'] as const;
  return rarities.map((rarity, index) => ({
    id: `career-${prefix}-${index}`,
    name: `${prefix} role ${index}`,
    rarity,
    role: `World-specific role ${index}`,
    skills: [`Skill ${index}`],
    equipmentTags: [`Equipment ${index}`],
    socialPosition: `Position ${index}`,
    relationshipHooks: [`Hook ${index}`],
    risks: [`Risk ${index}`],
    requirements: [`Requirement ${index}`],
    constitutionEvidence: careerEvidenceFor(constitution),
    legacyArchetype: requireItem(archetypes, index),
  }));
}

describe('CareerPool rules', () => {
  it.each(['fantasy', 'investigation', 'cyberpunk'] as const)(
    'creates a repeatable, world-bound %s pool with all rarity tiers',
    (key) => {
      const constitution = world(key);
      const pool = createInitialCareerPool({
        constitution,
        candidates: candidates(constitution, key),
        policy: { mode: 'INITIAL', requestedRarities: rarities },
        generationRecordId: generationRecordId(`generation-${key}`),
        at: isoTimestamp('2026-08-20T01:00:00.000Z'),
      });
      expect(pool.careers.map(({ rarity }) => rarity)).toEqual(rarities);
      expect(pool.careers.every(({ campaignId }) => campaignId === constitution.campaignId)).toBe(
        true,
      );
    },
  );

  it('rejects wrong rarity distribution and forged Constitution evidence', () => {
    const constitution = world('fantasy');
    const values = candidates(constitution, 'fantasy');
    expect(() =>
      createInitialCareerPool({
        constitution,
        candidates: values,
        policy: { mode: 'INITIAL', requestedRarities: ['COMMON', 'COMMON', 'RARE', 'SPECIAL'] },
        generationRecordId: generationRecordId('generation-wrong-rarity'),
        at: isoTimestamp('2026-08-20T01:00:00.000Z'),
      }),
    ).toThrow(expect.objectContaining({ code: 'CAREER_RARITY_MISMATCH' }));
    expect(() =>
      createInitialCareerPool({
        constitution,
        candidates: [
          {
            ...requireItem(values, 0),
            constitutionEvidence: {
              ...requireItem(values, 0).constitutionEvidence,
              technology: 'Laser age',
            },
          },
          ...values.slice(1),
        ],
        policy: { mode: 'INITIAL', requestedRarities: rarities },
        generationRecordId: generationRecordId('generation-forged'),
        at: isoTimestamp('2026-08-20T01:00:00.000Z'),
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CAREER_CONSTITUTION_MISMATCH',
        paths: ['careers[0].constitutionEvidence.technology'],
      }),
    );
  });

  it('rejects existing IDs and normalized names during runtime discovery', () => {
    const constitution = world('cyberpunk');
    const pool = createInitialCareerPool({
      constitution,
      candidates: candidates(constitution, 'cyberpunk'),
      policy: { mode: 'INITIAL', requestedRarities: rarities },
      generationRecordId: generationRecordId('generation-initial'),
      at: isoTimestamp('2026-08-20T01:00:00.000Z'),
    });
    expect(() =>
      createRuntimeCareers({
        constitution,
        pool,
        candidates: [
          { ...requireItem(candidates(constitution, 'new'), 0), name: 'CYBERPUNK ROLE 0' },
        ],
        policy: { mode: 'RUNTIME_DISCOVERY', requestedRarities: ['COMMON'] },
        generationRecordId: generationRecordId('generation-runtime'),
        at: isoTimestamp('2026-08-20T02:00:00.000Z'),
      }),
    ).toThrow(expect.objectContaining({ code: 'CAREER_DUPLICATE' }));
  });

  it('requires character references to match both persisted ID and display name', () => {
    const constitution = world('investigation');
    const pool = createInitialCareerPool({
      constitution,
      candidates: candidates(constitution, 'investigation'),
      policy: { mode: 'INITIAL', requestedRarities: rarities },
      generationRecordId: generationRecordId('generation-investigation'),
      at: isoTimestamp('2026-08-20T01:00:00.000Z'),
    });
    const selected = requireItem(pool.careers, 0);
    expect(requireCareerFromPool(pool, { id: selected.id, displayName: selected.name })).toBe(
      selected,
    );
    expect(() =>
      requireCareerFromPool(pool, { id: selected.id, displayName: 'Renamed by the model' }),
    ).toThrow(expect.objectContaining({ code: 'CAREER_REFERENCE_INVALID' }));
  });

  it('does not accept a pool from another Constitution revision', () => {
    const constitution = world('fantasy');
    const current = createInitialCareerPool({
      constitution,
      candidates: candidates(constitution, 'fantasy'),
      policy: { mode: 'INITIAL', requestedRarities: rarities },
      generationRecordId: generationRecordId('generation-current'),
      at: isoTimestamp('2026-08-20T01:00:00.000Z'),
    });
    const stale = createCareerPool({
      ...current,
      constitutionRevision: 1,
      careers: current.careers.map((career) => ({ ...career, constitutionRevision: 1 })),
    });
    expect(() =>
      createRuntimeCareers({
        constitution,
        pool: stale,
        candidates: [requireItem(candidates(constitution, 'new'), 0)],
        policy: { mode: 'RUNTIME_DISCOVERY', requestedRarities: ['COMMON'] },
        generationRecordId: generationRecordId('generation-stale'),
        at: isoTimestamp('2026-08-20T02:00:00.000Z'),
      }),
    ).toThrow(expect.objectContaining({ code: 'CONSTITUTION_REVISION_MISMATCH' }));
  });
});

function requireItem<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Fixture item ${index} is missing`);
  return value;
}
