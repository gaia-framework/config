import type { ConfigOptions } from './options.js';

export type ConfigFileFormat = 'yaml' | 'toml';

/** The synchronous validation surface used by the loader, independent of Zod internals. */
export interface ConfigSchema<TConfig = unknown> {
  safeParse(input: unknown): { success: true; data: TConfig } | { success: false; error: unknown };
}

export interface LoadConfigOptions<TConfig = unknown> extends ConfigOptions {
  basePath?: string;
  envName?: string;
  argv?: string[];
  configDirEnvVar?: string;
  envNameEnvVar?: string;
  fileBaseName?: string;
  fileFormat?: ConfigFileFormat;
  schema?: ConfigSchema<TConfig>;
  env?: NodeJS.ProcessEnv;
  envOverrideObjectVar?: string;
  envOverridePrefix?: string;
  strictFiles?: boolean;
  inheritProcessEnv?: boolean;
  cache?: boolean;
}

export interface ResolvedLoadConfigInputs {
  basePath: string;
  envName: string;
  argv: string[];
  files: string[];
  loadedFiles: string[];
  fileBaseName: string;
  fileFormat: ConfigFileFormat;
  configDirEnvVar: string;
  envNameEnvVar: string;
  objectEnvVar: string;
  keyPrefix: string;
}
