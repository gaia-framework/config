import fs from 'node:fs';
import path from 'node:path';
import { ConfigLoader } from './loader/ConfigLoader.js';
import { mergeAll } from './merge.js';
import { applyEnvOverrides } from './envOverrides.js';
import type { EnvOverrideOptions } from './envOverrides.js';
import { ConfigReader } from './reader/ConfigReader.js';
import { ConfigService } from './services/ConfigService.js';
import type { ConfigData } from './types.js';
import { readEnvironmentValue } from './utils.js';
import { ConfigError, withSafeErrors } from './errors.js';
import type { ConfigOptions } from './options.js';
import { assertAcyclicConfig } from './inputValidation.js';
import type {
  ConfigFileFormat,
  ConfigSchema,
  LoadConfigOptions,
  ResolvedLoadConfigInputs
} from './loadOptions.js';
import {
  effectiveEnvironment,
  getConfigServiceCache,
  getConfigServiceCacheKey
} from './services/configServiceCache.js';

export type { ConfigFileFormat, ConfigSchema, LoadConfigOptions } from './loadOptions.js';
export { resetConfigServiceCacheForTests } from './services/configServiceCache.js';

function loadIfExists(filePath: string, options: LoadConfigOptions): ConfigData {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return new ConfigLoader({
      ...(options.env ? { env: options.env } : {}),
      inheritProcessEnv: options.inheritProcessEnv ?? true,
      safeErrors: options.safeErrors ?? false
    }).loadConfigFile(filePath);
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load config file ${filePath}: ${message}`, { cause: error });
  }
}

function formatSchemaError(error: unknown): string {
  const issues =
    (error as { issues?: Array<{ path?: Array<string | number>; message: string }> })?.issues ?? [];

  return issues.map((issue) => `${issue.path?.join('.') || '<root>'}: ${issue.message}`).join('\n');
}

function validateConfig<TConfig>(
  raw: unknown,
  schema?: ConfigSchema<TConfig>,
  safeErrors = false
): TConfig | unknown {
  return withSafeErrors(safeErrors, 'CONFIG_VALIDATION_FAILED', () =>
    validateWithSchema(raw, schema)
  );
}

function validateWithSchema<TConfig>(
  raw: unknown,
  schema?: ConfigSchema<TConfig>
): TConfig | unknown {
  if (!schema) {
    return raw;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${formatSchemaError(result.error)}`);
  }

  return result.data;
}

function listConfigFiles(
  basePath: string,
  envName: string,
  fileBaseName: string,
  fileFormat: ConfigFileFormat
): string[] {
  return [
    path.resolve(basePath, `${fileBaseName}.${fileFormat}`),
    path.resolve(basePath, `${fileBaseName}.${envName}.${fileFormat}`),
    path.resolve(basePath, `${fileBaseName}.local.${fileFormat}`),
    path.resolve(basePath, `${fileBaseName}.${envName}.local.${fileFormat}`)
  ];
}

function getConfigFlags(basePath: string, argv: string[], strict: boolean): string[] {
  const configFiles: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--config') {
      continue;
    }

    const argument = argv[i + 1];

    if (strict && (!argument || argument.startsWith('--'))) {
      throw new Error('--config requires a file path.');
    }

    if (!argument) {
      continue;
    }

    const filename = path.resolve(basePath, argument);

    if (strict && !fs.existsSync(filename)) {
      throw new Error(`Explicit config file not found: ${filename}`);
    }

    configFiles.push(filename);
    i += 1;
  }

  return configFiles;
}

