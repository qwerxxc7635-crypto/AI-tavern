import { describe, expect, it } from 'vitest';

import { PersistenceDataError } from './campaign-repository.js';
import {
  MAX_ARCHIVE_BYTES,
  MAX_EVENT_RECORDS,
  MAX_JSON_ARRAY_LENGTH,
  MAX_JSON_DEPTH,
  MAX_JSON_STRING_CHARACTERS,
  MAX_UNCOMPRESSED_BYTES,
  addExpandedBytes,
  validateArchiveEntryResources,
  validateJsonTextResources,
  validateJsonValueResources,
  validateRecordCount,
} from './save-resource-limits.js';

describe('save archive resource limits', () => {
  it('uses bounded archive, expanded and per-entry budgets', () => {
    expect(MAX_ARCHIVE_BYTES).toBe(32 * 1024 * 1024);
    expect(MAX_UNCOMPRESSED_BYTES).toBe(64 * 1024 * 1024);
    expect(addExpandedBytes(MAX_UNCOMPRESSED_BYTES - 1, 1)).toBe(MAX_UNCOMPRESSED_BYTES);
    expect(() => addExpandedBytes(MAX_UNCOMPRESSED_BYTES, 1)).toThrow(/uncompressed/u);
    expect(validateArchiveEntryResources('manifest.json', 1024, 2048)).toBe(64 * 1024);
    expect(() => validateArchiveEntryResources('manifest.json', 1024, 64 * 1024 + 1)).toThrow(
      PersistenceDataError,
    );
    expect(() => validateArchiveEntryResources('campaign.json', 1024, 1024 * 101)).toThrow(
      /compression ratio/u,
    );
  });

  it('rejects deep JSON, oversized arrays and oversized strings iteratively', () => {
    const tooDeep = `${'['.repeat(MAX_JSON_DEPTH + 1)}0${']'.repeat(MAX_JSON_DEPTH + 1)}`;
    expect(() => validateJsonTextResources(tooDeep, 'deep.json')).toThrow(/depth/u);
    expect(() =>
      validateJsonValueResources(new Array<unknown>(MAX_JSON_ARRAY_LENGTH + 1).fill(null), 'array'),
    ).toThrow(/array/u);
    expect(() =>
      validateJsonValueResources('x'.repeat(MAX_JSON_STRING_CHARACTERS + 1), 'string'),
    ).toThrow(/string/u);
  });

  it('rejects record counts before row allocation', () => {
    expect(() => validateRecordCount('events', MAX_EVENT_RECORDS, MAX_EVENT_RECORDS)).not.toThrow();
    expect(() => validateRecordCount('events', MAX_EVENT_RECORDS + 1, MAX_EVENT_RECORDS)).toThrow(
      /record/u,
    );
  });
});
