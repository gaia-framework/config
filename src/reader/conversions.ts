export function strictNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return undefined;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function booleanValue(value: unknown, strict: boolean): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const text = strict ? value.trim() : value;
  const truth = strict ? /^true$/i : /^(true|1|yes|on)$/i;
  const falsehood = strict ? /^false$/i : /^(false|0|no|off)$/i;

  if (truth.test(text)) {
    return true;
  }

  if (falsehood.test(text)) {
    return false;
  }

  return undefined;
}

export function isStringArray(value: unknown, strict: boolean): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }

  if (!strict) {
    return value.every((item) => typeof item === 'string');
  }

  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index) || typeof value[index] !== 'string') {
      return false;
    }
  }

  return true;
}
