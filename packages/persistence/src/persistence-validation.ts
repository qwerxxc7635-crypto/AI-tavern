import { PersistenceDataError } from './campaign-repository.js';

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PersistenceDataError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new PersistenceDataError(`${label} must be text`);
  }
  return value;
}

export function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

export function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PersistenceDataError(`${label} must be a finite number`);
  }
  return value;
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new PersistenceDataError(`${label} must be boolean`);
  }
  return value;
}

export function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new PersistenceDataError(`${label} must be an array`);
  }
  return value;
}

export function requireStringArray(value: unknown, label: string): readonly string[] {
  return Object.freeze(
    requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`)),
  );
}

export function parseJson(value: unknown, label: string): unknown {
  const text = requireString(value, label);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new PersistenceDataError(`${label} contains invalid JSON`, { cause: error });
  }
}

export function requireEnum<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
  label: string,
): Values[number] {
  const text = requireString(value, label);
  if (!(values as readonly string[]).includes(text)) {
    throw new PersistenceDataError(`${label} has unknown value: ${text}`);
  }
  return text as Values[number];
}
