const SECRET_FIELD_FRAGMENTS = ['apikey', 'accesstoken', 'secretkey', 'credentialref'] as const;
const SECRET_FIELD_NAMES = new Set(['authorization', 'bearer', 'cookie', 'password', 'token']);

const SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bcredential:v1:[0-9a-f]{8}-[0-9a-f-]{27,}\b/iu,
  /\bsk-(?:or-v1-|ant-api\d{2}-)?[a-z0-9_-]{8,}\b/iu,
  /\bAIza[0-9a-z_-]{20,}\b/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[0-9a-z]{20,}\b/iu,
  /\bxox[baprs]-[0-9a-z-]{12,}\b/iu,
  /\beyJ[0-9a-z_-]{8,}\.[0-9a-z_-]{8,}\.[0-9a-z_-]{8,}\b/iu,
  /\b(?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+[0-9a-z._~+/-]{8,}={0,2}/iu,
  /\bbearer\s+[0-9a-z._~+/-]{12,}={0,2}/iu,
  /\b(?:api[_ -]?key|access[_ -]?token|secret[_ -]?key|password|cookie)\s*[:=]\s*[0-9a-z._~+/-]{8,}={0,2}/iu,
  /\bTOP_SECRET_[0-9A-Z_]{8,}\b/u,
]);

const REDACTION_PATTERNS: readonly RegExp[] = Object.freeze(
  SECRET_PATTERNS.map(
    (pattern) => new RegExp(pattern.source, `${pattern.flags.replace('u', '')}gu`),
  ),
);

export interface SecretDetection {
  readonly kind: 'FIELD_NAME' | 'FIELD_VALUE' | 'PLAIN_TEXT';
  readonly path: string;
}

export function findSecretInText(text: string, path: string): SecretDetection | null {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
    ? Object.freeze({ kind: 'PLAIN_TEXT', path })
    : null;
}

export function findSecretInJson(value: unknown, rootPath: string): SecretDetection | null {
  const pending: Array<{ value: unknown; path: string }> = [{ value, path: rootPath }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (typeof current.value === 'string') {
      if (findSecretInText(current.value, current.path) !== null) {
        return Object.freeze({ kind: 'FIELD_VALUE', path: current.path });
      }
    } else if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) =>
        pending.push({ value: entry, path: `${current.path}[${index}]` }),
      );
    } else if (current.value !== null && typeof current.value === 'object') {
      for (const [key, entry] of Object.entries(current.value)) {
        const normalized = key.replaceAll(/[_-]/g, '').toLowerCase();
        if (
          SECRET_FIELD_NAMES.has(normalized) ||
          SECRET_FIELD_FRAGMENTS.some((fragment) => normalized.includes(fragment))
        ) {
          return Object.freeze({ kind: 'FIELD_NAME', path: `${current.path}.${key}` });
        }
        pending.push({ value: entry, path: `${current.path}.${key}` });
      }
    }
  }
  return null;
}

export function redactSecretsForDiagnostics(text: string): string {
  return REDACTION_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, '[REDACTED]'),
    text,
  );
}
