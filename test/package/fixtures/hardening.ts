import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ConfigReader, ConfigLoader, loadConfigLayersFromFiles } from '@gaia-framework/config';
assert.equal(new ConfigReader({}).has('constructor'), false);
assert.equal(new ConfigReader({}).getOptional('toString'), undefined);
writeFileSync(
  'config.yaml',
  '{"__proto__":{"value":"explicit"},"constructor":{"prototype":{"value":1}}}'
);
const options = {
  basePath: process.cwd(),
  argv: [],
  env: { CONFIG_constructor_prototype_other: '2' }
};
const data = loadConfigLayersFromFiles(options);
assert.equal(Object.getPrototypeOf(data), Object.prototype);
assert.equal(Object.hasOwn(data, '__proto__'), true);
assert.equal(new ConfigReader(data).getString('__proto__.value'), 'explicit');
assert.deepEqual(new ConfigReader(data).get('constructor.prototype'), { value: 1, other: 2 });
assert.equal(Object.hasOwn(Object.prototype, 'other'), false);
writeFileSync('config.yaml', 'value: \u0024{PACKED_FLAG:-false}');
try {
  loadConfigLayersFromFiles({ ...options, env: { PACKED_FLAG: 'SYNTHETIC_PRIVATE_VALUE' } });
  assert.fail('Invalid boolean must fail');
} catch (error) {
  assert.ok(error instanceof Error);
  assert.match(error.message, /PACKED_FLAG.*must be/);
  for (
    let current: unknown = error;
    current;
    current = current instanceof Error ? current.cause : undefined
  ) {
    assert.equal(String(current).includes('SYNTHETIC_PRIVATE_VALUE'), false);
  }
}

writeFileSync('config.yaml', 'root: &root [*root]');
assert.throws(
  () => new ConfigLoader().loadYamlConfig('config.yaml'),
  /Config value cycle detected:/
);
writeFileSync('config.yaml', 'first: &shared {value: text}\nsecond: *shared');
assert.deepEqual(new ConfigLoader().loadYamlConfig('config.yaml'), {
  first: { value: 'text' },
  second: { value: 'text' }
});

const protectedKey = 'syntheticInheritedKey';
assert.equal(Object.hasOwn(Object.prototype, protectedKey), false);
writeFileSync('fragment.yml', `${protectedKey}: included`);
writeFileSync('config.yaml', `${protectedKey}: root\nnested: {$include: ./fragment.yml}`);
let setterCalls = 0;
Object.defineProperty(Object.prototype, protectedKey, {
  configurable: true,
  set() {
    setterCalls++;
    throw new Error('Inherited setter must not run');
  }
});

try {
  const protectedData = new ConfigLoader().loadYamlConfig('config.yaml');
  assert.deepEqual(protectedData, {
    [protectedKey]: 'root',
    nested: { [protectedKey]: 'included' }
  });
  assert.equal(Object.getPrototypeOf(protectedData), Object.prototype);
  assert.equal(Object.getPrototypeOf(protectedData.nested), Object.prototype);
  assert.deepEqual(
    loadConfigLayersFromFiles({
      basePath: process.cwd(),
      argv: [],
      env: { [`CONFIG_${protectedKey}`]: 'overridden' },
      inheritProcessEnv: false
    }),
    { [protectedKey]: 'overridden', nested: { [protectedKey]: 'included' } }
  );
  assert.equal(setterCalls, 0);
} finally {
  Reflect.deleteProperty(Object.prototype, protectedKey);
}

for (const key of Object.keys(process.env)) {
  if (/^CONFIG/i.test(key)) {
    delete process.env[key];
  }
}

process.env.CONFIG_DIR = process.cwd();
writeFileSync('config.yaml', 'value: text');
const controlled = loadConfigLayersFromFiles({
  basePath: process.cwd(),
  argv: [],
  configDirEnvVar: 'config_dir'
});
assert.deepEqual(
  controlled,
  process.platform === 'win32' ? { value: 'text' } : { value: 'text', DIR: process.cwd() }
);
