import { z } from 'zod';
import {
  ConfigError,
  ConfigLoader,
  type ConfigFileFormat,
  createConfigService,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles,
  type Config,
  type ConfigPath,
  type ConfigOptions,
  type ConfigLoaderOptions,
  type ConfigReaderOptions,
  type ConfigErrorCode,
  type LoadConfigOptions,
  type ConfigValue,
  type ConfigSchema,
  type ConfigObject,
  type ConfigData
} from '@gaia-framework/config';

// @ts-expect-error The former raw-data type name is no longer exported.
import type { BackendConfigYaml } from '@gaia-framework/config';

const format: ConfigFileFormat = 'toml';
const options: LoadConfigOptions = {
  fileFormat: format,
  argv: [],
  env: {},
  inheritProcessEnv: false,
  strictFiles: true,
  strictGetters: true,
  strictPaths: true,
  safeErrors: true,
  immutable: true,
  cache: false
};
const readerOptions: ConfigReaderOptions = { strictGetters: true, immutable: true };
const configOptions: ConfigOptions = readerOptions;
const loaderOptions: ConfigLoaderOptions = { inheritProcessEnv: false, safeErrors: true };
const key: ConfigPath = ['port'] as const;
const value: Config = createConfigService({ port: 1 }, undefined, configOptions);
const number: number = value.getNumber(key);
const paths: string[][] = value.keyPaths();
const object: ConfigObject = { number };
const scalar: ConfigValue = object;
const raw: ConfigData = {};
const removedType: BackendConfigYaml | undefined = undefined;
const layeredRaw: ConfigData = loadConfigLayersFromFiles(options);
const code: ConfigErrorCode = new ConfigError('CONFIG_LOAD_FAILED').code;
loadConfigObjectFromFiles(options);
const transformedSchema = z
  .object({ port: z.coerce.number().default(4001) })
  .transform((value) => ({ ...value, enabled: true }));
const schema: ConfigSchema<{ port: number; enabled: boolean }> = transformedSchema;
const transformed = loadConfigObjectFromFiles({ ...options, schema: transformedSchema });
const port: number = transformed.port;
const enabled: boolean = transformed.enabled;
// @ts-expect-error Schema transformations preserve their output types.
const invalidPort: string = transformed.port;
const asynchronousSchema: ConfigSchema = {
  // @ts-expect-error Configuration validation must return a synchronous result.
  safeParse: async () => ({ success: true as const, data: {} })
};
void [
  scalar,
  raw,
  removedType,
  layeredRaw,
  loaderOptions,
  code,
  paths,
  schema,
  port,
  enabled,
  invalidPort,
  asynchronousSchema
];

const tomlLoader = new ConfigLoader();
const tomlData: ConfigData = tomlLoader.loadTomlConfig('missing.toml');
const yamlData: ConfigData = tomlLoader.loadYamlConfig('missing.yaml');
const selectedData: ConfigData = tomlLoader.loadConfigFile('missing.toml');
void [tomlData, yamlData, selectedData];
// @ts-expect-error Only supported discovery formats are accepted.
const unsupportedFormat: ConfigFileFormat = 'xml';
void unsupportedFormat;
