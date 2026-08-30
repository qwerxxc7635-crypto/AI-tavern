const DEFAULT_MAX_STREAM_CHARACTERS = 256_000;

export class StructuredJsonStreamProjector {
  private source = '';
  private emitted = '';

  public constructor(
    private readonly field: string,
    private readonly maxCharacters = DEFAULT_MAX_STREAM_CHARACTERS,
  ) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field) || maxCharacters < 1) {
      throw new StructuredJsonStreamError('STREAM_PROJECTION_CONFIG_INVALID');
    }
  }

  public push(chunk: string): string {
    if (chunk.length === 0) return '';
    if (this.source.length + chunk.length > this.maxCharacters) {
      throw new StructuredJsonStreamError('STREAM_PROJECTION_LIMIT_EXCEEDED');
    }
    this.source += chunk;
    const projected = projectStringPrefix(this.source, this.field);
    if (!projected.startsWith(this.emitted)) {
      throw new StructuredJsonStreamError('STREAM_PROJECTION_NON_MONOTONIC');
    }
    const delta = projected.slice(this.emitted.length);
    this.emitted = projected;
    return delta;
  }

  public finish(finalContent: string): string {
    if (finalContent !== this.source) {
      throw new StructuredJsonStreamError('STREAM_FINAL_MISMATCH');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(finalContent);
    } catch (error) {
      throw new StructuredJsonStreamError('STREAM_FINAL_INVALID', { cause: error });
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>)[this.field] !== 'string'
    ) {
      throw new StructuredJsonStreamError('STREAM_FIELD_INVALID');
    }
    const value = (parsed as Record<string, string>)[this.field] ?? '';
    if (!value.startsWith(this.emitted)) {
      throw new StructuredJsonStreamError('STREAM_FINAL_MISMATCH');
    }
    const delta = value.slice(this.emitted.length);
    this.emitted = value;
    return delta;
  }

  public value(): string {
    return this.emitted;
  }
}

export class StructuredJsonStreamError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(`Structured JSON stream projection failed: ${code}`, options);
    this.name = 'StructuredJsonStreamError';
  }
}

function projectStringPrefix(source: string, field: string): string {
  const valueStart = findTopLevelStringValue(source, field);
  if (valueStart === null) return '';
  const raw = scanRawStringPrefix(source, valueStart);
  const safe = safeJsonStringPrefix(raw);
  if (safe.length === 0) return '';
  try {
    return JSON.parse(`"${safe}"`) as string;
  } catch {
    return '';
  }
}

function findTopLevelStringValue(source: string, field: string): number | null {
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{' || character === '[') {
      depth += 1;
      continue;
    }
    if (character === '}' || character === ']') {
      depth -= 1;
      continue;
    }
    if (character !== '"') continue;
    const token = completeJsonString(source, index);
    if (token === null) return null;
    if (depth === 1) {
      let cursor = skipWhitespace(source, token.end + 1);
      if (source[cursor] === ':') {
        cursor = skipWhitespace(source, cursor + 1);
        if (token.value === field && source[cursor] === '"') return cursor + 1;
      }
    }
    index = token.end;
  }
  return null;
}

function completeJsonString(
  source: string,
  start: number,
): { readonly end: number; readonly value: string } | null {
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character !== '"') continue;
    try {
      return { end: index, value: JSON.parse(source.slice(start, index + 1)) as string };
    } catch {
      return null;
    }
  }
  return null;
}

function scanRawStringPrefix(source: string, start: number): string {
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') return source.slice(start, index);
  }
  return source.slice(start);
}

function safeJsonStringPrefix(raw: string): string {
  let safeEnd = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character !== '\\') {
      const code = raw.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = raw.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) break;
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        break;
      }
      safeEnd = index + 1;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === undefined) break;
    if (escaped === 'u') {
      const hex = raw.slice(index + 2, index + 6);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) break;
      const code = Number.parseInt(hex, 16);
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = raw.slice(index + 6, index + 12);
        if (!/^\\u[dD][c-fC-F][0-9A-Fa-f]{2}$/.test(low)) break;
        index += 11;
      } else {
        index += 5;
      }
      safeEnd = index + 1;
      continue;
    }
    if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped)) break;
    index += 1;
    safeEnd = index + 1;
  }
  return raw.slice(0, safeEnd);
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? '')) index += 1;
  return index;
}
