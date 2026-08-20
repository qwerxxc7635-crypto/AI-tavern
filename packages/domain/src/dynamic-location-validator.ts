import {
  createDynamicLocationProfile,
  isoTimestamp,
  locationId,
  type CampaignLocationState,
  type DynamicLocationCandidate,
  type DynamicLocationProfile,
  type LocationConnection,
  type LocationExpansionMode,
  type LocationTravelMode,
  type WorldConstitution,
  LOCATION_TRAVEL_MODES,
} from '@ember-tavern/contracts';

const MAX_LOCATION_DEPTH = 8;

export interface MaterializeDynamicLocationsInput {
  readonly campaignId: string;
  readonly constitution: WorldConstitution;
  readonly origin: DynamicLocationProfile;
  readonly expansionMode: LocationExpansionMode;
  readonly candidates: readonly DynamicLocationCandidate[];
  readonly existing: readonly DynamicLocationProfile[];
  readonly allowedFactionIds: readonly string[];
  readonly generationRecordId: string;
  readonly at: string;
}

export interface MaterializedLocationBatch {
  readonly locations: readonly DynamicLocationProfile[];
  readonly connectionPairs: readonly (readonly [string, string])[];
}

export interface PlanLocationTravelInput {
  readonly state: CampaignLocationState;
  readonly targetLocationId: string;
  readonly mode: LocationTravelMode;
  readonly locations: readonly DynamicLocationProfile[];
  readonly connections: readonly LocationConnection[];
  readonly at: string;
}

export class DynamicLocationRuleError extends Error {
  public constructor(
    public readonly code:
      | 'LOCATION_CONSTITUTION_MISMATCH'
      | 'LOCATION_TOPOLOGY_INVALID'
      | 'LOCATION_DUPLICATE'
      | 'LOCATION_REFERENCE_UNAUTHORIZED'
      | 'LOCATION_TRAVEL_INVALID',
    public readonly paths: readonly string[],
    options?: ErrorOptions,
  ) {
    super('Dynamic location rule validation failed', options);
    this.name = 'DynamicLocationRuleError';
  }
}

export function materializeDynamicLocations(
  input: MaterializeDynamicLocationsInput,
): MaterializedLocationBatch {
  requireConstitution(input.constitution, input.campaignId);
  if (
    input.origin.campaignId !== input.campaignId ||
    input.candidates.length === 0 ||
    input.candidates.length > 8 ||
    !input.existing.some(({ id }) => id === input.origin.id) ||
    input.existing.some(
      (location) =>
        location.campaignId !== input.campaignId ||
        location.constitutionRevision !== input.constitution.revision ||
        !sameEvidence(location.constitutionEvidence, constitutionEvidence(input.constitution)),
    )
  ) {
    fail('LOCATION_TOPOLOGY_INVALID', ['origin', 'candidates']);
  }
  const existingIds = new Set(input.existing.map(({ id }) => id));
  const normalizedNames = new Set(input.existing.map(({ name }) => normalize(name)));
  const candidateIds = new Set<string>();
  const candidateNames = new Set<string>();
  const allowedFactions = new Set(input.allowedFactionIds);
  const evidence = constitutionEvidence(input.constitution);
  for (const [index, candidate] of input.candidates.entries()) {
    if (
      existingIds.has(locationId(candidate.id)) ||
      !candidateIds.add(candidate.id) ||
      normalizedNames.has(normalize(candidate.name)) ||
      !candidateNames.add(normalize(candidate.name))
    ) {
      fail('LOCATION_DUPLICATE', [`candidates[${index}]`]);
    }
    if (!sameEvidence(candidate.constitutionEvidence, evidence)) {
      fail('LOCATION_CONSTITUTION_MISMATCH', [`candidates[${index}].constitutionEvidence`]);
    }
    if (candidate.factionIds.some((id) => !allowedFactions.has(id))) {
      fail('LOCATION_REFERENCE_UNAUTHORIZED', [`candidates[${index}].factionIds`]);
    }
    if (input.expansionMode === 'CHILDREN' && candidate.parentLocationId !== input.origin.id) {
      fail('LOCATION_TOPOLOGY_INVALID', [`candidates[${index}].parentLocationId`]);
    }
    if (
      input.expansionMode === 'CONNECTED' &&
      candidate.parentLocationId !== input.origin.parentLocationId
    ) {
      fail('LOCATION_TOPOLOGY_INVALID', [`candidates[${index}].parentLocationId`]);
    }
  }
  const allIds = new Set([...existingIds, ...candidateIds]);
  const locations = input.candidates.map((candidate) =>
    createDynamicLocationProfile({
      schemaVersion: 1,
      id: candidate.id,
      campaignId: input.campaignId,
      constitutionRevision: input.constitution.revision,
      locationKind: candidate.kind,
      materialization: 'DETAILED',
      name: candidate.name,
      description: candidate.description,
      parentLocationId: candidate.parentLocationId,
      atmosphere: candidate.atmosphere,
      features: candidate.features,
      factionIds: candidate.factionIds,
      currentSituation: candidate.currentSituation,
      constitutionEvidence: candidate.constitutionEvidence,
      generationRecordId: input.generationRecordId,
      revision: 1,
      createdAt: input.at,
      updatedAt: input.at,
    }),
  );
  const pairs = new Map<string, readonly [string, string]>();
  for (const [index, candidate] of input.candidates.entries()) {
    if (new Set(candidate.connections).size !== candidate.connections.length) {
      fail('LOCATION_DUPLICATE', [`candidates[${index}].connections`]);
    }
    for (const connected of candidate.connections) {
      if (!allIds.has(connected) || connected === candidate.id) {
        fail('LOCATION_TOPOLOGY_INVALID', [`candidates[${index}].connections`]);
      }
      addPair(pairs, candidate.id, connected);
    }
    if (input.expansionMode === 'CONNECTED') {
      if (!candidate.connections.includes(input.origin.id)) {
        fail('LOCATION_TOPOLOGY_INVALID', [`candidates[${index}].connections`]);
      }
    } else {
      addPair(pairs, candidate.id, input.origin.id);
    }
  }
  validateLocationTopology([...input.existing, ...locations]);
  return Object.freeze({
    locations: Object.freeze(locations),
    connectionPairs: Object.freeze([...pairs.values()]),
  });
}

