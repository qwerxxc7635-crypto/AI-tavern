import type { JsonValue } from '@ember-tavern/contracts';

export async function sha256CanonicalJson(value: JsonValue): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(canonicalText(value));
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const normalized = new Map<string, JsonValue>();
  for (const [key, entry] of Object.entries(value)) {
    const canonicalKey = canonicalText(key);
    if (normalized.has(canonicalKey)) {
      throw new TypeError('Canonical JSON object contains Unicode-equivalent keys');
    }
    normalized.set(canonicalKey, entry);
  }
  return `{${[...normalized]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function canonicalText(value: string): string {
  return value.normalize('NFC').replaceAll(/\r\n?/g, '\n');
}
