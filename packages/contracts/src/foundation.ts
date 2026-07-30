declare const brand: unique symbol;

type Branded<Value, Name extends string> = Value & {
  readonly [brand]: Name;
};

export type CampaignId = Branded<string, 'CampaignId'>;
export type NpcId = Branded<string, 'NpcId'>;
export type QuestId = Branded<string, 'QuestId'>;
export type AdventureId = Branded<string, 'AdventureId'>;
export type TurnId = Branded<string, 'TurnId'>;
export type IsoTimestamp = Branded<string, 'IsoTimestamp'>;
export type SchemaVersion = Branded<number, 'SchemaVersion'>;
export type PromptVersion = Branded<number, 'PromptVersion'>;

function requireCanonicalText(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty and must not contain surrounding whitespace`);
  }
  return value;
}

function createId<Id extends string>(value: string, label: string): Id {
  return requireCanonicalText(value, label) as Id;
}

export const campaignId = (value: string): CampaignId => createId(value, 'CampaignId');
export const npcId = (value: string): NpcId => createId(value, 'NpcId');
export const questId = (value: string): QuestId => createId(value, 'QuestId');
export const adventureId = (value: string): AdventureId => createId(value, 'AdventureId');
export const turnId = (value: string): TurnId => createId(value, 'TurnId');

export function isoTimestamp(value: string): IsoTimestamp {
  requireCanonicalText(value, 'IsoTimestamp');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError('IsoTimestamp must use canonical UTC ISO 8601 format');
  }
  return value as IsoTimestamp;
}

export function timestampFromDate(value: Date): IsoTimestamp {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError('Cannot create an IsoTimestamp from an invalid Date');
  }
  return value.toISOString() as IsoTimestamp;
}

function positiveVersion<Version extends number>(value: number, label: string): Version {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value as Version;
}

export const schemaVersion = (value: number): SchemaVersion =>
  positiveVersion(value, 'SchemaVersion');
export const promptVersion = (value: number): PromptVersion =>
  positiveVersion(value, 'PromptVersion');

export type CompatibleEnum<Known extends string> =
  | { readonly kind: 'known'; readonly value: Known }
  | { readonly kind: 'unknown'; readonly raw: string };

export function compatibleEnum<const Values extends readonly string[]>(
  knownValues: Values,
  raw: string,
): CompatibleEnum<Values[number]> {
  if ((knownValues as readonly string[]).includes(raw)) {
    return { kind: 'known', value: raw as Values[number] };
  }
  return { kind: 'unknown', raw };
}
