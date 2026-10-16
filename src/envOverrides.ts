import { mergeConfig } from './merge.js';
import { isObject, readEnvironmentValue, setOwnProperty } from './utils.js';

function parseEnvValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Path encoding after the configured prefix (CONFIG_ by default):
 * - "_"  => "."
 * - "__" => literal "_"
 * - "___" => literal "-"  (so worker-local becomes worker___local)
 *
 * Example:
 *   CONFIG_http_port=4001
 *   CONFIG_database_postgres_ssl_rejectUnauthorized=false
 */
function decodeSuffixToPath(suffix: string): string {
  const DASH = '\u0000';
  const UND = '\u0001';

  return suffix
    .replace(/___/g, DASH)
    .replace(/__/g, UND)
    .replace(/_/g, '.')
    .replaceAll(DASH, '-')
    .replaceAll(UND, '_');
}

function setAtPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.').filter(Boolean);
  if (!parts.length) {
    return;
  }

  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!;
    const last = i === parts.length - 1;

    if (last) {
      setOwnProperty(cur, key, value);

      return;
    }

    if (!Object.hasOwn(cur, key) || !isObject(cur[key])) {
      setOwnProperty(cur, key, {});
    }

    cur = cur[key] as Record<string, unknown>;
  }
}

export function readConfigObjectEnv(
  varName = 'CONFIG',
  env: NodeJS.ProcessEnv = process.env
): Record<string, unknown> | undefined {
  const raw = readEnvironmentValue(env, varName);
  if (!raw) {
    return undefined;
  }

  try {
    const obj = JSON.parse(raw);
    if (!isObject(obj)) {
      throw new Error(`${varName} must be a JSON object`);
    }

    return obj as Record<string, unknown>;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${varName} must be valid JSON object: ${message}`, { cause: error });
  }
}

export function readConfigKeyOverrides(
  prefix = 'CONFIG_',
  env: NodeJS.ProcessEnv = process.env,
  excludedEnvVars: readonly string[] = []
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Only the Windows process environment has case-insensitive lookup semantics.
  const normalizeName =
    process.platform === 'win32' && env === process.env
      ? (name: string) => name.toUpperCase()
      : (name: string) => name;
  const excludedNames = new Set(excludedEnvVars.map(normalizeName));

  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith(prefix) || excludedNames.has(normalizeName(k))) {
      continue;
    }

    if (v === undefined) {
      continue;
    }

    const suffix = k.slice(prefix.length);
    if (!suffix) {
      continue;
    }

    const path = decodeSuffixToPath(suffix);
    setAtPath(out, path, parseEnvValue(v));
  }

  return out;
}

export interface EnvOverrideOptions {
  objectEnvVar?: string;
  keyPrefix?: string;
  env?: NodeJS.ProcessEnv;
  excludedEnvVars?: readonly string[];
}

export function applyEnvOverrides<TConfig>(
  config: TConfig,
  options: EnvOverrideOptions | NodeJS.ProcessEnv = {}
): TConfig {
  const looksLikeProcessEnv =
    !('objectEnvVar' in options) &&
    !('keyPrefix' in options) &&
    !('env' in options) &&
    !('excludedEnvVars' in options);
  const env = looksLikeProcessEnv
    ? (options as NodeJS.ProcessEnv)
    : ((options as EnvOverrideOptions).env ?? process.env);
  const objectEnvVar = looksLikeProcessEnv
    ? 'CONFIG'
    : ((options as EnvOverrideOptions).objectEnvVar ?? 'CONFIG');
  const keyPrefix = looksLikeProcessEnv
    ? 'CONFIG_'
    : ((options as EnvOverrideOptions).keyPrefix ?? 'CONFIG_');

  const obj = readConfigObjectEnv(objectEnvVar, env);
  const excludedEnvVars = looksLikeProcessEnv
    ? []
    : ((options as EnvOverrideOptions).excludedEnvVars ?? []);
  const keyOverrides = readConfigKeyOverrides(keyPrefix, env, excludedEnvVars);

  let out = config;
  if (obj) {
    out = mergeConfig(out, obj) as TConfig;
  }

  out = mergeConfig(out, keyOverrides) as TConfig;

  return out;
}
