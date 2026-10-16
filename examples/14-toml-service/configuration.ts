import { options as yamlOptions } from '../11-service/configuration.ts';

export { schema } from '../11-service/configuration.ts';

export function options(basePath: string) {
  return { ...yamlOptions(basePath), fileFormat: 'toml' as const };
}
