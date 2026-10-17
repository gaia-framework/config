import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import 'reflect-metadata';
import { Container } from 'inversify';
import {
  ConfigError,
  ConfigLoader,
  ConfigReader,
  ConfigService,
  createConfig,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles
} from '@gaia-framework/config';

process.env.OPTION_PACKAGE_VALUE = 'process';
writeFileSync(
  'config.yaml',
  'value: ${OPTION_PACKAGE_VALUE:-isolated}\nport: "4002"\n"literal.name": text'
);
const options = {
  argv: ['--config', 'config.yaml'],
  env: {},
  inheritProcessEnv: false,
  strictFiles: true,
  strictPaths: true,
  strictGetters: true,
  safeErrors: true
};
const first = createConfigServiceFromFiles(options);
{
  const container = new Container();
  container
    .bind(ConfigReader)
    .toConstantValue(new ConfigReader({ value: 'yes' }, { strictGetters: true }));
  container
    .bind(ConfigService)
    .toDynamicValue((context) => new ConfigService(context.get(ConfigReader)));
  assert.equal(container.get(ConfigService).getOptionalBoolean('value'), undefined);
}

assert.equal(first.getString('value'), 'isolated');
assert.equal(first.getString(['literal.name']), 'text');
assert.equal(first.getNumber('port'), 4002);
assert.throws(
  () => first.get('.value'),
  (error) => error instanceof ConfigError && error.code === 'CONFIG_PATH_INVALID'
);
assert.equal(createConfigServiceFromFiles(options), first);
writeFileSync('config.yaml', 'value: changed');
assert.equal(
  createConfigServiceFromFiles({ ...options, cache: false }).getString('value'),
  'changed'
);
assert.equal(first.getString('value'), 'isolated');
assert.throws(
  () => loadConfigLayersFromFiles({ ...options, argv: ['--config', 'missing.yaml'] }),
  ConfigError
);
assert.throws(() => createConfig([], undefined, options), ConfigError);
const cycle: { self?: unknown } = {};
cycle.self = [cycle];
assert.throws(() => createConfig(cycle), /cycle detected/);
assert.equal(
  createConfig(
    '42',
    z.string().transform((value) => ({ port: Number(value) }))
  ).getNumber('port'),
  42
);
assert.deepEqual(new ConfigLoader({ inheritProcessEnv: false }).loadYamlConfig('config.yaml'), {
  value: 'changed'
});

const paths = new ConfigReader({ key: 'segment', '["key"]': 'literal' });
for (let repeat = 0; repeat < 3; repeat++) {
  assert.equal(paths.getString('["key"]'), 'literal');
  assert.equal(paths.getString(['key']), 'segment');
}

let throwAccessor = false;
const accessorFailure = new Error('synthetic package accessor failure');
const retries = new ConfigReader({
  get value() {
    if (throwAccessor) {
      throw accessorFailure;
    }

    return 'recovered';
  }
});
throwAccessor = true;
assert.throws(
  () => retries.get('value'),
  (error) => error === accessorFailure
);
throwAccessor = false;
assert.equal(retries.getString('value'), 'recovered');
