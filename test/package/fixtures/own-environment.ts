import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ConfigLoader, loadConfigLayersFromFiles } from '@gaia-framework/config';
for (const name of ['constructor', 'toString', '__proto__']) {
  delete process.env[name];
  const placeholder = '$' + '{' + name + ':-fallback}';
  writeFileSync(
    'config.yaml',
    JSON.stringify({ value: placeholder, mixed: 'prefix ' + placeholder })
  );
  for (const loader of [new ConfigLoader(), new ConfigLoader({ env: {} })]) {
    assert.deepEqual(loader.loadYamlConfig('config.yaml'), {
      value: 'fallback',
      mixed: 'prefix fallback'
    });
  }

  writeFileSync('config.yaml', JSON.stringify({ value: { $env: name } }));
  assert.throws(() => new ConfigLoader({ env: {} }).loadYamlConfig('config.yaml'), /not set/);
  assert.deepEqual(new ConfigLoader({ env: { [name]: 'own' } }).loadYamlConfig('config.yaml'), {
    value: 'own'
  });
  process.env[name] = 'process';
  assert.deepEqual(new ConfigLoader({ env: {} }).loadYamlConfig('config.yaml'), {
    value: 'process'
  });
  assert.throws(
    () => new ConfigLoader({ env: { [name]: '' } }).loadYamlConfig('config.yaml'),
    /not set/
  );
  delete process.env[name];
}

writeFileSync('config.yaml', 'value: text');
assert.deepEqual(
  loadConfigLayersFromFiles({
    basePath: process.cwd(),
    argv: [],
    env: {},
    envNameEnvVar: 'constructor',
    envOverrideObjectVar: 'toString'
  }),
  { value: 'text' }
);
process.env.OWN_PACKAGE_CASE = 'process';
writeFileSync('config.yaml', JSON.stringify({ value: '$' + '{own_package_case:-fallback}' }));
assert.equal(
  new ConfigLoader().loadYamlConfig('config.yaml').value,
  process.platform === 'win32' ? 'process' : 'fallback'
);
assert.equal(
  new ConfigLoader({ env: { own_package_case: 'own' } }).loadYamlConfig('config.yaml').value,
  'own'
);
