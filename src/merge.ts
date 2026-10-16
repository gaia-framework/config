import { isObject, setOwnProperty } from './utils.js';

/**
 * Merge semantics:
 * - objects deep merge
 * - arrays replace
 * - primitives replace
 * - null clears (explicit "no value")
 * - undefined does not override
 */
export function mergeConfig(base: any, over: any): any {
  if (over === undefined) {
    return base;
  }

  if (over === null) {
    return null;
  }

  if (Array.isArray(over)) {
    return over;
  }

  if (!isObject(over)) {
    return over;
  }

  const out: Record<string, any> = isObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) {
      continue;
    }

    const previous = Object.hasOwn(out, k) ? out[k] : undefined;
    const merged = mergeConfig(previous, v);
    if (k in out) {
      setOwnProperty(out, k, merged);
    } else {
      // The fresh output has no own or inherited property to intercept this write.
      out[k] = merged;
    }
  }

  return out;
}

export function mergeAll(configs: any[]): any {
  return configs.reduce((acc, c) => mergeConfig(acc, c), {});
}
