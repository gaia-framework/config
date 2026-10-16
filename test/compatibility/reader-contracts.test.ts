import { expect } from 'chai';
import { ConfigReader, type ConfigPath } from '../../src/index.js';

describe('Reader contracts across options and cached lookups', () => {
  const data = JSON.parse(
    '{"text":"value","number":"42","yes":"yes","true":"true","false":false,"nil":null,"list":["one","two"],"mixed":[1,"two"],"nested":{"value":3},"a.b":"literal","":{"child":7},"__proto__":{"own":8}}'
  );
  type Method =
    | 'get'
    | 'getOptional'
    | 'has'
    | 'getString'
    | 'getOptionalString'
    | 'getNumber'
    | 'getOptionalNumber'
    | 'getBoolean'
    | 'getOptionalBoolean'
    | 'getStringArray'
    | 'getOptionalStringArray';
  const successes: Array<[Method, ConfigPath, unknown]> = [
    ['get', '', data],
    ['get', 'nested.value', 3],
    ['get', ['a.b'], 'literal'],
    ['get', ['', 'child'], 7],
    ['get', ['__proto__', 'own'], 8],
    ['getOptional', 'nil', undefined],
    ['getOptional', 'missing', undefined],
    ['getOptional', 'text.child', undefined],
    ['getOptional', 'nil.child', undefined],
    ['has', 'nil', false],
    ['has', 'missing', false],
    ['has', 'false', true],
    ['has', 'constructor', false],
    ['getOptional', 'toString', undefined],
    ['getString', 'text', 'value'],
    ['getString', 'list.0', 'one'],
    ['getOptionalString', 'number', '42'],
    ['getOptionalString', 'false', undefined],
    ['getNumber', 'number', 42],
    ['getOptionalNumber', 'number', 42],
    ['getOptionalNumber', 'text', undefined],
    ['getBoolean', 'true', true],
    ['getBoolean', 'false', false],
    ['getOptionalBoolean', 'text', undefined],
    ['getStringArray', 'list', ['one', 'two']],
    ['getOptionalStringArray', 'list', ['one', 'two']],
    ['getOptionalStringArray', 'mixed', undefined],
    ['getOptionalStringArray', 'nil', undefined]
  ];

  for (const immutable of [false, true]) {
    for (const strict of [false, true]) {
      for (const safeErrors of [false, true]) {
        it(`preserves required/optional access with immutable=${immutable}, strict=${strict}, safeErrors=${safeErrors}`, () => {
          const reader = new ConfigReader(data, {
            immutable,
            strictGetters: strict,
            strictPaths: strict,
            safeErrors
          });
          for (let iteration = 0; iteration < 2; iteration++) {
            for (const [method, key, expected] of successes) {
              if (strict && (key === '' || (Array.isArray(key) && key.includes('')))) {
                expect(() => reader[method](key)).throw(
                  safeErrors ? 'Invalid configuration path.' : 'non-empty segments'
                );
                continue;
              }

              expect(reader[method](key), `${method}:${JSON.stringify(key)}`).deep.equal(expected);
            }

            for (const method of [
              'get',
              'getString',
              'getNumber',
              'getBoolean',
              'getStringArray'
            ] as const) {
              for (const key of ['nil', 'missing', 'a.b', 'list.99']) {
                expect(() => reader[method](key)).throw(
                  safeErrors ? 'Missing configuration key.' : 'Missing config key:'
                );
              }
            }

            for (const method of [
              'getString',
              'getNumber',
              'getBoolean',
              'getStringArray'
            ] as const) {
              expect(() => reader[method]('nested')).throw(
                safeErrors ? 'Invalid configuration value.' : 'must be'
              );
            }

            if (strict) {
              expect(() => reader.get('list.01')).throw(
                safeErrors ? 'Invalid configuration path.' : 'canonical'
              );
              expect(() => reader.getBoolean('yes')).throw(
                safeErrors ? 'Invalid configuration value.' : 'must be a boolean'
              );
              expect(reader.getOptionalNumber('false')).equal(undefined);
            } else {
              expect(reader.get('list.01')).equal('two');
              expect(reader.getBoolean('yes')).equal(true);
              expect(reader.getOptionalNumber('false')).equal(0);
            }
          }

          expect(reader.keys()).deep.equal([
            'text',
            'number',
            'yes',
            'true',
            'false',
            'nil',
            'list',
            'mixed',
            'nested',
            'nested.value',
            'a.b',
            '',
            'child',
            '__proto__',
            '__proto__.own'
          ]);
          expect(reader.keyPaths()).deep.equal([
            ['text'],
            ['number'],
            ['yes'],
            ['true'],
            ['false'],
            ['nil'],
            ['list'],
            ['mixed'],
            ['nested'],
            ['nested', 'value'],
            ['a.b'],
            [''],
            ['', 'child'],
            ['__proto__'],
            ['__proto__', 'own']
          ]);
          expect(reader.withOptions({ strictPaths: false }).get('list.01')).equal('two');
          expect(reader.keyPaths()).not.equal(reader.keyPaths());
        });
      }
    }
  }
});
