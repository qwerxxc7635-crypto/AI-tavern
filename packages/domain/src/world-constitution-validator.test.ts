import {
  campaignId,
  isoTimestamp,
  schemaVersion,
  type WorldConstitution,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { assertConstitutionBinding, assertWorldConstitutionCompliance } from './index.js';
import type { WorldConstitutionRuleError } from './index.js';

const constitution: WorldConstitution = {
  campaignId: campaignId('campaign-constitution'),
  schemaVersion: schemaVersion(1),
  revision: 3,
  status: 'LOCKED',
  worldType: 'Low fantasy',
  era: 'Late medieval',
  technology: 'Late medieval',
  magic: 'Magic always leaves a warm trace.',
  peoples: ['Humans'],
  society: 'Guild towns',
  politics: 'Competing councils',
  economy: 'Coin and barter',
  combatScale: 'Small-scale',
  deathRules: 'Death is permanent.',
  careerRules: 'Careers are social roles.',
  equipmentRules: 'Equipment follows local technology.',
  npcRules: 'NPC knowledge is bounded.',
  traitRules: 'Traits require tradeoffs.',
  taboos: ['Graphic cruelty'],
  createdAt: isoTimestamp('2026-08-14T00:00:00.000Z'),
  updatedAt: isoTimestamp('2026-08-14T00:01:00.000Z'),
  lockedAt: isoTimestamp('2026-08-14T00:01:00.000Z'),
};

describe('World Constitution rules', () => {
  it('accepts an exact locked campaign/revision binding', () => {
    expect(() =>
      assertConstitutionBinding(constitution, {
        campaignId: constitution.campaignId,
        constitutionRevision: 3,
      }),
    ).not.toThrow();
  });

  it.each([
    [{ status: 'DRAFT' as const }, 'CONSTITUTION_NOT_LOCKED'],
    [{ campaignId: campaignId('other-campaign') }, 'CONSTITUTION_CAMPAIGN_MISMATCH'],
    [{ constitutionRevision: 2 }, 'CONSTITUTION_REVISION_MISMATCH'],
  ] as const)('rejects a downstream mismatch with a stable code', (override, code) => {
    const candidate = {
      campaignId: constitution.campaignId,
      constitutionRevision: constitution.revision,
      ...override,
    };
    const source =
      'status' in override ? { ...constitution, status: override.status } : constitution;
    expect(() => assertConstitutionBinding(source, candidate)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it('rejects generated world fields that contradict technology, magic, or taboos', () => {
    expect(() =>
      assertWorldConstitutionCompliance(constitution, {
        technologyLevel: 'Industrial',
        powerRules: ['Magic has no observable cost.'],
        forbiddenElements: [],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONSTITUTION_WORLD_MISMATCH',
        paths: ['technologyLevel', 'powerRules', 'forbiddenElements'],
      } satisfies Partial<WorldConstitutionRuleError>),
    );
  });

  it('accepts a generated world projection that obeys every Constitution rule', () => {
    expect(() =>
      assertWorldConstitutionCompliance(constitution, {
        technologyLevel: constitution.technology,
        powerRules: [constitution.magic, 'Oaths bind only willing speakers.'],
        forbiddenElements: [...constitution.taboos],
      }),
    ).not.toThrow();
  });
});