function resolveLoadConfigInputs(options: LoadConfigOptions = {}): ResolvedLoadConfigInputs {
  const configDirEnvVar = options.configDirEnvVar ?? 'CONFIG_DIR';
  const envNameEnvVar = options.envNameEnvVar ?? 'CONFIG_ENV';
  const env = effectiveEnvironment(options);
  const configuredDirectory = options.basePath
    ? undefined
    : readEnvironmentValue(env, configDirEnvVar);
  const basePath = options.basePath
    ? path.resolve(options.basePath)
    : configuredDirectory
      ? path.resolve(configuredDirectory)
      : process.cwd();
  const envName = (
    options.envName ??
    readEnvironmentValue(env, envNameEnvVar) ??
    readEnvironmentValue(env, 'NODE_ENV') ??
    'development'
  ).trim();
  const argv = options.argv ?? process.argv.slice(2);
  const fileBaseName = options.fileBaseName ?? 'config';
  const configuredFormat = options.fileFormat;
  const fileFormat = configuredFormat === undefined ? 'yaml' : configuredFormat;
  if (fileFormat !== 'yaml' && fileFormat !== 'toml') {
    throw new Error('fileFormat must be "yaml" or "toml".');
  }

  const configFlagFiles = getConfigFlags(basePath, argv, options.strictFiles ?? false);
  const files =
    configFlagFiles.length > 0
      ? configFlagFiles
      : listConfigFiles(basePath, envName, fileBaseName, fileFormat);
  const loadedFiles = files.filter((filePath) => fs.existsSync(filePath));

  return {
    basePath,
    envName,
    argv,
    files,
    loadedFiles,
    fileBaseName,
    fileFormat,
    configDirEnvVar,
    envNameEnvVar,
    objectEnvVar: options.envOverrideObjectVar ?? 'CONFIG',
    keyPrefix: options.envOverridePrefix ?? 'CONFIG_'
  };
}

export function createConfig<TConfig = unknown>(
  configData: unknown,
  schema?: ConfigSchema<TConfig>,
  options: ConfigOptions = {}
): ConfigReader {
  withSafeErrors(options.safeErrors, 'CONFIG_INPUT_INVALID', () =>
    assertAcyclicConfig(configData, options.immutable)
  );
  const validated = validateConfig(configData, schema, options.safeErrors);

  return new ConfigReader(validated as Record<string, unknown>, options);
}

export function createConfigService<TConfig = unknown>(
  configOrReader: ConfigReader | unknown,
  schema?: ConfigSchema<TConfig>,
  options: ConfigOptions = {}
): ConfigService {
  if (configOrReader instanceof ConfigReader) {
    const reader =
      Object.keys(options).length > 0 ? configOrReader.withOptions(options) : configOrReader;

    return new ConfigService(reader);
  }

  const reader = createConfig(configOrReader, schema, options);

  return new ConfigService(reader);
}

export function loadConfigLayersFromFiles<TConfig = unknown>(
  options: LoadConfigOptions<TConfig> = {}
): ConfigData {
  return withSafeErrors(options.safeErrors, 'CONFIG_LOAD_FAILED', () => loadLayers(options));
}

function loadLayers(options: LoadConfigOptions): ConfigData {
  const { loadedFiles, configDirEnvVar, envNameEnvVar, objectEnvVar, keyPrefix } =
    resolveLoadConfigInputs(options);
  const loaded = loadedFiles.map((filePath) => loadIfExists(filePath, options));
  const overrideOptions: EnvOverrideOptions = {
    objectEnvVar,
    keyPrefix,
    excludedEnvVars: [configDirEnvVar, envNameEnvVar, objectEnvVar, 'NODE_ENV']
  };
  overrideOptions.env = effectiveEnvironment(options);
  const merged = applyEnvOverrides(mergeAll(loaded), overrideOptions);

  return merged;
}

export function loadConfigObjectFromFiles<TConfig = unknown>(
  options: LoadConfigOptions<TConfig> = {}
): TConfig {
  return validateConfig(
    loadConfigLayersFromFiles(options),
    options.schema,
    options.safeErrors
  ) as TConfig;
}

export function createConfigFromFiles<TConfig = unknown>(
  options: LoadConfigOptions<TConfig> = {}
): ConfigReader {
  return createConfig(loadConfigObjectFromFiles(options), undefined, options);
}

export function createConfigServiceFromFiles<TConfig = unknown>(
  options: LoadConfigOptions<TConfig> = {}
): ConfigService {
  return withSafeErrors(options.safeErrors, 'CONFIG_LOAD_FAILED', () => loadService(options));
}

function loadService(options: LoadConfigOptions): ConfigService {
  if (options.cache === false) {
    return createConfigService(loadConfigObjectFromFiles(options), undefined, options);
  }

  const resolvedInputs = resolveLoadConfigInputs(options);
  const cacheKey = getConfigServiceCacheKey(resolvedInputs, options);
  const cache = getConfigServiceCache(options.schema);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const service = createConfigService(loadConfigObjectFromFiles(options), undefined, options);
  cache.set(cacheKey, service);

  return service;
}
