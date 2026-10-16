import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import {
  createConfig,
  createConfigService,
  createConfigFromFiles,
  createConfigServiceFromFiles,
  loadConfigObjectFromFiles
} from '@gaia-framework/config';

const require = createRequire(import.meta.url);
const zodRoot = path.dirname(require.resolve('zod/package.json'));

assert.equal(JSON.parse(readFileSync(path.join(zodRoot, 'package.json'), 'utf8')).version, '4.6.6');

const libraryRequire = createRequire(require.resolve('@gaia-framework/config'));

assert.equal(
  libraryRequire.resolve('zod/package.json'),
  require.resolve('zod/package.json'),
  'Schema validation uses the consumer-owned Zod installation.'
);

const schema = z
  .object({ port: z.coerce.number().default(4001) })
  .transform((value) => ({ ...value, enabled: true }));

assert.equal(createConfig({ port: '4100' }, schema).getNumber('port'), 4100);
assert.equal(createConfigService({}, schema).getBoolean('enabled'), true);
assert.equal(createConfig({}, schema).getNumber('port'), 4001);

const directory = mkdtempSync(path.join(tmpdir(), 'config-consumer-zod-'));

try {
  writeFileSync(path.join(directory, 'config.yaml'), 'port: "4200"\n');

  const options = { basePath: directory, argv: [], env: {}, inheritProcessEnv: false, schema };

  assert.deepEqual(loadConfigObjectFromFiles(options), { port: 4200, enabled: true });
  assert.equal(createConfigFromFiles(options).getNumber('port'), 4200);
  assert.equal(createConfigServiceFromFiles(options).getNumber('port'), 4200);
  assert.equal(createConfigServiceFromFiles(options), createConfigServiceFromFiles(options));

  const failing = z.object({ port: z.literal(7) });

  assert.throws(() => createConfig({ port: 8 }, failing), /Invalid configuration/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