export function validateLocationTopology(locations: readonly DynamicLocationProfile[]): void {
  const byId = new Map(locations.map((location) => [location.id, location]));
  if (byId.size !== locations.length) fail('LOCATION_DUPLICATE', ['locations.id']);
  for (const location of locations) {
    if (location.parentLocationId !== null && !byId.has(location.parentLocationId)) {
      fail('LOCATION_TOPOLOGY_INVALID', [location.id, 'parentLocationId']);
    }
    const visited = new Set<string>();
    let current: DynamicLocationProfile | undefined = location;
    let depth = 0;
    while (current !== undefined && current.parentLocationId !== null) {
      if (!visited.add(current.id) || depth >= MAX_LOCATION_DEPTH) {
        fail('LOCATION_TOPOLOGY_INVALID', [location.id, 'parentLocationId']);
      }
      current = byId.get(current.parentLocationId);
      depth += 1;
    }
  }
}

export function planLocationTravel(input: PlanLocationTravelInput): CampaignLocationState {
  const locations = new Map(input.locations.map((location) => [location.id, location]));
  const current = locations.get(input.state.currentLocationId);
  const target = locations.get(locationId(input.targetLocationId));
  if (
    current === undefined ||
    target === undefined ||
    current.campaignId !== input.state.campaignId ||
    target.campaignId !== input.state.campaignId ||
    target.id === current.id ||
    !LOCATION_TRAVEL_MODES.includes(input.mode) ||
    !isAdjacent(current, target, input.connections)
  ) {
    fail('LOCATION_TRAVEL_INVALID', ['targetLocationId']);
  }
  return Object.freeze({
    campaignId: input.state.campaignId,
    currentLocationId: target.id,
    revision: input.state.revision + 1,
    updatedAt: isoTimestamp(input.at),
  });
}

function isAdjacent(
  current: DynamicLocationProfile,
  target: DynamicLocationProfile,
  connections: readonly LocationConnection[],
): boolean {
  if (current.parentLocationId === target.id || target.parentLocationId === current.id) return true;
  return connections.some(
    ({ firstLocationId, secondLocationId }) =>
      (firstLocationId === current.id && secondLocationId === target.id) ||
      (firstLocationId === target.id && secondLocationId === current.id),
  );
}

function addPair(pairs: Map<string, readonly [string, string]>, left: string, right: string): void {
  const pair = left < right ? ([left, right] as const) : ([right, left] as const);
  pairs.set(`${pair[0]}\u0000${pair[1]}`, pair);
}

function requireConstitution(constitution: WorldConstitution, campaign: string): void {
  if (constitution.status !== 'LOCKED' || constitution.campaignId !== campaign) {
    fail('LOCATION_CONSTITUTION_MISMATCH', ['campaignId', 'status']);
  }
}

function constitutionEvidence(constitution: WorldConstitution) {
  return Object.freeze({
    technology: constitution.technology,
    magic: constitution.magic,
    society: constitution.society,
    politics: constitution.politics,
  });
}

function sameEvidence(
  left: DynamicLocationCandidate['constitutionEvidence'],
  right: DynamicLocationCandidate['constitutionEvidence'],
): boolean {
  return (
    left.technology === right.technology &&
    left.magic === right.magic &&
    left.society === right.society &&
    left.politics === right.politics
  );
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function fail(code: DynamicLocationRuleError['code'], paths: readonly string[]): never {
  throw new DynamicLocationRuleError(code, Object.freeze([...paths]));
}
