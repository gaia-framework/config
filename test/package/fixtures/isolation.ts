import assert from 'node:assert/strict';
import { z } from 'zod';
import { createConfigServiceFromFiles, loadConfigLayersFromFiles } from '@gaia-framework/config';
const options = {
  basePath: process.cwd(),
  argv: [],
  env: { CONFIG_DIR: process.cwd(), CONFIG_ENV: 'production' }
};
assert.deepEqual(loadConfigLayersFromFiles(options), { value: 'file' });
const first = createConfigServiceFromFiles({ ...options, env: { CONFIG_value: 'first' } });
const second = createConfigServiceFromFiles({ ...options, env: { CONFIG_value: 'second' } });
assert.notEqual(first, second);
assert.equal(second.getString('value'), 'second');
assert.throws(
  () =>
    createConfigServiceFromFiles({ ...options, env: { CONFIG_value: 'first' }, schema: z.never() }),
  /Invalid configuration/
);
assert.equal(
  createConfigServiceFromFiles({
    ...options,
    schema: z.strictObject({ value: z.string() })
  }).getString('value'),
  'file'
);
