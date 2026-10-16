import { injectable } from 'inversify';
import { ConfigReader } from '../reader/ConfigReader.js';
import type { ConfigPath } from '../reader/types.js';
import type { ConfigValue } from '../reader/ConfigReader.js';

@injectable()
export class ConfigService {
  constructor(private readonly config: ConfigReader) {}

  has(key: ConfigPath): boolean {
    return this.config.has(key);
  }

  keys(): string[] {
    return this.config.keys();
  }

  keyPaths(): string[][] {
    return this.config.keyPaths();
  }

  get<T = ConfigValue>(key: ConfigPath): T {
    return this.config.get<T>(key);
  }

  getOptional<T = ConfigValue>(key: ConfigPath): T | undefined {
    return this.config.getOptional<T>(key);
  }

  getString(key: ConfigPath): string {
    return this.config.getString(key);
  }

  getOptionalString(key: ConfigPath): string | undefined {
    return this.config.getOptionalString(key);
  }

  getNumber(key: ConfigPath): number {
    return this.config.getNumber(key);
  }

  getOptionalNumber(key: ConfigPath): number | undefined {
    return this.config.getOptionalNumber(key);
  }

  getBoolean(key: ConfigPath): boolean {
    return this.config.getBoolean(key);
  }

  getOptionalBoolean(key: ConfigPath): boolean | undefined {
    return this.config.getOptionalBoolean(key);
  }

  getStringArray(key: ConfigPath): string[] {
    return this.config.getStringArray(key);
  }

  getOptionalStringArray(key: ConfigPath): string[] | undefined {
    return this.config.getOptionalStringArray(key);
  }
}
