import { options as yamlOptions } from '../12-pipelines/configuration.ts';

export { schema } from '../12-pipelines/configuration.ts';

export function options(basePath: string) {
  return { ...yamlOptions(basePath), fileFormat: 'toml' as const };
}
