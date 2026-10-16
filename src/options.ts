export interface ConfigReaderOptions {
  strictGetters?: boolean;
  strictPaths?: boolean;
  safeErrors?: boolean;
  immutable?: boolean;
}

export interface ConfigLoaderOptions {
  env?: NodeJS.ProcessEnv;
  inheritProcessEnv?: boolean;
  safeErrors?: boolean;
}

export type ConfigOptions = ConfigReaderOptions;
