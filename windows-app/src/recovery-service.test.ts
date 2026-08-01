import { describe, expect, it } from 'vitest';

import { parseRecoverySnapshot } from './recovery-service.js';

describe('recovery service contract', () => {
  it('validates the resume state and unfinished request count', () => {
    const parsed = parseRecoverySnapshot({
      campaign: {
        id: 'campaign-recovery',
        state: 'RECOVERY_REQUIRED',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:01:00.000Z',
      },
      resumeState: 'TAVERN',
      unfinishedRequestCount: 2,
    });
    expect(parsed.resumeState).toBe('TAVERN');
    expect(parsed.unfinishedRequestCount).toBe(2);
    expect(() => parseRecoverySnapshot({ ...parsed, resumeState: 'ARCHIVED' })).toThrow(
      'resume state',
    );
  });
});
