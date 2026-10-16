import { expect } from 'chai';
import { ConfigError, ConfigReader } from '../../../src/index.js';
import type { ConfigPath } from '../../../src/index.js';

describe('Reader result-cache compatibility', () => {
  it('keeps raw string keys separate from serialized array paths in every mode', () => {
    const data = { key: 'segment value', '["key"]': 'string value' };

    for (const immutable of [false, true]) {
      for (const strictPaths of [false, true]) {
        for (const strictGetters of [false, true]) {
          for (const safeErrors of [false, true]) {
            for (const arrayFirst of [false, true]) {
              const reader = new ConfigReader(data, {
                immutable,
                strictPaths,
                strictGetters,
                safeErrors
              });
              const queries: Array<[ConfigPath, string]> = [
                ['["key"]', 'string value'],
                [['key'], 'segment value']
              ];

              if (arrayFirst) {
                queries.reverse();
              }

              for (let repeat = 0; repeat < 3; repeat++) {
                for (const [key, expected] of queries) {
                  expect(reader.getString(key)).equal(expected);
                }
              }
            }
          }
        }
      }
    }
  });

  it('retains independent missing results and observes mutable segment arrays', () => {
    const data: Record<string, unknown> = { '["missing"]': 'literal', value: 7, other: 9 };
    const reader = new ConfigReader(data);
    const segments = ['value'];

    expect(reader.getString('["missing"]')).equal('literal');
    expect(reader.getOptional(['missing'])).equal(undefined);
    expect(reader.getOptional('missing')).equal(undefined);
    data.missing = 'later';
    expect(reader.getOptional(['missing'])).equal(undefined);
    expect(reader.getOptional('missing')).equal(undefined);
    expect(reader.getNumber(segments)).equal(7);
    segments[0] = 'other';
    expect(reader.getNumber(segments)).equal(9);
    expect(reader.getNumber('value')).equal(7);
    expect(reader.withOptions({}).getString('missing')).equal('later');
  });

  it('retries throwing accessors and caches successful results in both path forms', () => {
    for (const safeErrors of [false, true]) {
      let armed = false;
      let reads = 0;
      const failure = new Error('synthetic accessor failure');
      const reader = new ConfigReader(
        {
          get nested() {
            reads++;
            if (armed) {
              throw failure;
            }

            return { value: 'recovered' };
          }
        },
        { safeErrors }
      );
      const initialReads = reads;
      const paths: ConfigPath[] = ['nested.value', ['nested', 'value']];
      armed = true;

      for (const key of paths) {
        if (safeErrors) {
          expect(() => reader.get(key)).throw(ConfigError, 'Invalid configuration value.');
        } else {
          expect(() => reader.get(key)).throw(failure);
        }
      }

      armed = false;
      for (const key of paths) {
        expect(reader.getString(key)).equal('recovered');
      }

      armed = true;
      for (const key of paths) {
        expect(reader.getString(key)).equal('recovered');
      }

      expect(reads - initialReads).equal(4);
    }
  });

  it('retains same-path reentrant getter resolution', () => {
    let armed = false;
    let insideGetter = false;
    let reads = 0;
    const data = {
      get value(): number {
        reads++;
        if (armed && !insideGetter) {
          insideGetter = true;
          const nested = reader.getNumber('value');
          insideGetter = false;

          return nested + 1;
        }

        return 10;
      }
    };
    const reader = new ConfigReader(data);
    const initialReads = reads;
    armed = true;

    expect(reader.getNumber('value')).equal(11);
    expect(reader.getNumber('value')).equal(11);
    expect(reads - initialReads).equal(2);
  });

  it('preserves mutable paths between optional boolean getter delegations', () => {
    const segments = ['first'];
    let armed = false;
    const reader = new ConfigReader({
      get first() {
        if (armed) {
          segments[0] = 'second';
        }

        return 'yes';
      },
      second: 'no'
    });
    armed = true;

    expect(reader.getOptionalBoolean(segments)).equal(false);
    expect(segments).deep.equal(['second']);
  });

  it('preserves virtual getter delegation and repeated numeric conversions', () => {
    const calls: ConfigPath[] = [];

    class CustomReader extends ConfigReader {
      override getBoolean(key: ConfigPath): boolean {
        calls.push(key);

        return true;
      }
    }

    expect(new CustomReader({ flag: false }).getOptionalBoolean('flag')).equal(true);
    expect(calls).deep.equal(['flag']);

    let conversions = 0;
    const value = {
      valueOf() {
        conversions++;

        return 42;
      }
    };
    const reader = new ConfigReader({ value });
    for (let repeat = 0; repeat < 4; repeat++) {
      expect(reader.getNumber('value')).equal(42);
    }

    expect(conversions).equal(4);
    expect(reader.get('value')).equal(value);
  });

  it('preserves an existing safe error by identity without caching the failure', () => {
    const failure = new ConfigError('CONFIG_PATH_INVALID');
    let armed = false;
    const reader = new ConfigReader(
      {
        get value() {
          if (armed) {
            throw failure;
          }

          return 'recovered';
        }
      },
      { safeErrors: true }
    );
    armed = true;
    expect(() => reader.get('value')).throw(failure);
    armed = false;
    expect(reader.getString('value')).equal('recovered');
  });
});
