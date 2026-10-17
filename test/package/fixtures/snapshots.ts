import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { Container } from 'inversify';
import { z } from 'zod';
import {
  ConfigError,
  ConfigLoader,
  ConfigReader,
  ConfigService,
  createConfig,
  createConfigService,
  createConfigServiceFromFiles
} from '@gaia-framework/config';

const input = { 'literal.name': { value: 'original' }, list: ['one'] };
const reader = createConfig(input, undefined, { immutable: true });
input['literal.name'].value = 'changed';
assert.equal(reader.getString(['literal.name', 'value']), 'original');
assert.equal(Object.isFrozen(input.list), false);
assert.throws(() => reader.getStringArray('list').push('two'), TypeError);
const paths = reader.keyPaths();
assert.deepEqual(paths, [['literal.name'], ['literal.name', 'value'], ['list']]);
paths[0]!.push('corrupt');
assert.deepEqual(createConfigService(reader).keyPaths(), [
  ['literal.name'],
  ['literal.name', 'value'],
  ['list']
]);
assert.throws(
  () => createConfig({ value: new Date() }, undefined, { immutable: true, safeErrors: true }),
  ConfigError
);
assert.equal(
  Object.isFrozen(
    createConfig(
      'text',
      z.string().transform((value) => ({ value })),
      { immutable: true }
    ).get('')
  ),
  true
);

writeFileSync('config.yaml', 'value: {name: first}');
const options = { argv: [], env: {}, inheritProcessEnv: false };
const mutable = createConfigServiceFromFiles(options);
const immutable = createConfigServiceFromFiles({ ...options, immutable: true });
assert.notEqual(immutable, mutable);
assert.equal(createConfigServiceFromFiles({ ...options, immutable: true }), immutable);
assert.equal(Object.isFrozen(immutable.get('value')), true);
assert.equal(Object.isFrozen(mutable.get('value')), false);
const beforeMutation = mutable.keyPaths();
mutable.get<Record<string, unknown>>('value').extra = 'caller mutation';

assert.deepEqual(mutable.keyPaths(), beforeMutation);
beforeMutation[0]!.push('corrupted');
assert.deepEqual(mutable.keyPaths(), [['value'], ['value', 'name']]);

const container = new Container();
container.bind(ConfigReader).toConstantValue(reader);
container
  .bind(ConfigService)
  .toDynamicValue((context) => new ConfigService(context.get(ConfigReader)));
assert.deepEqual(container.get(ConfigService).keyPaths(), reader.keyPaths());

const directory = mkdtempSync(path.resolve('snapshot-alias-'));

try {
  const filename = path.join(directory, 'ordinary ünicode.yaml');
  writeFileSync(filename, 'value: synthetic');
  const expected = new ConfigLoader().loadYamlConfig(filename);
  const native = fs.realpathSync.native;

  try {
    fs.realpathSync.native = () => {
      throw new Error('synthetic native failure');
    };

    assert.deepEqual(new ConfigLoader().loadYamlConfig(filename), expected);
  } finally {
    fs.realpathSync.native = native;
  }

  writeFileSync(path.join(directory, 'cycle.yaml'), 'next: {$include: ./alias/cycle.yaml}');
  symlinkSync(
    directory,
    path.join(directory, 'alias'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(
    () => new ConfigLoader().loadYamlConfig(path.join(directory, 'cycle.yaml')),
    /\$include cycle detected:/
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
