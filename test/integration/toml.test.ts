import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sinon from 'sinon';
import { Container } from 'inversify';
import { z } from 'zod';
import * as yaml from 'js-yaml';
import { stringify } from 'smol-toml';
import {
  ConfigLoader,
  ConfigError,
  ConfigReader,
  ConfigService,
  createConfig,
  createConfigService,
  createConfigFromFiles,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles
} from '../../src/index.js';
import type { LoadConfigOptions } from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('TOML shared configuration pipeline', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;
  let options: LoadConfigOptions;

  beforeEach(() => {
    files = fixture();
    options = {
      basePath: files.directory,
      fileFormat: 'toml',
      envName: 'production',
      argv: [],
      env: {},
      inheritProcessEnv: false
    };
  });

  afterEach(() => {
    sinon.restore();
    files.dispose();
  });

  it('preserves every precedence layer, deep merges, replacement arrays and null clearing', () => {
    files.write('config.yaml', 'yamlOnly: true');
    const names = [
      'config.toml',
      'config.production.toml',
      'config.local.toml',
      'config.production.local.toml'
    ];
    const layers = [
      'port = 1\n[service]\nname = "synthetic"\nitems = [1, 2]\nclear = "base"',
      'port = 2\n[service]\nenabled = true',
      'port = 3\n[service]\nitems = [3]\nclear = { "$null" = true }',
      'port = 4'
    ];
    for (let index = 0; index < names.length; index++) {
      files.write(names[index]!, layers[index]!);
      expect(loadConfigLayersFromFiles(options).port).equal(index + 1);
    }

    expect(loadConfigLayersFromFiles(options)).deep.equal({
      port: 4,
      service: { name: 'synthetic', enabled: true, items: [3], clear: null }
    });
    expect(loadConfigLayersFromFiles({ ...options, fileFormat: 'yaml' })).deep.equal({
      yamlOnly: true
    });
  });

  it('uses configured directory/environment/file names and excludes their control variables', () => {
    files.write('settings.staging.toml', 'port = 1');
    const directoryOptions = { ...options };
    delete directoryOptions.basePath;
    delete directoryOptions.envName;
    expect(
      loadConfigLayersFromFiles({
        ...directoryOptions,
        fileBaseName: 'settings',
        configDirEnvVar: 'PRODUCT_DIR',
        envNameEnvVar: 'PRODUCT_ENV',
        envOverrideObjectVar: 'PRODUCT',
        envOverridePrefix: 'PRODUCT_',
        env: {
          PRODUCT_DIR: files.directory,
          PRODUCT_ENV: 'staging',
          PRODUCT: '{"port":2}',
          PRODUCT_port: '3'
        }
      })
    ).deep.equal({ port: 3 });
  });

  it('supports repeated mixed explicit files in order and retains optional/strict missing behavior', () => {
    files.write('base.yaml', 'port: 1\nbase: true');
    files.write('extra.toml', 'port = 2');
    files.write('config.toml', 'port = 99');
    const selected = { ...options, argv: ['--config', 'base.yaml', '--config', 'extra.toml'] };
    expect(loadConfigLayersFromFiles(selected)).deep.equal({ port: 2, base: true });
    expect(
      loadConfigLayersFromFiles({
        ...selected,
        argv: ['--config', 'extra.toml', '--config', 'base.yaml']
      }).port
    ).equal(1);
    expect(
      loadConfigLayersFromFiles({ ...options, argv: ['--config', 'missing.toml'] })
    ).deep.equal({});
    expect(() =>
      loadConfigLayersFromFiles({
        ...options,
        strictFiles: true,
        argv: ['--config', 'missing.toml']
      })
    ).to.throw('not found');
    expect(() =>
      loadConfigLayersFromFiles({ ...options, strictFiles: true, argv: ['--config'] })
    ).to.throw('requires a file');
    expect(loadConfigLayersFromFiles({ ...options, argv: ['--config'] }).port).equal(99);
  });

  it('rejects unsupported runtime formats with and without explicit files', () => {
    for (const argv of [[], ['--config', 'missing.toml']]) {
      for (const fileFormat of ['xml', '', 'TOML', null, 1, {}]) {
        expect(() =>
          loadConfigLayersFromFiles({ ...options, argv, fileFormat: fileFormat as any })
        ).to.throw('fileFormat');
      }
    }
  });

  it('preserves placeholders, fallbacks, escaping, booleans and all path-override encodings', () => {
    files.write(
      'config.toml',
      `
required = "\${NAME}"
mixed = "hello \${NAME}"
empty = '\${EMPTY:-""}'
fallback = "\${MISSING:-local}"
literal = "$\${NAME}"
enabled = "\${ENABLED:-false}"
numeric = "\${PORT:-4000}"
`
    );
    const selected = {
      ...options,
      env: {
        NAME: 'synthetic',
        ENABLED: 'true',
        CONFIG: '{"service":{"base":true},"required":"object"}',
        CONFIG_required: 'path',
        CONFIG_service_port: '4001',
        CONFIG_my___provider_under__score: '"value"',
        CONFIG_array: '[1,2]',
        CONFIG_object: '{"ok":true}',
        CONFIG_clear: 'null'
      }
    };
    expect(loadConfigLayersFromFiles(selected)).deep.equal({
      required: 'path',
      mixed: 'hello synthetic',
      empty: '',
      fallback: 'local',
      literal: '${NAME}',
      enabled: true,
      numeric: '4000',
      service: { base: true, port: 4001 },
      'my-provider': { under_score: 'value' },
      array: [1, 2],
      object: { ok: true },
      clear: null
    });
    expect(() =>
      loadConfigLayersFromFiles({ ...options, env: { NAME: 'synthetic', ENABLED: 'yes' } })
    ).to.throw('must be "true" or "false"');
    expect(() => loadConfigLayersFromFiles(options)).to.throw('NAME');
    expect(() =>
      loadConfigLayersFromFiles({ ...selected, env: { ...selected.env, CONFIG: '[]' } })
    ).to.throw();
  });

  it('resolves all directives across formats, nested fragments, absolute paths and repeated includes', () => {
    files.write(
      'parts/child.toml',
      'items = [{name="first"}, {name="second"}]\nclear = { "$null" = true }'
    );
    files.write('parts/bridge.yaml', 'nested: {$include: ./child.toml#items.1}');
    files.write(
      'values.json',
      '{"value":{"$include":"./parts/bridge.yaml#nested"},"literal":{"$null":true}}'
    );
    files.write('text.txt', 'synthetic ${UNCHANGED}');
    files.write(
      'config.toml',
      `
secret = { "$env" = "\${SECRET_NAME}" }
text = { "$file" = "./text.txt" }
first = { "$include" = "./parts/child.toml#items.0" }
second = { "$include" = "./parts/child.toml#items.1" }
clear = { "$include" = "./parts/child.toml#clear" }
bridge = { "$include" = "\${PARTS}" }
json = { "$include" = "./values.json" }
`
    );
    const read = sinon.spy(fs, 'readFileSync');
    const selected = {
      ...options,
      env: {
        SECRET_NAME: 'SECRET',
        SECRET: 'synthetic',
        PARTS: path.join(files.directory, 'parts/bridge.yaml')
      }
    };
    expect(loadConfigLayersFromFiles(selected)).deep.equal({
      secret: 'synthetic',
      text: 'synthetic ${UNCHANGED}',
      first: { name: 'first' },
      second: { name: 'second' },
      clear: null,
      bridge: { nested: { name: 'second' } },
      json: { value: { name: 'second' }, literal: { $null: true } }
    });
    expect(read.getCalls().filter((call) => String(call.args[0]).endsWith('child.toml'))).length(1);
    expect(
      new ConfigLoader().loadYamlConfig(files.write('literal.yaml', 'value: {$null: true}'))
    ).deep.equal({ value: { $null: true } });
  });

  for (const spec of [
    'missing.toml',
    'values.toml#missing',
    'values.toml#items.99',
    'values.toml#items.invalid'
  ]) {
    it(`rejects invalid include ${spec}`, () => {
      files.write('values.toml', 'items = [1]');
      files.write('config.toml', `value = { "$include" = "./${spec}" }`);
      expect(() => loadConfigLayersFromFiles(options)).to.throw(/not found/);
    });
  }

  it('detects direct and mixed-format indirect include cycles', () => {
    files.write('config.toml', 'value = { "$include" = "./config.toml" }');
    expect(() => loadConfigLayersFromFiles(options)).to.throw('cycle');
    files.write('config.toml', 'value = { "$include" = "./bridge.yaml" }');
    files.write('bridge.yaml', 'value: {$include: ./bridge.json}');
    files.write('bridge.json', '{"value":{"$include":"./config.toml"}}');
    expect(() => loadConfigLayersFromFiles(options)).to.throw('cycle');
  });

  it('preserves directive argument, missing environment/file and unreadable-file failures', () => {
    for (const text of [
      'value = { "$env" = 1 }',
      'value = { "$file" = false }',
      'value = { "$include" = [] }',
      'value = { "$env" = "UNSET" }',
      'value = { "$file" = "missing.txt" }'
    ]) {
      files.write('config.toml', text);
      expect(() => loadConfigLayersFromFiles(options)).to.throw();
    }

    files.write('config.toml', 'value = 1');
    sinon.stub(fs, 'readFileSync').throws(new Error('synthetic unreadable file'));
    expect(() => loadConfigLayersFromFiles(options)).to.throw('synthetic unreadable file');
  });

  it('preserves schemas, every factory, strict/immutable readers and actual DI resolution', () => {
    files.write(
      'config.toml',
      'port = "${PORT:-4000}"\nclear = { "$null" = true }\nnested = { value = 1 }'
    );
    const schema = z.object({
      port: z.coerce.number().transform((port) => port + 1),
      clear: z.null(),
      nested: z.object({ value: z.number() }),
      enabled: z.boolean().default(true)
    });
    const selected = {
      ...options,
      schema,
      immutable: true,
      strictGetters: true,
      strictPaths: true
    };
    const raw = loadConfigLayersFromFiles(selected);
    expect(raw.port).equal('4000');
    expect(loadConfigObjectFromFiles(selected)).deep.equal({
      port: 4001,
      clear: null,
      nested: { value: 1 },
      enabled: true
    });
    for (const reader of [
      createConfig(raw, schema, selected),
      createConfigService(raw, schema, selected),
      createConfigFromFiles(selected),
      createConfigServiceFromFiles(selected)
    ]) {
      expect(reader.getNumber('port')).equal(4001);
      expect(reader.getBoolean('enabled')).equal(true);
      expect(reader.getOptionalString('missing')).equal(undefined);
      expect(Object.isFrozen(reader.get('nested'))).equal(true);
      expect(() => reader.getString('port')).to.throw();
    }

    const container = new Container();
    container.bind(ConfigReader).toConstantValue(createConfigFromFiles(selected));
    container
      .bind(ConfigService)
      .toDynamicValue((context) => new ConfigService(context.get(ConfigReader)));
    expect(container.get(ConfigService).getNumber('port')).equal(4001);
    expect(() => loadConfigObjectFromFiles({ ...options, schema: z.never() })).to.throw(
      'Invalid configuration'
    );
  });

  it('partitions cache formats, normalizes YAML defaults and preserves bypass/environment/schema identity', () => {
    files.write('config.toml', 'port = "${PORT:-1}"');
    files.write('config.yaml', 'port: "${PORT:-1}"');
    const yamlOptions = { ...options };
    delete yamlOptions.fileFormat;
    const yamlService = createConfigServiceFromFiles(yamlOptions);
    expect(createConfigServiceFromFiles({ ...yamlOptions, fileFormat: 'yaml' })).equal(yamlService);
    const service = createConfigServiceFromFiles(options);
    expect(service).not.equal(yamlService);
    expect(createConfigServiceFromFiles(options)).equal(service);
    const explicit = { ...options, argv: ['--config', 'config.toml'] };
    expect(createConfigServiceFromFiles(explicit)).not.equal(
      createConfigServiceFromFiles({ ...explicit, fileFormat: 'yaml' })
    );
    expect(createConfigServiceFromFiles({ ...options, cache: false })).not.equal(service);
    expect(
      createConfigServiceFromFiles({ ...options, env: { PORT: '2' } }).getNumber('port')
    ).equal(2);
    const schema = z.object({ port: z.coerce.number() });
    const validated = createConfigServiceFromFiles({ ...options, schema });
    expect(validated).not.equal(service);
    expect(createConfigServiceFromFiles({ ...options, schema })).equal(validated);
    expect(
      createConfigServiceFromFiles({ ...options, schema: z.object({ port: z.coerce.number() }) })
    ).not.equal(validated);
  });

  it('redacts TOML parser, directive and normalization errors in safe mode', () => {
    for (const text of [
      'secret = "SYNTHETIC_PRIVATE',
      'value = 2000-01-01',
      'value = { "$include" = "private.toml" }'
    ]) {
      const filename = files.write('private-config.toml', text);
      const loader = new ConfigLoader({ safeErrors: true });
      expect(() => loader.loadTomlConfig(filename)).to.throw('Unable to load configuration file.');
      let failure: unknown;
      try {
        loadConfigLayersFromFiles({ ...options, argv: ['--config', filename], safeErrors: true });
      } catch (error) {
        failure = error;
      }

      expect(failure).instanceOf(ConfigError);
      expect((failure as ConfigError).code).equal('CONFIG_FILE_LOAD_FAILED');
      expect(JSON.stringify(failure)).not.to.match(
        /SYNTHETIC_PRIVATE|private-config|private\.toml/
      );
    }
  });

  it('retains supplied-map precedence, optional process fallback and empty-variable handling', () => {
    files.write('config.toml', 'value = "${TOML_EXAMPLE_VALUE}"');
    process.env.TOML_EXAMPLE_VALUE = 'process';
    expect(loadConfigLayersFromFiles({ ...options, inheritProcessEnv: true }).value).equal(
      'process'
    );
    expect(
      loadConfigLayersFromFiles({ ...options, env: { TOML_EXAMPLE_VALUE: 'map' } }).value
    ).equal('map');
    expect(() => loadConfigLayersFromFiles(options)).to.throw('TOML_EXAMPLE_VALUE');
    expect(() =>
      loadConfigLayersFromFiles({
        ...options,
        env: { TOML_EXAMPLE_VALUE: '' },
        inheritProcessEnv: true
      })
    ).to.throw('not set');
    files.write('config.toml', 'value = "${TOML_EXAMPLE_VALUE:-fallback}"');
    expect(
      loadConfigLayersFromFiles({
        ...options,
        env: { TOML_EXAMPLE_VALUE: '' },
        inheritProcessEnv: true
      }).value
    ).equal('fallback');
  });

  it('keeps include caches per loader and handles empty/null-root TOML fragments', () => {
    const child = files.write('child.toml', 'value = 1');
    const filename = files.write('config.toml', 'part = { "$include" = "./child.toml" }');
    const loader = new ConfigLoader();
    expect(loader.loadTomlConfig(filename).part).deep.equal({ value: 1 });
    fs.writeFileSync(child, 'value = 2');
    expect(loader.loadTomlConfig(filename).part).deep.equal({ value: 1 });
    expect(new ConfigLoader().loadTomlConfig(filename).part).deep.equal({ value: 2 });
    files.write('empty.TOML', '# empty');
    files.write('null.toml', '"$null" = true');
    files.write('bridge.yaml', 'empty: {$include: ./empty.TOML}\ncleared: {$include: ./null.toml}');
    expect(new ConfigLoader().loadYamlConfig(path.join(files.directory, 'bridge.yaml'))).deep.equal(
      { empty: {}, cleared: null }
    );
  });

  it('matches a generated application-shaped YAML configuration exceeding 1 MiB', () => {
    const workers = Object.fromEntries(
      Array.from({ length: 1500 }, (_, index) => [
        `worker-${index}`,
        {
          enabled: '${ENABLED:-true}',
          endpoint: `https://worker-${index}.example.test`,
          description: 'synthetic '.repeat(100),
          partitions: { 'partition.1': { timeout: '${TIMEOUT:-60000}', stages: ['read', 'write'] } }
        }
      ])
    );
    const data = {
      port: '${PORT:-4400}',
      processing: { workers },
      storage: { driver: 'filesystem' },
      queue: { driver: 'memory' }
    };
    const toml = stringify(data);
    expect(Buffer.byteLength(toml)).greaterThan(1024 * 1024);
    files.write('config.toml', toml);
    files.write('config.yaml', yaml.dump(data, { lineWidth: -1 }));
    const actual = loadConfigLayersFromFiles(options);
    expect(actual).deep.equal(loadConfigLayersFromFiles({ ...options, fileFormat: 'yaml' }));
    const reader = createConfig(actual);
    expect(reader.getBoolean(['processing', 'workers', 'worker-1499', 'enabled'])).equal(true);
    expect(
      reader.getNumber([
        'processing',
        'workers',
        'worker-1499',
        'partitions',
        'partition.1',
        'timeout'
      ])
    ).equal(60000);
  });

  for (const [yamlExample, tomlExample] of [
    ['11-service', '14-toml-service'],
    ['12-pipelines', '15-toml-pipelines']
  ]) {
    it(`matches ${yamlExample} across all factories, schema transforms and naming options`, async () => {
      const yamlDirectory = path.resolve('examples', yamlExample!);
      const tomlDirectory = path.resolve('examples', tomlExample!);
      fs.cpSync(yamlDirectory, path.join(files.directory, 'yaml'), { recursive: true });
      fs.cpSync(tomlDirectory, path.join(files.directory, 'toml'), { recursive: true });
      const configuration = await import(
        pathToFileURL(path.join(yamlDirectory, 'configuration.ts')).href
      );
      const yamlOptions = configuration.options(path.join(files.directory, 'yaml'));
      const tomlOptions = {
        ...configuration.options(path.join(files.directory, 'toml')),
        fileFormat: 'toml' as const
      };
      expect(loadConfigLayersFromFiles(tomlOptions)).deep.equal(
        loadConfigLayersFromFiles(yamlOptions)
      );
      expect(loadConfigObjectFromFiles(tomlOptions)).deep.equal(
        loadConfigObjectFromFiles(yamlOptions)
      );
      for (const immutable of [false, true]) {
        for (const safeErrors of [false, true]) {
          const yamlSelected = { ...yamlOptions, immutable, safeErrors, strictGetters: true };
          const tomlSelected = { ...tomlOptions, immutable, safeErrors, strictGetters: true };
          const yamlReader = createConfigFromFiles(yamlSelected);
          const raw = loadConfigLayersFromFiles(tomlSelected);
          const service = createConfigServiceFromFiles(tomlSelected);
          const readers = [
            service,
            createConfigFromFiles(tomlSelected),
            createConfig(raw, tomlSelected.schema, tomlSelected),
            createConfigService(raw, tomlSelected.schema, tomlSelected),
            createConfigService(createConfigFromFiles(tomlSelected))
          ];
          for (const reader of readers) {
            expect(reader.get('')).deep.equal(yamlReader.get(''));
            expect(reader.keyPaths()).to.have.deep.members(yamlReader.keyPaths());
            expect(Object.isFrozen(reader.get(''))).equal(immutable);
            expect(
              reader.get<{ fallbackDirectory: string | null }>('storage').fallbackDirectory
            ).equal(null);
            expect(reader.getOptionalString('storage.fallbackDirectory')).equal(undefined);
          }

          expect(createConfigServiceFromFiles(tomlSelected)).equal(service);
          expect(service).not.equal(createConfigServiceFromFiles(yamlSelected));
          expect(createConfigServiceFromFiles({ ...tomlSelected, cache: false })).not.equal(
            service
          );
        }
      }
    });
  }

  it('resolves modular example fragments and reuses nested includes in both formats', async () => {
    for (const [directory, extension] of [
      ['12-pipelines', 'yaml'],
      ['15-toml-pipelines', 'toml']
    ]) {
      const source = path.resolve('examples', directory!);
      const configuration = await import(pathToFileURL(path.join(source, 'configuration.ts')).href);
      const selected = configuration.options(source);
      const loader = new ConfigLoader({ env: selected.env, inheritProcessEnv: false });
      const data = loader.loadConfigFile(path.join(source, `config.${extension}`));
      expect(data.workers.ingest).equal(data.workers.transform);
      expect(data.routing.primaryRule).equal(data.routing.rules[0]);
      expect(data.workers.ingest.concurrency).equal('2');
      expect(data.pipelines.daily.destination).deep.equal({
        name: 'primary-output',
        url: 'https://primary.example.test/batches'
      });
      expect(data.pipelines.archive.destination.name).equal('archive-output');
      expect(data.messages.banner).equal(
        fs.readFileSync(path.join(source, 'parts/banner.txt'), 'utf8')
      );
      expect(data.messages.literal).equal('${PIPELINE_EXAMPLE_ACCESS_KEY}');
      expect(data.security.accessKey).equal('synthetic-key-not-a-credential');
      expect(data.messages.greeting).equal('Batch ready');
      expect(data.features.telemetry).equal(false);
    }
  });

  it('resolves a 1,000-fragment mixed-format graph with verified leaf values', function () {
    this.timeout(20000);
    const lines = [];
    for (let index = 0; index < 1000; index++) {
      const extension = index % 2 === 0 ? 'toml' : 'yaml';
      files.write(
        `parts/p${index}.${extension}`,
        extension === 'toml' ? `value = ${index}` : `value: ${index}`
      );
      lines.push(`p${index} = { "$include" = "./parts/p${index}.${extension}" }`);
    }

    files.write('config.toml', lines.join('\n'));
    const data = loadConfigLayersFromFiles(options);
    expect(Object.keys(data)).length(1000);
    for (let index = 0; index < 1000; index++) {
      expect(data[`p${index}`]).deep.equal({ value: index });
    }
  });
});
