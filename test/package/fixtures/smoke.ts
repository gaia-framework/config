import assert from 'node:assert/strict';
import {
  createConfigService,
  ConfigService,
  ConfigReader,
  ConfigLoader
} from '@gaia-framework/config';
assert.equal(createConfigService({ port: 4001 }).getNumber('port'), 4001);
assert.equal(typeof ConfigService, 'function');
assert.equal(typeof ConfigLoader, 'function');
assert.equal(new ConfigService(new ConfigReader({ port: 4001 })).getNumber('port'), 4001);
