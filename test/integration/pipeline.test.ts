import { expect } from 'chai';
import { Container } from 'inversify';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ConfigLoader,
  ConfigReader,
  ConfigService,
  createConfig,
  createConfigService,
  createConfigFromFiles,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles,
  resetConfigServiceCacheForTests
} from '../../src/index.js';
import type { LoadConfigOptions } from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('configuration pipeline', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;
  beforeEach(() => {
    files = fixture();
  });
  afterEach(() => files.dispose());

  function options(extra: LoadConfigOptions = {}): LoadConfigOptions {
    return { basePath: files.directory, argv: [], env: {}, ...extra };
  }

  function load(extra: LoadConfigOptions = {}) {
    return loadConfigObjectFromFiles(options(extra)) as Record<string, any>;
  }

  it('applies each layer in order, preserving unrelated keys, then object and path overrides', () => {
    files.write('config.yaml', 'value: base\nbase: true\n');
    expect(load({ envName: 'production' }).value).to.equal('base');
    files.write('config.production.yaml', 'value: environment\n');
    expect(load({ envName: 'production' }).value).to.equal('environment');
    files.write('config.local.yaml', 'value: local\n');
    expect(load({ envName: 'production' }).value).to.equal('local');
    files.write('config.production.local.yaml', 'value: deployment\n');
    expect(load({ envName: 'production' })).to.deep.equal({ value: 'deployment', base: true });
    expect(
      load({ envName: 'production', env: { CONFIG: '{"value":"object"}', CONFIG_value: 'key' } })
        .value
    ).to.equal('key');
  });
  it('resolves explicit paths in argument order instead of automatic discovery', () => {
    files.write('config.yaml', 'automatic: true\n');
    files.write('first.yaml', 'value: first\nkeep: true\n');
    const second = files.write('second.yaml', 'value: second\n');
    expect(load({ argv: ['--other', '--config', 'first.yaml', '--config', second] })).to.deep.equal(
      { value: 'second', keep: true }
    );
    expect(load({ argv: ['--config', 'absent.yaml'] })).to.deep.equal({});
    expect(load({ argv: ['--config'] })).to.deep.equal({ automatic: true });
  });
  it('honors neutral defaults, custom filenames, custom directory/env variables and NODE_ENV fallback', () => {
    files.write('config.development.yaml', 'value: development\n');
    files.write('config.production.yaml', 'value: production\n');
    files.write('config.staging.yaml', 'value: staging\n');
    expect(load().value).to.equal('development');
    expect(load({ env: { NODE_ENV: 'production' } }).value).to.equal('production');
    expect(load({ env: { CONFIG_ENV: ' staging ', NODE_ENV: 'production' } }).value).to.equal(
      'staging'
    );
    expect(
      loadConfigObjectFromFiles<any>({
        argv: [],
        env: { CONFIG_DIR: files.directory, CONFIG_ENV: 'production' }
      }).value
    ).to.equal('production');
    expect(
      loadConfigObjectFromFiles<any>({
        argv: [],
        configDirEnvVar: 'CUSTOM_DIR',
        envNameEnvVar: 'CUSTOM_ENV',
        env: { CUSTOM_DIR: files.directory, CUSTOM_ENV: 'staging' }
      }).value
    ).to.equal('staging');
    files.write('settings.production.yaml', 'value: custom\n');
    expect(load({ fileBaseName: 'settings', envName: 'production' }).value).to.equal('custom');
  });
  it('uses cwd, process env and process argv by default in an isolated child process', function () {
    // Allow two isolated Node startups while bounding each child independently.
    this.timeout(30000);

    const moduleUrl = new URL('../../src/index.js', import.meta.url).href;
    files.write('config.test.yaml', 'value: default\n');
    files.write('explicit.yaml', 'value: explicit\n');
    const script = files.write(
      'run.ts',
      `import {loadConfigObjectFromFiles} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(loadConfigObjectFromFiles()));`
    );
    const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    // Source tests need remapping; compiled checks use the emitted JS directly.
    const importArguments = import.meta.url.endsWith('.ts') ? ['--import', loader] : [];
    const run = (args: string[]) =>
      spawnSync(process.execPath, [...importArguments, script, ...args], {
        cwd: files.directory,
        env: { ...process.env, NODE_ENV: 'test' },
        encoding: 'utf8',
        timeout: 10000
      });

    const discovered = run([]);
    expect(discovered.error).to.equal(undefined);
    expect(discovered.status, discovered.stderr).to.equal(0);
    expect(JSON.parse(discovered.stdout).value).to.equal('default');

    const explicit = run(['--config', 'explicit.yaml']);
    expect(explicit.error).to.equal(undefined);
    expect(explicit.status, explicit.stderr).to.equal(0);
    expect(JSON.parse(explicit.stdout).value).to.equal('explicit');
  });
  it('reproduces independent application naming through options rather than automatic detection', () => {
    files.write('config.test.yaml', 'value: file\n');
    for (const profile of [
      {
        dir: 'SERVICE_CONFIG_DIR',
        environment: 'SERVICE_ENV',
        object: 'SERVICE_CONFIG',
        prefix: 'SERVICE_CONFIG_'
      },
      {
        dir: 'PIPELINE_CONFIG_DIR',
        environment: 'PIPELINE_ENV',
        object: 'PIPELINE_CONFIG',
        prefix: 'PIPELINE_CONFIG_'
      }
    ]) {
      const config = loadConfigObjectFromFiles<any>({
        argv: [],
        configDirEnvVar: profile.dir,
        envNameEnvVar: profile.environment,
        envOverrideObjectVar: profile.object,
        envOverridePrefix: profile.prefix,
        env: {
          [profile.dir]: files.directory,
          [profile.environment]: 'test',
          [profile.object]: '{"value":"object"}',
          [profile.prefix + 'value']: 'key'
        }
      });
      expect(config.value).to.equal('key');
    }

    expect(
      load({
        envName: 'test',
        env: { SERVICE_CONFIG_value: 'ignored', PIPELINE_CONFIG_value: 'ignored' }
      }).value
    ).to.equal('file');
  });
  it('returns raw layers without validation, and applies schema defaults/transforms/errors afterward', () => {
    files.write('config.yaml', 'port: "4000"\nextra: retained-in-raw\n');
    const schema = z.object({
      port: z.coerce.number().transform((n) => n + 1),
      enabled: z.boolean().default(true)
    });
    const opts = { ...options(), schema };
    expect(loadConfigLayersFromFiles(opts)).to.deep.equal({
      port: '4000',
      extra: 'retained-in-raw'
    });
    expect(loadConfigObjectFromFiles(opts)).to.deep.equal({ port: 4001, enabled: true });
    expect(createConfigFromFiles(opts).getNumber('port')).to.equal(4001);
    expect(createConfigServiceFromFiles(opts).getBoolean('enabled')).to.equal(true);
    expect(() => createConfig({}, z.object({ value: z.string() }))).to.throw(
      'Invalid configuration:\nvalue:'
    );
    expect(() => createConfig([], z.object({}))).to.throw('<root>:');
    files.write('config.yaml', 'port: [\n');
    expect(() => load()).to.throw(`Failed to load config file ${files.directory}`);
  });
  it('supports in-memory factories, an existing reader, and actual Inversify resolution', () => {
    const reader = createConfig({ port: 4001 });
    expect(reader).to.be.instanceOf(ConfigReader);
    const service = createConfigService(reader, z.never());
    expect(service.getNumber('port')).to.equal(4001);
    const container = new Container();
    container.bind(ConfigReader).toConstantValue(reader);
    container
      .bind(ConfigService)
      .toDynamicValue((context) => new ConfigService(context.get(ConfigReader)));
    expect(container.get(ConfigService).getNumber('port')).to.equal(4001);
    expect(new ConfigLoader().loadYamlConfig(files.write('null.yaml', 'null'))).to.deep.equal({});
  });
  it('preserves service identity for identical inputs and file changes until reset', () => {
    files.write('config.yaml', 'value: file\n');
    const first = createConfigServiceFromFiles(options());
    const second = createConfigServiceFromFiles(options());
    expect(second).to.equal(first);
    expect(second.getString('value')).to.equal('file');
    files.write('config.yaml', 'value: changed\n');
    expect(createConfigServiceFromFiles(options())).to.equal(first);
    resetConfigServiceCacheForTests();
    expect(createConfigServiceFromFiles(options()).getString('value')).to.equal('changed');
  });
  it('guards reset and accepts each original or neutral test environment', () => {
    delete process.env.NODE_ENV;
    delete process.env.GAIA_ENV;
    delete process.env.CONFIG_ENV;
    expect(() => resetConfigServiceCacheForTests()).to.throw('only be reset in a test environment');
    for (const key of ['NODE_ENV', 'GAIA_ENV', 'CONFIG_ENV']) {
      process.env[key] = 'test';
      expect(() => resetConfigServiceCacheForTests()).not.to.throw();
      delete process.env[key];
    }
  });
  it('keeps neutral control variables out of the CONFIG_ path overrides', () => {
    expect(load({ env: { CONFIG_DIR: files.directory, CONFIG_ENV: 'test' } })).to.deep.equal({});
  });
});
