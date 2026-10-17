import 'reflect-metadata';
import { Container } from 'inversify';
import { z } from 'zod';
import {
  ConfigReader,
  ConfigService,
  createConfigFromFiles,
  loadConfigLayersFromFiles
} from '@gaia-framework/config';

const options = {
  fileFormat: 'toml' as const,
  envName: 'production',
  argv: process.argv.slice(2),
  inheritProcessEnv: false,
  env: {
    EXAMPLE_NAME: 'synthetic',
    EXAMPLE_TOKEN: 'synthetic-not-a-credential',
    CONFIG: '{"port":6400}',
    CONFIG_port: '6500'
  },
  schema: z.object({
    port: z.coerce.number(),
    enabled: z.boolean(),
    label: z.string(),
    clear: z.string().nullable(),
    text: z.string(),
    destination: z.object({ name: z.string() }),
    defaulted: z.string().default('schema-default')
  })
};

const raw = loadConfigLayersFromFiles(options);
const reader = createConfigFromFiles(options);
const container = new Container();
container.bind(ConfigReader).toConstantValue(reader);
container
  .bind(ConfigService)
  .toDynamicValue((context) => new ConfigService(context.get(ConfigReader)));
const service = container.get(ConfigService);

console.log(
  JSON.stringify({
    port: service.getNumber('port'),
    enabled: service.getBoolean('enabled'),
    clear: raw.clear ?? null,
    label: service.getString('label'),
    text: service.getString('text').trim(),
    destination: service.getString('destination.name'),
    defaulted: service.getString('defaulted')
  })
);
