import type { ConfigPath } from './types.js';

export function pathLabel(path: ConfigPath): string {
  return typeof path === 'string' ? path : JSON.stringify(path);
}

export function pathParts(path: ConfigPath, strict: boolean): string[] {
  if (typeof path !== 'string' && !Array.isArray(path)) {
    throw new Error('Config path must be a string or an array of string segments.');
  }

  const parts = typeof path === 'string' ? path.split('.') : [...path];

  for (const part of parts) {
    if (typeof part !== 'string') {
      throw new Error('Config path segments must be strings.');
    }
  }

  if (strict && (parts.length === 0 || parts.some((part) => part.length === 0))) {
    throw new Error('Config path must contain non-empty segments.');
  }

  return typeof path === 'string' && !strict ? parts.filter(Boolean) : parts;
}
