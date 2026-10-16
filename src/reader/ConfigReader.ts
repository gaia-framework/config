import type { Config, ConfigPath } from './types.js';
import type { ConfigReaderOptions } from '../options.js';
import { ConfigError, withSafeErrors } from '../errors.js';
import type { ConfigErrorCode } from '../errors.js';
import { assertConfigObject } from '../inputValidation.js';
import { booleanValue, isStringArray, strictNumber } from './conversions.js';
import { pathLabel, pathParts } from './paths.js';
import { createImmutableSnapshot } from './immutableSnapshot.js';
import { ConfigKeyIndex } from './ConfigKeyIndex.js';

export type ConfigValue = string | number | boolean | null | ConfigObject | ConfigValue[];

export interface ConfigObject {
  [key: string]: ConfigValue;
}

const MISSING = Symbol('MISSING');

export class ConfigReader implements Config {
  private readonly stringValues = new Map<string, any>();
  private readonly segmentValues = new Map<string, any>();
  private readonly keyIndex: ConfigKeyIndex;
  private readonly data: Record<string, any>;
  private readonly options: Readonly<ConfigReaderOptions>;

  constructor(data: Record<string, any>, options: ConfigReaderOptions = {}) {
    this.options = Object.freeze({
      strictGetters: options.strictGetters ?? false,
      strictPaths: options.strictPaths ?? false,
      safeErrors: options.safeErrors ?? false,
      immutable: options.immutable ?? false
    });
    this.data = withSafeErrors(options.safeErrors, 'CONFIG_INPUT_INVALID', () => {
      const selected = options.immutable ? createImmutableSnapshot(data) : data;
      assertConfigObject(selected, options.immutable);

      return selected;
    });
    this.keyIndex = withSafeErrors(
      options.safeErrors,
      'CONFIG_INPUT_INVALID',
      () => new ConfigKeyIndex(this.data)
    );
  }

  withOptions(options: ConfigReaderOptions): ConfigReader {
    return new ConfigReader(this.data, { ...this.options, ...options });
  }

  private fail(code: ConfigErrorCode, message: string): never {
    if (this.options.safeErrors) {
      throw new ConfigError(code);
    }

    throw new Error(message);
  }

  private resolve(key: ConfigPath): ConfigValue | undefined {
    return withSafeErrors(this.options.safeErrors, 'CONFIG_VALUE_INVALID', () => {
      if (typeof key === 'string') {
        return this.resolveCached(this.stringValues, key, key);
      }

      const parts = this.parsePath(key);

      return this.resolveCached(this.segmentValues, JSON.stringify(parts), key, parts);
    });
  }

  private parsePath(key: ConfigPath): string[] {
    return withSafeErrors(this.options.safeErrors, 'CONFIG_PATH_INVALID', () => {
      return pathParts(key, this.options.strictPaths ?? false);
    });
  }

  private resolveCached(
    cache: Map<string, any>,
    cacheKey: string,
    key: ConfigPath,
    preparedParts?: readonly string[]
  ): ConfigValue | undefined {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached === MISSING ? undefined : cached;
    }

    let current: any = this.data;
    for (const part of preparedParts ?? this.parsePath(key)) {
      current = this.resolvePart(current, part);
      if (current === undefined) {
        cache.set(cacheKey, MISSING);

        return undefined;
      }
    }

    cache.set(cacheKey, current);

    return current as ConfigValue;
  }

  private resolvePart(current: any, part: string): any {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }

    if (!Array.isArray(current)) {
      return Object.hasOwn(current, part) ? current[part] : undefined;
    }

    if (this.options.strictPaths && !/^(0|[1-9]\d*)$/.test(part)) {
      this.fail(
        'CONFIG_PATH_INVALID',
        'Array path segments must be canonical non-negative integers.'
      );
    }

    const index = Number(part);

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= current.length ||
      !Object.hasOwn(current, index)
    ) {
      return undefined;
    }

    return current[index];
  }

  has(key: ConfigPath): boolean {
    const value = this.resolve(key);

    return value !== undefined && value !== null;
  }

  keys(): string[] {
    return this.keyIndex.keys();
  }

  keyPaths(): string[][] {
    return this.keyIndex.keyPaths();
  }

  get<T = ConfigValue>(key: ConfigPath): T {
    const value = this.resolve(key);

    if (value === undefined || value === null) {
      this.fail('CONFIG_KEY_MISSING', `Missing config key: ${pathLabel(key)}`);
    }

    return value as T;
  }

  getOptional<T = ConfigValue>(key: ConfigPath): T | undefined {
    const value = this.resolve(key);

    return value === null ? undefined : (value as T | undefined);
  }

  getString(key: ConfigPath): string {
    const value = this.get(key);

    if (typeof value !== 'string') {
      this.fail('CONFIG_VALUE_INVALID', `Config key '${pathLabel(key)}' must be a string`);
    }

    return value;
  }

  getOptionalString(key: ConfigPath): string | undefined {
    const value = this.getOptional(key);

    return typeof value === 'string' ? value : undefined;
  }

  private numberValue(value: unknown): number | undefined {
    return withSafeErrors(this.options.safeErrors, 'CONFIG_VALUE_INVALID', () => {
      if (this.options.strictGetters) {
        return strictNumber(value);
      }

      const parsed = typeof value === 'number' ? value : Number(value);

      return Number.isNaN(parsed) && typeof value !== 'number' ? undefined : parsed;
    });
  }

  getNumber(key: ConfigPath): number {
    const value = this.numberValue(this.get(key));

    if (value === undefined) {
      this.fail('CONFIG_VALUE_INVALID', `Config key '${pathLabel(key)}' must be a number`);
    }

    return value;
  }

  getOptionalNumber(key: ConfigPath): number | undefined {
    const value = this.getOptional(key);

    if (value === undefined) {
      return undefined;
    }

    const parsed = this.numberValue(value);

    return Number.isNaN(parsed) ? undefined : parsed;
  }

  getBoolean(key: ConfigPath): boolean {
    const value = booleanValue(this.get(key), this.options.strictGetters ?? false);

    if (value === undefined) {
      this.fail('CONFIG_VALUE_INVALID', `Config key '${pathLabel(key)}' must be a boolean`);
    }

    return value;
  }

  getOptionalBoolean(key: ConfigPath): boolean | undefined {
    if (this.getOptional(key) === undefined) {
      return undefined;
    }

    try {
      return this.getBoolean(key);
    } catch {
      return undefined;
    }
  }

  private stringArrayValue(value: unknown): string[] | undefined {
    return withSafeErrors(this.options.safeErrors, 'CONFIG_VALUE_INVALID', () => {
      return isStringArray(value, this.options.strictGetters ?? false) ? value : undefined;
    });
  }

  getStringArray(key: ConfigPath): string[] {
    const value = this.stringArrayValue(this.get(key));

    if (value === undefined) {
      this.fail('CONFIG_VALUE_INVALID', `Config key '${pathLabel(key)}' must be a string[]`);
    }

    return value;
  }

  getOptionalStringArray(key: ConfigPath): string[] | undefined {
    return this.stringArrayValue(this.getOptional(key));
  }
}
