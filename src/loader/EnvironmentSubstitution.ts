import { Buffer } from 'node:buffer';
import { readEnvironmentValue } from '../utils.js';
import type { ConfigLoaderOptions } from '../options.js';

interface ParsedEnvironmentExpression {
  name: string;
  fallback: string | undefined;
  booleanFallback: boolean | undefined;
}

const expressionCacheLimit = 256;
const expressionCacheMaxLength = 1024;

/** Placeholder and directive environment reads share the original lookup rules. */
export class EnvironmentSubstitution {
  private expressionCache: Map<string, ParsedEnvironmentExpression> | undefined;

  constructor(private options?: ConfigLoaderOptions) {}

  read(name: string): string | undefined {
    const supplied = readEnvironmentValue(this.options?.env, name);

    if (supplied !== undefined || this.options?.inheritProcessEnv === false) {
      return supplied;
    }

    return readEnvironmentValue(process.env, name);
  }

  /*
   * Normalizes fallback values like "" or '' => empty string
   */
  private normalizeFallback(fallback: string): string {
    const unescaped = fallback.replaceAll('$${', '${');
    const t = unescaped.trim();

    // explicit empty fallback: ${VAR:-}
    if (t === '') {
      return '';
    }

    // common operator habit: ${VAR:-""} or ${VAR:-''}
    if (t === '""' || t === "''") {
      return '';
    }

    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      try {
        const parsed = JSON.parse(t);

        return typeof parsed === 'string' ? parsed : String(parsed);
      } catch {
        return t.slice(1, -1);
      }
    }

    // For single quotes, strip outer quotes
    if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
      return t.slice(1, -1);
    }

    return unescaped;
  }

  /**
   * Strict boolean parsing:
   * - accepts ONLY true/false (case-insensitive)
   */
  private parseBooleanStrict(raw: string): boolean | undefined {
    const s = raw.trim().toLowerCase();
    if (s === 'true') {
      return true;
    }

    if (s === 'false') {
      return false;
    }

    return undefined;
  }

  /**
   * Parse an expression like:
   *   VAR
   *   VAR:-fallback
   */
  private parseEnvExpr(exprRaw: string): ParsedEnvironmentExpression {
    const cacheable = exprRaw.length <= expressionCacheMaxLength;
    const cached = cacheable ? this.expressionCache?.get(exprRaw) : undefined;

    if (cached) {
      return cached;
    }

    const shouldCache = cacheable && (this.expressionCache?.size ?? 0) < expressionCacheLimit;

    // Detach admitted substrings so a small cache entry cannot retain a large source string.
    const cacheKey = shouldCache ? Buffer.from(exprRaw, 'utf16le').toString('utf16le') : exprRaw;

    const expr = String(cacheKey).trim();
    const idx = expr.indexOf(':-');
    const name = (idx >= 0 ? expr.slice(0, idx) : expr).trim();
    const fallbackRaw = idx >= 0 ? expr.slice(idx + 2) : undefined;
    const fallback = fallbackRaw !== undefined ? this.normalizeFallback(fallbackRaw) : undefined;
    const parsed = {
      name,
      fallback,
      booleanFallback: fallback !== undefined ? this.parseBooleanStrict(fallback) : undefined
    };

    if (shouldCache) {
      this.expressionCache ??= new Map();
      this.expressionCache.set(cacheKey, parsed);
    }

    return parsed;
  }

  /**
   * String substitution:
   * - ${VAR} required
   * - ${VAR:-default} fallback if missing/empty
   * - $${VAR} escapes to literal ${VAR}
   *
   * NOTE: This always returns a string. We keep it for "mixed" strings.
   */
  substitute(input: string): string {
    if (!input.includes('${')) {
      return input;
    }

    // Consume escaped openings and placeholders in one pass; returned values are never rescanned.
    return input.replace(/\$\$\{|\$\{([^}]+)\}/g, (_m, exprRaw: string | undefined) => {
      if (exprRaw === undefined) {
        return '${';
      }

      const { name, fallback } = this.parseEnvExpr(exprRaw);

      const envVal = this.read(name);
      const missingOrEmpty = envVal === undefined || envVal === '';

      if (missingOrEmpty) {
        if (fallback !== undefined) {
          return fallback;
        }

        throw new Error(`Environment variable "${name}" is referenced in config but not set.`);
      }

      return envVal;
    });
  }

  /**
   * Resolve a configuration scalar string.
   *
   * Behavior:
   * - If the entire value is exactly ONE placeholder: ${VAR} or ${VAR:-fallback}
   * - And the fallback is boolean-like (true/false), then coerce env/fallback to boolean.
   *
   * This prevents accidentally converting string fields like passwords that happen to be "true".
   */
  resolveScalar(input: string): any {
    if (!input.includes('${')) {
      return input;
    }

    // Detect a "pure" placeholder scalar: entire string is exactly ${...}
    const m = input.match(/^\s*\$\{([^}]+)\}\s*$/);
    if (!m) {
      // Mixed string or plain string => normal substitution, returns string
      return this.substitute(input);
    }

    const { name, fallback, booleanFallback } = this.parseEnvExpr(m[1]!);

    const envVal = this.read(name);
    const missingOrEmpty = envVal === undefined || envVal === '';

    // Only boolean-typed if fallback exists AND is literally true/false.
    const expectsBoolean = booleanFallback !== undefined;

    if (missingOrEmpty) {
      if (fallback === undefined) {
        throw new Error(`Environment variable "${name}" is referenced in config but not set.`);
      }

      if (expectsBoolean) {
        // fallback is boolean-like => return actual boolean
        return booleanFallback;
      }

      // fallback is not boolean => return string fallback
      return fallback;
    }

    // env var is set
    if (expectsBoolean) {
      const b = this.parseBooleanStrict(envVal);
      if (b === undefined) {
        throw new Error(
          `Environment variable "${name}" must be "true" or "false" because the config fallback is boolean (${fallback}).`
        );
      }

      return b;
    }

    // Not boolean-typed => keep as string
    return envVal;
  }
}
