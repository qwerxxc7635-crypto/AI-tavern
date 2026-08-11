import { describe, expect, it } from 'vitest';

import {
  findSecretInJson,
  findSecretInText,
  redactSecretsForDiagnostics,
} from './save-secret-scanner.js';

describe('portable save secret scanner', () => {
  it('finds sensitive field names and nested high-confidence values', () => {
    expect(findSecretInJson({ nested: { api_key: 'anything' } }, 'root')).toMatchObject({
      kind: 'FIELD_NAME',
    });
    expect(
      findSecretInJson({ message: 'provider returned sk-or-v1-1234567890abcdef' }, 'root'),
    ).toMatchObject({ kind: 'FIELD_VALUE' });
    expect(
      findSecretInJson({ error: ['Authorization: Bearer abcdefghijklmnop'] }, 'root'),
    ).toMatchObject({ kind: 'FIELD_VALUE' });
  });

  it('finds pure text headers, known provider keys, JWTs and explicit test secrets', () => {
    for (const value of [
      'Provider echoed Authorization: Bearer abcdefghijklmnop',
      'sk-ant-api03-abcdefghijklmnop',
      'eyJabcdefghijk.abcdefghijkl.abcdefghijkl',
      'TOP_SECRET_API_KEY_SHOULD_NOT_EXPORT',
    ]) {
      expect(findSecretInText(value, 'raw')).not.toBeNull();
    }
    expect(findSecretInText('The innkeeper keeps a secret behind the hearth.', 'story')).toBeNull();
  });

  it('redacts known secret material from diagnostic text', () => {
    const redacted = redactSecretsForDiagnostics(
      'request failed: Authorization: Bearer abcdefghijklmnop',
    );
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain('abcdefghijklmnop');
  });
});
