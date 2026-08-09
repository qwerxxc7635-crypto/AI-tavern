export interface QuestStructureShape {
  readonly risk: string;
  readonly rewardTier: string;
  readonly expectedTurns: Readonly<{ min: number; max: number }>;
  readonly recommendedAttributes: readonly string[];
}

export interface NpcArchetypeShape {
  readonly identity: string;
  readonly personality: string;
}

export function findRepeatedPhrase(
  values: readonly string[],
  existingValues: readonly string[] = [],
): string | null {
  const seen = new Set<string>();
  for (const value of existingValues) {
    for (const segment of value.split(/[.!?。！？；;\n]+/u)) {
      const normalized = normalizeText(segment);
      if (alphanumericLength(normalized) >= 12) seen.add(normalized);
    }
  }
  for (const value of values) {
    for (const segment of value.split(/[.!?。！？；;\n]+/u)) {
      const normalized = normalizeText(segment);
      if (alphanumericLength(normalized) < 12) continue;
      if (seen.has(normalized)) return normalized;
      seen.add(normalized);
    }
  }
  return null;
}

export function questStructureSignature(quest: QuestStructureShape): string {
  const attributes = [...quest.recommendedAttributes].map(normalizeToken).sort();
  return [
    normalizeToken(quest.risk),
    normalizeToken(quest.rewardTier),
    `${quest.expectedTurns.min}-${quest.expectedTurns.max}`,
    attributes.join(','),
  ].join('|');
}

export function hasRepeatedQuestStructure(
  candidate: QuestStructureShape,
  recentSignatures: readonly string[],
): boolean {
  return recentSignatures.includes(questStructureSignature(candidate));
}

export function npcArchetypeSignature(npc: NpcArchetypeShape): string {
  return `${normalizeText(npc.identity)}|${normalizeText(npc.personality)}`;
}

export function findRepeatedNpcArchetype(
  candidates: readonly NpcArchetypeShape[],
  existingSignatures: readonly string[] = [],
): string | null {
  const seen = new Set(existingSignatures);
  for (const candidate of candidates) {
    const signature = npcArchetypeSignature(candidate);
    if (seen.has(signature)) return signature;
    seen.add(signature);
  }
  return null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeText(value: string): string {
  let result = '';
  let pendingSpace = false;
  for (const character of value.trim().toLowerCase()) {
    if (/^[\p{L}\p{N}]$/u.test(character)) {
      if (pendingSpace && result.length > 0) result += ' ';
      result += character;
      pendingSpace = false;
    } else {
      pendingSpace = true;
    }
  }
  return result;
}

function alphanumericLength(value: string): number {
  return [...value].filter((character) => /^[\p{L}\p{N}]$/u.test(character)).length;
}
