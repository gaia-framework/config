/**
 * Provides read-only, type-safe access to configuration values.
 * Supports nested key access using dot notation, type coercion, and optional value retrieval.
 */
export type ConfigPath = string | readonly string[];

export interface Config {
  /**
   * Checks if the given configuration key exists and is not null.
   * @param key - The configuration key.
   * @returns True if the key exists and is not null, false otherwise.
   */
  has(key: ConfigPath): boolean;

  /**
   * Returns all configuration keys, including nested keys, in dot notation.
   * @returns An array of all configuration keys.
   */
  keys(): string[];

  /** Literal segment paths in key-index order; arrays are leaves. Returns defensive copies. */
  keyPaths(): string[][];

  /**
   * Retrieves the value for the given key, or throws if not found or null.
   * @param key - The configuration key.
   * @returns The configuration value.
   * @throws Error if the key is missing or null.
   */
  get<T = unknown>(key: ConfigPath): T;

  /**
   * Retrieves the value for the given key, or undefined if not found or null.
   * @param key - The configuration key.
   * @returns The configuration value or undefined.
   */
  getOptional<T = unknown>(key: ConfigPath): T | undefined;

  /**
   * Retrieves a string value for the given key.
   * @param key - The configuration key.
   * @returns The string value.
   * @throws Error if the value is not a string.
   */
  getString(key: ConfigPath): string;

  /**
   * Retrieves an optional string value for the given key.
   * @param key - The configuration key.
   * @returns The string value or undefined.
   */
  getOptionalString(key: ConfigPath): string | undefined;

  /**
   * Retrieves a number value for the given key.
   * @param key - The configuration key.
   * @returns The number value.
   * @throws Error if the value cannot be coerced to a number.
   */
  getNumber(key: ConfigPath): number;

  /**
   * Retrieves an optional number value for the given key.
   * @param key - The configuration key.
   * @returns The number value or undefined.
   */
  getOptionalNumber(key: ConfigPath): number | undefined;

  /**
   * Retrieves a boolean value for the given key.
   * @param key - The configuration key.
   * @returns The boolean value.
   * @throws Error if the value cannot be coerced to a boolean.
   */
  getBoolean(key: ConfigPath): boolean;

  /**
   * Retrieves an optional boolean value for the given key.
   * @param key - The configuration key.
   * @returns The boolean value or undefined.
   */
  getOptionalBoolean(key: ConfigPath): boolean | undefined;

  /**
   * Retrieves an array of strings for the given key.
   * @param key - The configuration key.
   * @returns The string array.
   * @throws Error if the value is not a string array.
   */
  getStringArray(key: ConfigPath): string[];

  /**
   * Retrieves an optional array of strings for the given key.
   * @param key - The configuration key.
   * @returns The string array or undefined.
   */
  getOptionalStringArray(key: ConfigPath): string[] | undefined;
}
