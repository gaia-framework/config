import { createHash } from 'node:crypto';
import type { ConfigService } from './ConfigService.js';
import type { LoadConfigOptions, ResolvedLoadConfigInputs } from '../loadOptions.js';
import { readEnvironmentValue } from '../utils.js';

const configServiceCache = new Map<string, ConfigService>();
let schemaServiceCaches = new WeakMap<object, Map<string, ConfigService>>();

export function resetConfigServiceCacheForTests(): void {
  if (
    readEnvironmentValue(process.env, 'NODE_ENV') !== 'test' &&
    readEnvironmentValue(process.env, 'GAIA_ENV') !== 'test' &&
    readEnvironmentValue(process.env, 'CONFIG_ENV') !== 'test'
  ) {
    throw new Error('The configuration cache may only be reset in a test environment.');
  }

  configServiceCache.clear();
  schemaServiceCaches = new WeakMap();
}

function definedEnvironmentEntries(
  env: NodeJS.ProcessEnv,
  includeNonEnumerable = false
): Array<[string, string]> {
  const names = includeNonEnumerable ? Object.getOwnPropertyNames(env) : Object.keys(env);

  return names
    .map((name): [string, string | undefined] => [name, readEnvironmentValue(env, name)])
    .filter((entry): entry is [string, string] => entry[1] !== undefined);
}

export function effectiveEnvironment(options: LoadConfigOptions): NodeJS.ProcessEnv {
  return options.env ?? (options.inheritProcessEnv === false ? {} : process.env);
}

function getEnvironmentFingerprint(env: NodeJS.ProcessEnv, inheritProcessEnv: boolean): string {
  const overrides = definedEnvironmentEntries(env);
  const lookupEntries = definedEnvironmentEntries(env, true);
  const processEntries = inheritProcessEnv ? definedEnvironmentEntries(process.env, true) : [];
  const placeholders = Object.entries(
    Object.fromEntries([...processEntries, ...lookupEntries])
  ).sort(([left], [right]) => left.localeCompare(right));
  // A map's exact-case entry cannot mask differently cased Windows process lookups.
  const processFallback =
    inheritProcessEnv && process.platform === 'win32' && env !== process.env
      ? processEntries.sort(([left], [right]) => left.localeCompare(right))
      : undefined;

  // Preserve override enumeration order for conflicting paths; keep values out of cache keys.
  return createHash('sha256')
    .update(JSON.stringify({ overrides, placeholders, processFallback }))
    .digest('hex');
}

export function getConfigServiceCache(schema?: object): Map<string, ConfigService> {
  if (!schema) {
    return configServiceCache;
  }

  let cache = schemaServiceCaches.get(schema);
  if (!cache) {
    cache = new Map();
    schemaServiceCaches.set(schema, cache);
  }

  return cache;
}

export function getConfigServiceCacheKey(
  inputs: ResolvedLoadConfigInputs,
  options: LoadConfigOptions
): string {
  const env = effectiveEnvironment(options);

  return JSON.stringify({
    basePath: inputs.basePath,
    envName: inputs.envName,
    loadedFiles: inputs.loadedFiles,
    argv: inputs.argv,
    fileBaseName: inputs.fileBaseName,
    fileFormat: inputs.fileFormat,
    configDirEnvVar: inputs.configDirEnvVar,
    envNameEnvVar: inputs.envNameEnvVar,
    objectEnvVar: inputs.objectEnvVar,
    keyPrefix: inputs.keyPrefix,
    environmentSource: env === process.env ? 'process' : 'map',
    environment: getEnvironmentFingerprint(env, options.inheritProcessEnv ?? true),
    inheritProcessEnv: options.inheritProcessEnv ?? true,
    strictFiles: options.strictFiles ?? false,
    strictGetters: options.strictGetters ?? false,
    strictPaths: options.strictPaths ?? false,
    safeErrors: options.safeErrors ?? false,
    immutable: options.immutable ?? false
  });
}
