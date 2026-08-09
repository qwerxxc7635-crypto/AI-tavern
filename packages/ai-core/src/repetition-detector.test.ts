import { describe, expect, it } from 'vitest';

import {
  findRepeatedNpcArchetype,
  findRepeatedPhrase,
  hasRepeatedQuestStructure,
  npcArchetypeSignature,
  questStructureSignature,
} from './repetition-detector.js';

describe('repetition detector', () => {
  it('detects normalized repeated phrases but ignores short connective text', () => {
    expect(
      findRepeatedPhrase([
        '潮水正在越过废弃灯塔下方的旧堤岸。',
        '潮水正在越过废弃灯塔下方的旧堤岸！',
      ]),
    ).toBe('潮水正在越过废弃灯塔下方的旧堤岸');
    expect(
      findRepeatedPhrase(
        ['The lighthouse door must remain sealed until dawn.'],
        ['The lighthouse door must remain sealed until dawn.'],
      ),
    ).toBe('the lighthouse door must remain sealed until dawn');
    expect(findRepeatedPhrase(['Look there. Look there.'])).toBeNull();
  });

  it('builds order-stable quest signatures and detects a prior structure', () => {
    const quest = {
      risk: 'MODERATE',
      rewardTier: 'NOTABLE',
      expectedTurns: { min: 8, max: 12 },
      recommendedAttributes: ['knowledge', 'agility'],
    };
    const signature = questStructureSignature(quest);
    expect(signature).toBe('moderate|notable|8-12|agility,knowledge');
    expect(
      hasRepeatedQuestStructure({ ...quest, recommendedAttributes: ['agility', 'knowledge'] }, [
        signature,
      ]),
    ).toBe(true);
  });

  it('detects duplicate NPC archetypes within a roster and against existing NPCs', () => {
    const archetype = { identity: 'Harbor Scout', personality: 'Quiet, watchful.' };
    expect(findRepeatedNpcArchetype([archetype, { ...archetype }])).toBe(
      npcArchetypeSignature(archetype),
    );
    expect(
      findRepeatedNpcArchetype([archetype], [npcArchetypeSignature(archetype)]),
    ).not.toBeNull();
  });
});
