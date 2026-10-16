import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  ConfigLoader,
  createConfigServiceFromFiles,
  loadConfigObjectFromFiles
} from '@gaia-framework/config';
const env: NodeJS.ProcessEnv = Object.defineProperty({}, 'SWEEP_HIDDEN', {
  value: 'first',
  writable: true,
  configurable: true
});
writeFileSync('config.yaml', 'value: $' + '{SWEEP_HIDDEN:-fallback}');
const options = { basePath: process.cwd(), argv: [], env };
const first = createConfigServiceFromFiles(options);
env.SWEEP_HIDDEN = 'second';
const second = createConfigServiceFromFiles(options);
assert.notEqual(second, first);
assert.equal(second.getString('value'), 'second');
const strict = { ...options, schema: z.object({ value: z.literal('second') }) };
createConfigServiceFromFiles(strict);
env.SWEEP_HIDDEN = 'invalid';
assert.throws(() => createConfigServiceFromFiles(strict), /Invalid configuration/);
delete process.env.sweep_case_value;
process.env.SWEEP_CASE_VALUE = 'first';
writeFileSync('case.yaml', 'value: $' + '{sweep_case_value:-fallback}');
const cased = {
  basePath: process.cwd(),
  argv: ['--config', 'case.yaml'],
  env: { SWEEP_CASE_VALUE: 'map' }
};
createConfigServiceFromFiles(cased);
process.env.SWEEP_CASE_VALUE = 'second';
assert.equal(
  createConfigServiceFromFiles(cased).getString('value'),
  process.platform === 'win32' ? 'second' : 'fallback'
);
assert.equal(
  createConfigServiceFromFiles(cased).getString('value'),
  loadConfigObjectFromFiles<{ value: string }>(cased).value
);
for (const content of ['# comment\n', '---\n', '--- # comment\n...\n']) {
  writeFileSync('empty.yaml', content);
  assert.deepEqual(new ConfigLoader().loadYamlConfig('empty.yaml'), {});
  writeFileSync('include.yaml', 'value: {$include: ./empty.yaml}');
  assert.equal(new ConfigLoader().loadYamlConfig('include.yaml').value, undefined);
}

writeFileSync('scalar.yaml', '""');
assert.throws(
  () => new ConfigLoader().loadYamlConfig('scalar.yaml'),
  /Config root must be an object/
);
