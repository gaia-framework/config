import { expect } from 'chai';
import { z } from 'zod';
import * as library from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('Public loading and factory contracts', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;

  beforeEach(() => {
    files = fixture();
    files.write('part.json', '{"items":[{"value":"synthetic"}]}');
    files.write('part.yaml', 'nested: {$include: ./part.json#items.0}');
    files.write('text.txt', 'synthetic text\n');
    files.write('cycle.yaml', 'next: {$include: ./cycle.yaml}');
  });

  afterEach(() => files.dispose());

  it('exports the supported runtime entrypoints', () => {
    expect(Object.keys(library).sort()).deep.equal(
      [
        'ConfigError',
        'ConfigLoader',
        'ConfigReader',
        'ConfigService',
        'createConfig',
        'createConfigFromFiles',
        'createConfigService',
        'createConfigServiceFromFiles',
        'loadConfigLayersFromFiles',
        'loadConfigObjectFromFiles',
        'resetConfigServiceCacheForTests'
      ].sort()
    );
  });

  const validCases: Array<[string, unknown]> = [
    ['', {}],
    ['null', {}],
    ['# comment\n', {}],
    ['---\n', {}],
    ['value: 3', { value: 3 }],
    ['value: "${VALUE}"', { value: 'synthetic' }],
    ['value: "${MISSING:-false}"', { value: false }],
    ['value: "$${VALUE}-${VALUE}"', { value: '${VALUE}-synthetic' }],
    ['value: {$env: VALUE}', { value: 'synthetic' }],
    ['value: {$file: ./text.txt}', { value: 'synthetic text\n' }],
    ['value: {$include: ./part.yaml}', { value: { nested: { value: 'synthetic' } } }],
    ['value: {$include: ./part.json#items.0.value}', { value: 'synthetic' }],
    ['value: &shared {a: 1}\nother: *shared', { value: { a: 1 }, other: { a: 1 } }]
  ];

  const invalidCases: Array<[string, RegExp]> = [
    ['[]', /root must be an object\/mapping/i],
    ['scalar', /root must be an object\/mapping/i],
    ['bad: [', /flow|unexpected|stream/i],
    ['value: "${MISSING}"', /not set/],
    ['value: {$env: 3}', /\$env/],
    ['value: {$file: false}', /\$file/],
    ['value: {$file: ./missing.txt}', /missing.txt/],
    ['value: {$include: ./part.json#items.9}', /fragment/i],
    ['value: {$include: ./cycle.yaml}', /cycle/i],
    ['value: {$include: ./missing.yaml}', /missing.yaml/],
    ['value: {$include: false}', /\$include/],
    ['value: &cycle {again: *cycle}', /cycle/i]
  ];

  for (const safeErrors of [false, true]) {
    for (const [content, expected] of validCases) {
      it(`loads ${JSON.stringify(content)} with safeErrors=${safeErrors}`, () => {
        const filename = files.write('config.yaml', content);
        const loader = new library.ConfigLoader({
          env: { VALUE: 'synthetic' },
          inheritProcessEnv: false,
          safeErrors
        });
        expect(loader.loadYamlConfig(filename)).deep.equal(expected);
      });
    }

    for (const [content, pattern] of invalidCases) {
      it(`rejects ${JSON.stringify(content)} with safeErrors=${safeErrors}`, () => {
        const filename = files.write('config.yaml', content);
        const action = () =>
          new library.ConfigLoader({
            env: {},
            inheritProcessEnv: false,
            safeErrors
          }).loadYamlConfig(filename);
        if (safeErrors) {
          expect(action)
            .throw(library.ConfigError)
            .with.property('code', 'CONFIG_FILE_LOAD_FAILED');
          try {
            action();
          } catch (error) {
            expect(error).not.have.property('cause');
            expect((error as Error).message).equal('Unable to load configuration file.');
          }
        } else {
          expect(action).throw(pattern);
        }
      });
    }
  }

  it('reuses resolved includes within a loader and refreshes them in a new loader', () => {
    const filename = files.write(
      'config.yaml',
      'a: {$include: ./part.yaml}\nb: {$include: ./part.yaml}'
    );
    const loader = new library.ConfigLoader();
    const first = loader.loadYamlConfig(filename);
    expect(first.a).deep.equal({ nested: { value: 'synthetic' } });
    expect(first.b).equal(first.a);
    files.write('part.yaml', 'value: updated');
    expect(loader.loadYamlConfig(filename).a).equal(first.a);
    expect(new library.ConfigLoader().loadYamlConfig(filename).a).deep.equal({ value: 'updated' });
  });

  for (const immutable of [false, true]) {
    for (const safeErrors of [false, true]) {
      it(`preserves all factories, schema transforms and cache identity (${immutable}, ${safeErrors})`, () => {
        files.write('config.yaml', 'value: 1\nnested: {base: true}\nitems: [base]');
        files.write('config.test.yaml', 'value: 2\nnested: {environment: true}');
        files.write('config.local.yaml', 'value: 3\nitems: [local]');
        files.write('config.test.local.yaml', 'value: 4');
        const schema = z.object({
          value: z.number().transform((value) => value * 2),
          nested: z.object({ base: z.boolean(), environment: z.boolean() }),
          items: z.array(z.string()),
          defaulted: z.string().default('synthetic')
        });
        const options = {
          basePath: files.directory,
          envName: 'test',
          argv: [],
          schema,
          immutable,
          safeErrors,
          env: { CONFIG: '{"value":5}', CONFIG_value: '6' },
          inheritProcessEnv: false,
          strictFiles: true,
          strictPaths: true,
          strictGetters: true
        };
        const rawExpected = {
          value: 6,
          nested: { base: true, environment: true },
          items: ['local']
        };
        const expected = { ...rawExpected, value: 12, defaulted: 'synthetic' };
        const raw = library.loadConfigLayersFromFiles(options);
        expect(raw).deep.equal(rawExpected);
        expect(library.loadConfigObjectFromFiles(options)).deep.equal(expected);
        const memory = library.createConfig(raw, schema, options);
        const service = library.createConfigServiceFromFiles(options);
        for (const reader of [
          memory,
          service,
          library.createConfigFromFiles(options),
          library.createConfigService(memory),
          library.createConfigService(raw, schema, options)
        ]) {
          expect(reader.get('nested')).deep.equal(expected.nested);
          expect(reader.getString('defaulted')).equal('synthetic');
          expect(reader.getNumber('value')).equal(12);
          expect(reader.getStringArray('items')).deep.equal(['local']);
          expect(reader.keys()).deep.equal([
            'value',
            'nested',
            'nested.base',
            'nested.environment',
            'items',
            'defaulted'
          ]);
          expect(reader.keyPaths()).deep.equal([
            ['value'],
            ['nested'],
            ['nested', 'base'],
            ['nested', 'environment'],
            ['items'],
            ['defaulted']
          ]);
          expect(Object.isFrozen(reader.get('nested'))).equal(immutable);
        }

        expect(library.createConfigServiceFromFiles(options)).equal(service);
        expect(library.createConfigServiceFromFiles({ ...options, cache: false })).not.equal(
          service
        );
        const updated = library.createConfigServiceFromFiles({
          ...options,
          env: { CONFIG_value: '7' }
        });
        expect(updated).not.equal(service);
        expect(updated.getNumber('value')).equal(14);
        expect(() => library.loadConfigObjectFromFiles({ ...options, schema: z.never() })).throw(
          safeErrors ? 'Invalid configuration.' : 'Invalid configuration:'
        );
      });
    }
  }

  for (const strictFiles of [false, true]) {
    for (const safeErrors of [false, true]) {
      it(`handles explicit file ordering and missing arguments (${strictFiles}, ${safeErrors})`, () => {
        files.write('one.yaml', 'value: first');
        files.write('two.yaml', 'value: second');
        const options = {
          basePath: files.directory,
          strictFiles,
          safeErrors,
          env: {},
          inheritProcessEnv: false,
          cache: false
        };
        for (const argv of [['--config'], ['--config', '--other'], ['--config', 'missing.yaml']]) {
          const action = () => library.createConfigServiceFromFiles({ ...options, argv }).get('');
          if (strictFiles) {
            expect(action).throw(
              safeErrors
                ? 'Unable to load configuration.'
                : /--config requires|Explicit config file not found/
            );
          } else {
            expect(action()).deep.equal({});
          }
        }

        for (const argv of [
          ['--config', 'one.yaml', '--config', 'two.yaml'],
          ['--config', 'two.yaml', '--config', 'one.yaml', '--config', 'two.yaml']
        ]) {
          expect(library.createConfigServiceFromFiles({ ...options, argv }).get('')).deep.equal({
            value: 'second'
          });
        }
      });
    }
  }
});
