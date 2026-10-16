const messages = {
  CONFIG_LOAD_FAILED: 'Unable to load configuration.',
  CONFIG_FILE_LOAD_FAILED: 'Unable to load configuration file.',
  CONFIG_VALIDATION_FAILED: 'Invalid configuration.',
  CONFIG_INPUT_INVALID: 'Invalid configuration input.',
  CONFIG_PATH_INVALID: 'Invalid configuration path.',
  CONFIG_KEY_MISSING: 'Missing configuration key.',
  CONFIG_VALUE_INVALID: 'Invalid configuration value.'
} as const;

export type ConfigErrorCode = keyof typeof messages;

/** Safe diagnostics deliberately retain neither the original message nor its cause. */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode) {
    super(messages[code]);
    this.name = 'ConfigError';
    this.code = code;
  }
}

export function withSafeErrors<T>(
  enabled: boolean | undefined,
  code: ConfigErrorCode,
  action: () => T
): T {
  try {
    return action();
  } catch (error) {
    if (!enabled || error instanceof ConfigError) {
      throw error;
    }

    throw new ConfigError(code);
  }
}
