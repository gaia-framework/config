import 'reflect-metadata';
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
if (!process.execArgv.includes('--conditions=development')) {
  assert.equal(Reflect.getMetadata('design:paramtypes', ConfigService)[0], ConfigReader);
}
