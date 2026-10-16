import { expect } from 'chai';
import { inspect } from 'node:util';
import { unlinkSync } from 'node:fs';
import { z } from 'zod';
import {
  ConfigError,
  ConfigLoader,
  ConfigReader,
  createConfig,
  createConfigService,
  createConfigFromFiles,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles
} from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('Opt-in configuration hardening', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;

  beforeEach(() => {
    files = fixture();
  });

  afterEach(() => {
    files.dispose();
  });

  function options() {
    return { basePath: files.directory, argv: [], env: {}, inheritProcessEnv: false };
  }

  describe('strict explicit files', () => {
    it('preserves optional discovery and legacy missing/trailing flags', () => {
      expect(loadConfigLayersFromFiles({ ...options(), strictFiles: true })).deep.equal({});
      expect(
        loadConfigLayersFromFiles({ ...options(), argv: ['--config', 'missing.yaml'] })
      ).deep.equal({});
      files.write('config.yaml', 'value: automatic');
      expect(loadConfigLayersFromFiles({ ...options(), argv: ['--config'] })).deep.equal({
        value: 'automatic'
      });
    });

    it('rejects missing files and malformed flags before returning cached services', () => {
      for (const argv of [
        ['--config'],
        ['--config', ''],
        ['--config', '--other'],
        ['--config', 'missing.yaml']
      ]) {
        expect(() =>
          loadConfigLayersFromFiles({ ...options(), argv, strictFiles: true })
        ).to.throw();
        expect(() =>
          createConfigServiceFromFiles({ ...options(), argv, strictFiles: true })
        ).to.throw();
      }
    });

    it('merges repeated selections in order and accepts explicitly prefixed flag-like filenames', () => {
      files.write('config.yaml', 'automatic: true');
      files.write('first.yaml', 'value: first\nnested: {left: 1}');
      files.write('--last.yaml', 'value: last\nnested: {right: 2}');
      expect(
        loadConfigLayersFromFiles({
          ...options(),
          strictFiles: true,
          argv: ['--config', 'first.yaml', '--config', './--last.yaml']
        })
      ).deep.equal({ value: 'last', nested: { left: 1, right: 2 } });
    });
  });

  it('rechecks required explicit files before reusing a cached service', () => {
    const filename = files.write('selected.yaml', 'value: selected');
    const settings = { ...options(), strictFiles: true, argv: ['--config', filename] };
    createConfigServiceFromFiles(settings);
    unlinkSync(filename);

    expect(() => createConfigServiceFromFiles(settings)).to.throw(/not found/);
  });

  describe('environment isolation', () => {
    it('isolates pure/mixed placeholders, directive names/values, files and included content', () => {
      process.env.OPTION_NAME = 'process';
      process.env.OPTION_FILE = './process.txt';
      files.write('process.txt', 'process text');
      files.write('part.yaml', 'value: ${OPTION_NAME:-isolated}');
      const filename = files.write(
        'config.yaml',
        [
          'pure: ${OPTION_NAME:-isolated}',
          'mixed: prefix ${OPTION_NAME:-isolated}',
          'directive: {$env: "${OPTION_KEY:-OPTION_NAME}"}',
          'text: {$file: "${OPTION_FILE:-./own.txt}"}',
          'part: {$include: ./part.yaml}'
        ].join('\n')
      );
      files.write('own.txt', 'own text');
      expect(
        new ConfigLoader({ env: { OPTION_NAME: 'own' }, inheritProcessEnv: false }).loadYamlConfig(
          filename
        )
      ).deep.equal({
        pure: 'own',
        mixed: 'prefix own',
        directive: 'own',
        text: 'own text',
        part: { value: 'own' }
      });
      expect(() =>
        new ConfigLoader({ inheritProcessEnv: false }).loadYamlConfig(filename)
      ).to.throw(/not set/);
      files.write(
        'config.yaml',
        'pure: ${OPTION_NAME:-isolated}\nmixed: prefix ${OPTION_NAME:-isolated}'
      );
      expect(new ConfigLoader({ inheritProcessEnv: false }).loadYamlConfig(filename)).deep.equal({
        pure: 'isolated',
        mixed: 'prefix isolated'
      });
      expect(new ConfigLoader({ env: {} }).loadYamlConfig(filename).pure).equal('process');
      expect(
        new ConfigLoader({ env: process.env, inheritProcessEnv: false }).loadYamlConfig(filename)
          .pure
      ).equal('process');
    });

    it('isolates discovery/overrides and does not partition cache on unrelated process changes', () => {
      process.env.CONFIG_DIR = files.directory;
      process.env.CONFIG_ENV = 'production';
      process.env.CONFIG_value = 'process';
      files.write('config.yaml', 'value: base');
      files.write('config.production.yaml', 'value: production');
      const isolated = { basePath: files.directory, argv: [], inheritProcessEnv: false };
      const first = createConfigServiceFromFiles(isolated);
      expect(first.getString('value')).equal('base');
      process.env.CONFIG_value = 'changed';
      expect(createConfigServiceFromFiles(isolated)).equal(first);
      expect(createConfigServiceFromFiles({ ...isolated, env: {} })).equal(first);
      expect(createConfigServiceFromFiles({ ...isolated, inheritProcessEnv: true })).not.equal(
        first
      );
      expect(
        loadConfigLayersFromFiles({
          ...isolated,
          env: { CONFIG_ENV: 'production', CONFIG_value: 'own' }
        })
      ).deep.equal({ value: 'own' });
    });
  });

  describe('strict getters', () => {
    it('accepts finite numbers and nonblank numeric strings', () => {
      for (const value of [0, -2, 1.5, ' 42 ', '0x10', '1e2']) {
        const reader = new ConfigReader({ value }, { strictGetters: true });
        expect(reader.getNumber('value')).equal(Number(value));
        expect(reader.getOptionalNumber('value')).equal(Number(value));
      }
    });

    it('rejects coercion-only and nonfinite numbers without changing default conversions', () => {
      for (const value of [
        '',
        '  ',
        true,
        false,
        [],
        [1],
        {},
        NaN,
        Infinity,
        -Infinity,
        'Infinity',
        'no'
      ]) {
        const reader = new ConfigReader({ value }, { strictGetters: true });
        expect(() => reader.getNumber('value')).to.throw(/number/);
        expect(reader.getOptionalNumber('value')).equal(undefined);
      }

      expect(new ConfigReader({ value: '' }).getNumber('value')).equal(0);
      expect(new ConfigReader({ value: true }).getNumber('value')).equal(1);
      expect(new ConfigReader({ value: Infinity }).getNumber('value')).equal(Infinity);
      expect(new ConfigReader({ value: NaN }).getOptionalNumber('value')).equal(undefined);
    });

    it('accepts trimmed true/false but rejects legacy boolean synonyms only in strict mode', () => {
      for (const [value, expected] of [
        [true, true],
        [false, false],
        [' TRUE ', true],
        [' false ', false]
      ]) {
        const reader = createConfig({ value }, undefined, { strictGetters: true });
        expect(reader.getBoolean('value')).equal(expected);
        expect(reader.getOptionalBoolean('value')).equal(expected);
      }

      for (const value of ['yes', 'no', 'on', 'off', '1', '0', 1, 0, '', {}, []]) {
        const reader = createConfig({ value }, undefined, { strictGetters: true });
        expect(() => reader.getBoolean('value')).to.throw(/boolean/);
        expect(reader.getOptionalBoolean('value')).equal(undefined);
      }

      expect(createConfig({ value: 'yes' }).getBoolean('value')).equal(true);
    });

    it('rejects sparse arrays while retaining dense string arrays and optional semantics', () => {
      const sparse = new Array(2);
      sparse[1] = 'text';
      const reader = createConfig(
        { sparse, dense: ['text'], empty: [], wrong: [1], nil: null },
        undefined,
        { strictGetters: true }
      );
      expect(() => reader.getStringArray('sparse')).to.throw(/string\[\]/);
      expect(reader.getOptionalStringArray('sparse')).equal(undefined);
      expect(reader.getStringArray('dense')).deep.equal(['text']);
      expect(reader.getStringArray('empty')).deep.equal([]);
      expect(reader.getOptionalStringArray('wrong')).equal(undefined);
      expect(reader.getOptionalNumber('nil')).equal(undefined);
      expect(reader.getOptionalBoolean('missing')).equal(undefined);
      expect(createConfig({ sparse }).getStringArray('sparse')).equal(sparse);
    });
  });

  describe('paths and literal segments', () => {
    it('distinguishes literal dotted keys from traversal across all service getters', () => {
      const service = createConfigService({
        'a.b': { 'c.d': 'literal' },
        a: { b: 'nested' },
        'n.n': '42',
        'b.b': 'true',
        's.s': ['one'],
        list: ['zero']
      });
      expect(service.getString(['a.b', 'c.d'])).equal('literal');
      expect(service.getString('a.b')).equal('nested');
      expect(service.getNumber(['n.n'])).equal(42);
      expect(service.getOptionalNumber(['n.n'])).equal(42);
      expect(service.getBoolean(['b.b'])).equal(true);
      expect(service.getOptionalBoolean(['b.b'])).equal(true);
      expect(service.getStringArray(['s.s'])).deep.equal(['one']);
      expect(service.getOptionalStringArray(['s.s'])).deep.equal(['one']);
      expect(service.getOptionalString(['a.b', 'c.d'])).equal('literal');
      expect(service.has(['a.b', 'c.d'])).equal(true);
      expect(service.getOptional(['missing'])).equal(undefined);
      expect(service.get(['list', '0'])).equal('zero');
      expect(service.has(['toString'])).equal(false);
    });

    it('does not let caller mutation of segment arrays corrupt cached paths', () => {
      const reader = createConfig({ a: 1, b: 2, '': 'empty' });
      const segments = ['a'];
      expect(reader.get(segments)).equal(1);
      segments[0] = 'b';
      expect(reader.get(segments)).equal(2);
      expect(reader.get(['a'])).equal(1);
      expect(reader.get([''])).equal('empty');
      expect(reader.get([])).deep.equal({ a: 1, b: 2, '': 'empty' });
    });

    it('rejects empty dotted segments and noncanonical array indices only when requested', () => {
      const reader = createConfig({ a: { b: 1 }, list: ['zero'] }, undefined, {
        strictPaths: true
      });
      for (const key of ['', '.', '.a', 'a.', 'a..b', [], [''], ['a', '']]) {
        expect(() => reader.getOptional(key)).to.throw(/path/i);
      }

      for (const index of ['00', '+0', '-0', '0.0', '0e0', ' 0 ', '-1', '1.5', 'x']) {
        expect(() => reader.getOptional(['list', index])).to.throw(/path/i);
      }

      expect(reader.getString('list.0')).equal('zero');
      expect(reader.getOptional('list.1')).equal(undefined);
      expect(createConfig({ a: { b: 1 } }).get('.a..b.')).equal(1);
      expect(createConfig({ list: ['zero'] }).get('list.00')).equal('zero');
      expect(() => reader.get(null as never)).to.throw(/path/i);
      expect(() => reader.get([1] as never)).to.throw(/segments/i);
    });
  });

  describe('in-memory input validation', () => {
    it('rejects invalid roots but permits schema transformations into objects', () => {
      for (const value of [undefined, null, 1, '', false, []]) {
        expect(() => createConfig(value)).to.throw(/root must be an object/);
        expect(() => createConfigService(value)).to.throw(/root must be an object/);
      }

      expect(
        createConfig(
          '42',
          z.string().transform((value) => ({ port: Number(value) }))
        ).getNumber('port')
      ).equal(42);
      expect(() =>
        createConfig(
          {},
          z.object({}).transform(() => [])
        )
      ).to.throw(/root must be an object/);
    });

    it('rejects direct, indirect, mixed and hidden cycles before schema recursion', () => {
      const direct: Record<string, unknown> = {};
      direct.self = direct;
      const mixed: Record<string, unknown> = { array: [] };
      (mixed.array as unknown[]).push({ back: mixed });
      const hidden = Object.defineProperty({}, 'self', {
        get() {
          return hidden;
        }
      });
      for (const value of [direct, mixed, hidden]) {
        expect(() => createConfig(value)).to.throw(/cycle detected/);
        expect(() => createConfig(value, z.any())).to.throw(/cycle detected/);
      }
    });

    it('permits shared graphs and indexes deep objects without exhausting the call stack', () => {
      const shared = { value: 'shared' };
      expect(createConfig({ first: shared, second: shared }).keys()).deep.equal([
        'first',
        'first.value',
        'second',
        'second.value'
      ]);
      let nested: Record<string, unknown> = { value: 1 };
      for (let index = 0; index < 1500; index += 1) {
        nested = { child: nested };
      }

      expect(createConfig(nested).keys()).length(1501);
    });
  });

  describe('factory options and cache bypass', () => {
    it('partitions cached services by reader/security options and preserves default reuse', () => {
      files.write('config.yaml', 'value: yes');
      const first = createConfigServiceFromFiles(options());
      expect(createConfigServiceFromFiles(options())).equal(first);
      for (const flags of [
        { strictGetters: true },
        { strictPaths: true },
        { safeErrors: true },
        { strictFiles: true }
      ]) {
        const service = createConfigServiceFromFiles({ ...options(), ...flags });
        expect(service).not.equal(first);
        expect(createConfigServiceFromFiles({ ...options(), ...flags })).equal(service);
      }

      expect(
        createConfigServiceFromFiles({ ...options(), strictGetters: true }).getOptionalBoolean(
          'value'
        )
      ).equal(undefined);
      expect(first.getBoolean('value')).equal(true);
    });

    it('bypasses service and include caches with fresh independent readers', () => {
      files.write('config.yaml', 'part: {$include: ./part.yaml}');
      files.write('part.yaml', 'value: first');
      const cached = createConfigServiceFromFiles(options());
      const fresh = createConfigServiceFromFiles({ ...options(), cache: false });
      expect(fresh).not.equal(cached);
      files.write('part.yaml', 'value: second');
      expect(createConfigServiceFromFiles(options())).equal(cached);
      expect(cached.getString('part.value')).equal('first');
      expect(
        createConfigServiceFromFiles({ ...options(), cache: false }).getString('part.value')
      ).equal('second');
      expect(createConfigFromFiles(options()).getString('part.value')).equal('second');
    });

    it('applies flags to in-memory readers and services without mutating an existing reader', () => {
      const original = createConfig({ value: 'yes' });
      expect(createConfigService(original).getBoolean('value')).equal(true);
      expect(
        createConfigService(original, undefined, { strictGetters: true }).getOptionalBoolean(
          'value'
        )
      ).equal(undefined);
      expect(original.getBoolean('value')).equal(true);
      expect(original.withOptions({ strictPaths: true }).getBoolean('value')).equal(true);
      files.write('config.yaml', 'value: yes');
      expect(
        createConfigFromFiles({ ...options(), strictGetters: true }).getOptionalBoolean('value')
      ).equal(undefined);
    });
  });

  describe('safe errors', () => {
    function safeFailure(action: () => unknown, code: string) {
      let caught: unknown;
      try {
        action();
      } catch (error) {
        caught = error;
      }

      expect(caught).instanceOf(ConfigError);
      const error = caught as ConfigError;
      expect(error.code).equal(code);
      expect(Object.hasOwn(error, 'cause')).equal(false);
      expect(inspect(error)).not.include('SYNTHETIC_PRIVATE');
      expect(JSON.stringify(error)).not.include('SYNTHETIC_PRIVATE');
      expect(error.message).not.include(files.directory);

      return error;
    }

    it('sanitizes YAML, JSON includes, filesystem and directive failures at loader boundaries', () => {
      const filename = files.write('config.yaml', 'secret: [SYNTHETIC_PRIVATE');
      safeFailure(
        () => new ConfigLoader({ safeErrors: true }).loadYamlConfig(filename),
        'CONFIG_FILE_LOAD_FAILED'
      );
      expect(() => new ConfigLoader().loadYamlConfig(filename)).to.throw(/SYNTHETIC_PRIVATE/);
      files.write('bad.json', '{"SYNTHETIC_PRIVATE":');
      for (const content of [
        'value: {$include: ./bad.json}',
        'value: {$file: ./SYNTHETIC_PRIVATE.txt}',
        'value: {$env: SYNTHETIC_PRIVATE}'
      ]) {
        files.write('config.yaml', content);
        safeFailure(
          () => loadConfigLayersFromFiles({ ...options(), safeErrors: true }),
          'CONFIG_FILE_LOAD_FAILED'
        );
      }

      safeFailure(
        () =>
          loadConfigLayersFromFiles({
            ...options(),
            safeErrors: true,
            strictFiles: true,
            argv: ['--config']
          }),
        'CONFIG_LOAD_FAILED'
      );
      files.write('config.yaml', 'value: valid');
      safeFailure(
        () =>
          loadConfigLayersFromFiles({
            ...options(),
            safeErrors: true,
            env: { CONFIG: '{SYNTHETIC_PRIVATE' }
          }),
        'CONFIG_LOAD_FAILED'
      );
    });

    it('sanitizes schema issues and arbitrary custom validation exceptions', () => {
      for (const schema of [
        z.string('SYNTHETIC_PRIVATE'),
        z.any().transform(() => {
          throw new Error('SYNTHETIC_PRIVATE');
        })
      ]) {
        safeFailure(
          () => createConfig({}, schema, { safeErrors: true }),
          'CONFIG_VALIDATION_FAILED'
        );
        safeFailure(
          () => loadConfigObjectFromFiles({ ...options(), schema, safeErrors: true }),
          'CONFIG_VALIDATION_FAILED'
        );
        safeFailure(
          () => createConfigServiceFromFiles({ ...options(), schema, safeErrors: true }),
          'CONFIG_VALIDATION_FAILED'
        );
      }
    });

    it('sanitizes input, path, missing-key and value/accessor failures', () => {
      safeFailure(
        () => createConfig(null, undefined, { safeErrors: true }),
        'CONFIG_INPUT_INVALID'
      );
      const data: Record<string, unknown> = {
        value: 1,
        coerced: {
          valueOf() {
            throw new Error('SYNTHETIC_PRIVATE');
          }
        }
      };
      const reader = createConfig(data, undefined, { safeErrors: true, strictPaths: true });
      safeFailure(() => reader.get('SYNTHETIC_PRIVATE'), 'CONFIG_KEY_MISSING');
      safeFailure(() => reader.get('.SYNTHETIC_PRIVATE'), 'CONFIG_PATH_INVALID');
      safeFailure(() => reader.getString('value'), 'CONFIG_VALUE_INVALID');
      safeFailure(() => reader.getNumber('coerced'), 'CONFIG_VALUE_INVALID');
      Object.defineProperty(data, 'uncached', {
        get() {
          throw new Error('SYNTHETIC_PRIVATE');
        }
      });
      safeFailure(() => reader.get('uncached'), 'CONFIG_VALUE_INVALID');
      safeFailure(
        () => createConfig(data, undefined, { safeErrors: true }),
        'CONFIG_INPUT_INVALID'
      );
      const sparse = new Array(1);
      safeFailure(() => reader.get(sparse), 'CONFIG_PATH_INVALID');
    });

    it('covers typed segment-path errors without exposing labels or breaking optional getters', () => {
      const reader = createConfig({ SYNTHETIC_PRIVATE: {} }, undefined, {
        safeErrors: true,
        strictGetters: true
      });
      const key = ['SYNTHETIC_PRIVATE'] as const;

      safeFailure(() => reader.getString(key), 'CONFIG_VALUE_INVALID');
      safeFailure(() => reader.getNumber(key), 'CONFIG_VALUE_INVALID');
      safeFailure(() => reader.getBoolean(key), 'CONFIG_VALUE_INVALID');
      safeFailure(() => reader.getStringArray(key), 'CONFIG_VALUE_INVALID');
      safeFailure(() => reader.get(['SYNTHETIC_PRIVATE', 'missing']), 'CONFIG_KEY_MISSING');
      expect(reader.getOptionalString(key)).equal(undefined);
      expect(reader.getOptionalNumber(key)).equal(undefined);
      expect(reader.getOptionalBoolean(key)).equal(undefined);
      expect(reader.getOptionalStringArray(key)).equal(undefined);
    });
  });
});
