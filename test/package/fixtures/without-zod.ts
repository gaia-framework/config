import 'reflect-metadata';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Container } from 'inversify';
import {
  ConfigLoader,
  ConfigReader,
  ConfigService,
  createConfig,
  createConfigService,
  createConfigFromFiles,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles,
  type ConfigSchema
} from '@gaia-framework/config';

const require = createRequire(import.meta.url);
const libraryRequire = createRequire(require.resolve('@gaia-framework/config'));

for (const resolveFrom of [require, libraryRequire]) {
  assert.throws(() => resolveFrom.resolve('zod'), { code: 'MODULE_NOT_FOUND' });
}

const schema: ConfigSchema<{ port: number }> = {
  safeParse(input) {
    const port =
      input !== null && typeof input === 'object' && 'port' in input ? input.port : undefined;

    if (typeof port !== 'string') {
      return { success: false, error: { issues: [{ path: ['port'], message: 'Expected text' }] } };
    }

    return { success: true, data: { port: Number(port) } };
  }
};

assert.equal(createConfig({ port: '4100' }).getString('port'), '4100');
assert.equal(createConfig({ port: '4100' }, schema).getNumber('port'), 4100);
assert.equal(createConfigService({ port: '4100' }, schema).getNumber('port'), 4100);
assert.throws(() => createConfig({ port: false }, schema), /port: Expected text/);
assert.throws(() => createConfig(null, schema), /port: Expected text/);

writeFileSync('without-zod.yaml', 'port: "4200"\n');

const options = {
  argv: ['--config', 'without-zod.yaml'],
  env: {},
  inheritProcessEnv: false,
  schema
};
const validated: { port: number } = loadConfigObjectFromFiles(options);

assert.deepEqual(new ConfigLoader().loadConfigFile('without-zod.yaml'), { port: '4200' });
assert.deepEqual(loadConfigLayersFromFiles(options), { port: '4200' });
assert.deepEqual(validated, { port: 4200 });
assert.equal(createConfigFromFiles(options).getNumber('port'), 4200);

const service = createConfigServiceFromFiles(options);

assert.equal(service.getNumber('port'), 4200);
assert.equal(createConfigServiceFromFiles(options), service);

const container = new Container();

container.bind(ConfigReader).toConstantValue(createConfig(validated));
container
  .bind(ConfigService)
  .toDynamicValue((context) => new ConfigService(context.get(ConfigReader)));
assert.equal(container.get(ConfigService).getNumber('port'), 4200);
