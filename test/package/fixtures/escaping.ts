import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  ConfigLoader,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles
} from '@gaia-framework/config';
for (const key of Object.keys(process.env)) {
  if (/^CONFIG/i.test(key)) {
    delete process.env[key];
  }
}

process.env.CONFIG_DIR = process.cwd();
writeFileSync('config.yaml', 'value: text');
const options = {
  basePath: process.cwd(),
  envName: 'test',
  argv: [],
  configDirEnvVar: 'config_dir'
};
const env = { ...process.env };
const service = createConfigServiceFromFiles(options);
const mapService = createConfigServiceFromFiles({ ...options, env });
assert.notEqual(service, mapService);
assert.equal(service.getOptionalString('DIR'), loadConfigLayersFromFiles(options).DIR);
assert.equal(mapService.getString('DIR'), process.cwd());
assert.equal(createConfigServiceFromFiles({ ...options, env: process.env }), service);
assert.equal(createConfigServiceFromFiles({ ...options, env: { ...env } }), mapService);
const strict = { ...options, schema: z.strictObject({ value: z.string() }) };
assert.throws(() => loadConfigObjectFromFiles({ ...strict, env }), /Invalid configuration/);
if (process.platform === 'win32') {
  createConfigServiceFromFiles(strict);
} else {
  assert.throws(() => createConfigServiceFromFiles(strict), /Invalid configuration/);
}

assert.throws(() => createConfigServiceFromFiles({ ...strict, env }), /Invalid configuration/);
const marker = '__GAIA_ESC_OPEN__{literal}';
const placeholder = '$' + '{VALUE}';
writeFileSync(
  'config.yaml',
  JSON.stringify({
    plain: marker,
    pure: placeholder,
    mixed: 'prefix ' + placeholder,
    escaped: '$$' + '{MISSING}'
  })
);
assert.deepEqual(new ConfigLoader({ env: { VALUE: marker } }).loadYamlConfig('config.yaml'), {
  plain: marker,
  pure: marker,
  mixed: 'prefix ' + marker,
  escaped: '$' + '{MISSING}'
});
