import { PersistenceDataError } from './campaign-repository.js';

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 100;
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_ARRAY_LENGTH = 100_000;
export const MAX_JSON_STRING_CHARACTERS = 1_048_576;
export const MAX_EVENT_RECORDS = 100_000;
export const MAX_GENERATION_RECORDS = 20_000;
export const MAX_TABLE_RECORDS = 20_000;
export const MAX_TOTAL_RECORDS = 200_000;

const ENTRY_SIZE_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  'manifest.json': 64 * 1024,
  'campaign.json': 32 * 1024 * 1024,
  'events.ndjson': 16 * 1024 * 1024,
  'generations.json': 16 * 1024 * 1024,
  'checksum.json': 64 * 1024,
});

export function archiveEntrySizeLimit(name: string): number | null {
  return ENTRY_SIZE_LIMITS[name] ?? null;
}

export function validateArchiveEntryResources(
  name: string,
  compressedSize: number,
  uncompressedSize: number,
): number {
  const limit = archiveEntrySizeLimit(name);
  if (limit === null || uncompressedSize > limit) {
    throw new PersistenceDataError(`Save ZIP entry exceeds its size limit: ${name}`);
  }
  if (
    uncompressedSize > 0 &&
    (compressedSize === 0 || uncompressedSize > compressedSize * MAX_COMPRESSION_RATIO)
  ) {
    throw new PersistenceDataError(`Save ZIP entry exceeds the compression ratio limit: ${name}`);
  }
  return limit;
}

export function validateRecordCount(label: string, count: number, limit: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > limit) {
    throw new PersistenceDataError(`${label} exceeds the record limit`);
  }
}

export function addExpandedBytes(total: number, entry: number): number {
  const next = total + entry;
  if (!Number.isSafeInteger(next) || total < 0 || entry < 0 || next > MAX_UNCOMPRESSED_BYTES) {
    throw new PersistenceDataError('Save ZIP exceeds the uncompressed size limit');
  }
  return next;
}

export function validateJsonTextResources(text: string, label: string): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringCharacters = 0;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      stringCharacters += 1;
      if (stringCharacters > MAX_JSON_STRING_CHARACTERS * 6) {
        throw new PersistenceDataError(`${label} exceeds the JSON string limit`);
      }
    } else if (character === '"') {
      inString = true;
      stringCharacters = 0;
    } else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) {
        throw new PersistenceDataError(`${label} exceeds the JSON depth limit`);
      }
    } else if (character === '}' || character === ']') {
      depth -= 1;
    }
  }
}

export function validateJsonValueResources(value: unknown, label: string): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.depth > MAX_JSON_DEPTH) {
      throw new PersistenceDataError(`${label} exceeds the JSON depth limit`);
    }
    if (typeof current.value === 'string') {
      if (current.value.length > MAX_JSON_STRING_CHARACTERS) {
        throw new PersistenceDataError(`${label} exceeds the JSON string limit`);
      }
    } else if (Array.isArray(current.value)) {
      if (current.value.length > MAX_JSON_ARRAY_LENGTH) {
        throw new PersistenceDataError(`${label} exceeds the JSON array limit`);
      }
      for (const entry of current.value) pending.push({ value: entry, depth: current.depth + 1 });
    } else if (current.value !== null && typeof current.value === 'object') {
      for (const [key, entry] of Object.entries(current.value)) {
        if (key.length > MAX_JSON_STRING_CHARACTERS) {
          throw new PersistenceDataError(`${label} exceeds the JSON string limit`);
        }
        pending.push({ value: entry, depth: current.depth + 1 });
      }
    }
  }
}
