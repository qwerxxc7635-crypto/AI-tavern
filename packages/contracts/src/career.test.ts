import { describe, expect, it } from 'vitest';

import {
  CareerContractError,
  appendCareerPool,
  campaignId,
  careerEvidenceFor,
  careerId,
  createCareerDefinition,
  createCareerPool,
  generationRecordId,
  isoTimestamp,
  normalizeCareerName,
  parseCareerPool,
  type CareerDefinition,
  type WorldConstitutionContent,
} from './index.js';

const constitution: WorldConstitutionContent = {
  worldType: 'Low fantasy',
  era: 'Sail age',
  technology: 'Black powder is rare',
  magic: 'Magic requires costly rites',
  peoples: ['Harbor folk'],
  society: 'Merchant guilds govern public life',
  politics: 'A harbor council rules',
  economy: 'Trade and shipbuilding',
  combatScale: 'Personal',
  deathRules: 'Death is permanent',
  careerRules: 'Careers arise from licensed guilds and civic obligations',
  equipmentRules: 'Use period materials',
  npcRules: 'Knowledge follows lived experience',
  traitRules: 'Benefits require drawbacks',
  taboos: [],
};

function career(
  idValue = 'career-shoal-pilot',
  name = 'Shoal Pilot',
  source: CareerDefinition['source'] = 'INITIAL_GENERATION',
): CareerDefinition {
  return createCareerDefinition({
    schemaVersion: 1,
    id: careerId(idValue),
    campaignId: campaignId('campaign-careers'),
    constitutionRevision: 3,
    name,
    rarity: 'UNCOMMON',
    role: 'Guides ships through dangerous shallows',
    skills: ['Navigation'],
    equipmentTags: ['Charts'],
    socialPosition: 'Licensed guild specialist',
    relationshipHooks: ['Owes the harbor master'],
    risks: ['Smuggling accusations'],
    requirements: ['Guild sponsorship'],
    constitutionEvidence: careerEvidenceFor(constitution),
    legacyArchetype: 'SCHOLAR',
    source,
    generationRecordId:
      source === 'LEGACY_MAPPING' ? null : generationRecordId(`generation-${idValue}`),
    createdAt: isoTimestamp('2026-08-20T10:00:00.000Z'),
  });
}

describe('career contracts', () => {
  it('creates an immutable structured career without numeric rule modifiers', () => {
    const value = career();
    expect(value).toMatchObject({
      kind: 'CAREER_DEFINITION',
      rarity: 'UNCOMMON',
      legacyArchetype: 'SCHOLAR',
    });
    expect(value).not.toHaveProperty('attributeModifiers');
    expect(value).not.toHaveProperty('damage');
    expect(Object.isFrozen(value.skills)).toBe(true);
  });

  it.each([
    ['skills', []],
    ['relationshipHooks', []],
    ['risks', []],
    ['requirements', []],
    ['legacyArchetype', 'MAGE'],
  ] as const)('rejects an incomplete or invalid %s', (key, value) => {
    expect(() => createCareerDefinition({ ...career(), [key]: value })).toThrow(
      CareerContractError,
    );
  });

  it('requires generated and legacy careers to carry the correct provenance shape', () => {
    expect(() => createCareerDefinition({ ...career(), generationRecordId: null })).toThrow(
      expect.objectContaining({ path: 'generationRecordId' }),
    );
    expect(() =>
      createCareerDefinition({
        ...career('legacy', 'Legacy Scholar', 'LEGACY_MAPPING'),
        generationRecordId: generationRecordId('unexpected'),
      }),
    ).toThrow(expect.objectContaining({ path: 'generationRecordId' }));
  });

  it('deduplicates Unicode-compatible names and appends by pool revision', () => {
    const initial = createCareerPool({
      schemaVersion: 1,
      campaignId: campaignId('campaign-careers'),
      constitutionRevision: 3,
      careers: [career()],
      revision: 1,
      createdAt: isoTimestamp('2026-08-20T10:00:00.000Z'),
      updatedAt: isoTimestamp('2026-08-20T10:00:00.000Z'),
    });
    const next = appendCareerPool(
      initial,
      [career('career-lantern-keeper', 'Lantern Keeper', 'RUNTIME_DISCOVERY')],
      isoTimestamp('2026-08-20T11:00:00.000Z'),
    );
    expect(next.revision).toBe(2);
    expect(next.careers).toHaveLength(2);
    expect(parseCareerPool(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(() =>
      appendCareerPool(
        initial,
        [career('career-duplicate', 'Ｓｈｏａｌ　Ｐｉｌｏｔ', 'RUNTIME_DISCOVERY')],
        isoTimestamp('2026-08-20T11:00:00.000Z'),
      ),
    ).toThrow(expect.objectContaining({ code: 'CAREER_DUPLICATE', path: 'careers.name' }));
  });

  it('normalizes names without depending on the host locale', () => {
    expect(normalizeCareerName('  SHOAL   Pilot  ')).toBe('shoal pilot');
    expect(normalizeCareerName('Ｓｈｏａｌ　Ｐｉｌｏｔ')).toBe('shoal pilot');
  });
});
