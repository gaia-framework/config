import { expect } from 'chai';
import {
  ConfigLoader,
  ConfigReader,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles
} from '../../src/index.js';
import { applyEnvOverrides, readConfigKeyOverrides } from '../../src/envOverrides.js';
import { mergeConfig } from '../../src/merge.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('configuration input hardening', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;
  beforeEach(() => {
    files = fixture();
  });
  afterEach(() => files.dispose());

  it('omits invalid boolean environment values from direct and wrapped errors', () => {
    const filename = files.write('config.yaml', 'value: ${HARDENING_FLAG:-false}\n');
    const env = { HARDENING_FLAG: 'SYNTHETIC_PRIVATE_VALUE' };
    for (const load of [
      () => new ConfigLoader({ env }).loadYamlConfig(filename),
      () => loadConfigLayersFromFiles({ basePath: files.directory, argv: [], env })
    ]) {
      let error: any;
      try {
        load();
      } catch (caught) {
        error = caught;
      }

      expect(error).to.be.instanceOf(Error);
      expect(error.message).to.include('HARDENING_FLAG').and.include('must be "true" or "false"');
      while (error) {
        expect(String(error)).not.to.include(env.HARDENING_FLAG);
        expect(error.stack).not.to.include(env.HARDENING_FLAG);
        error = error.cause;
      }
    }
  });

  it('reads only own properties, including nested objects, and caches missing results', () => {
    const inherited = Object.create({ secret: 'inherited' });
    inherited.own = 'visible';
    const reader = new ConfigReader({ nested: inherited, rows: [inherited], unset: undefined });
    for (const key of [
      'constructor',
      'toString',
      '__proto__',
      'nested.secret',
      'rows.0.secret',
      'unset'
    ]) {
      expect(reader.has(key), key).to.equal(false);
      expect(reader.getOptional(key), key).to.equal(undefined);
      expect(() => reader.get(key), key).to.throw('Missing config key:');
    }

    expect(reader.getString('nested.own')).to.equal('visible');
    expect(reader.keys()).to.deep.equal(['nested', 'nested.own', 'rows', 'unset']);
  });

  it('retains explicit special keys as ordinary own data through loading, merging and factories', () => {
    files.write(
      'config.yaml',
      '{"__proto__":{"flag":"base"},"constructor":{"prototype":{"value":1}},"toString":"text"}'
    );
    files.write(
      'config.local.yaml',
      '{"__proto__":{"extra":true},"constructor":{"prototype":{"other":2}}}'
    );
    const data = loadConfigLayersFromFiles({ basePath: files.directory, argv: [], env: {} });
    expect(Object.getPrototypeOf(data)).to.equal(Object.prototype);
    expect(Object.hasOwn(data, '__proto__')).to.equal(true);
    expect(Object.hasOwn(data, 'flag')).to.equal(false);
    const reader = new ConfigReader(data);
    expect(reader.get('__proto__')).to.deep.equal({ flag: 'base', extra: true });
    expect(reader.get('constructor.prototype')).to.deep.equal({ value: 1, other: 2 });
    expect(reader.getString('toString')).to.equal('text');
    expect(reader.has('flag')).to.equal(false);
    const service = createConfigServiceFromFiles({ basePath: files.directory, argv: [], env: {} });
    expect(service.getString('__proto__.flag')).to.equal('base');
    const inheritedBase = Object.create({ nested: { hidden: 'inherited' } });
    expect(mergeConfig(inheritedBase, { nested: { own: true } })).to.deep.equal({
      nested: { own: true }
    });
    expect(Object.hasOwn(Object.prototype, 'flag')).to.equal(false);
  });

  it('does not resolve inherited indices through sparse arrays', () => {
    const rows = new Array(1);
    const prototype = Object.create(Array.prototype);
    prototype[0] = 'inherited';
    Object.setPrototypeOf(rows, prototype);
    const reader = new ConfigReader({ rows });
    expect(reader.has('rows.0')).to.equal(false);
    expect(reader.getOptional('rows.0')).to.equal(undefined);
  });

  it('preserves special keys in includes and whole-object and per-path overrides without mutating prototypes', () => {
    files.write('fragment.json', '{"__proto__":{"included":true}}');
    const filename = files.write(
      'config.yaml',
      'included: {$include: "./fragment.json#__proto__.included"}\n'
    );
    expect(new ConfigLoader().loadYamlConfig(filename)).to.deep.equal({ included: true });
    const env = {
      CONFIG: '{"__proto__":{"object":true},"constructor":{"prototype":{"object":true}}}',
      CONFIG_constructor_prototype_path: 'true',
      CONFIG_nested: '{"__proto__":{"path":true}}',
      CONFIG_toString_value: '"own"'
    };
    const overrides = readConfigKeyOverrides('CONFIG_', env);
    expect(Object.getPrototypeOf(overrides)).to.equal(Object.prototype);
    const data = applyEnvOverrides({}, { env });
    expect(Object.getPrototypeOf(data)).to.equal(Object.prototype);
    expect(Object.hasOwn(data, '__proto__')).to.equal(true);
    expect(new ConfigReader(data).get('constructor.prototype')).to.deep.equal({
      object: true,
      path: true
    });
    expect(new ConfigReader(data).getString('toString.value')).to.equal('own');
    expect(new ConfigReader(data).getBoolean('nested.__proto__.path')).to.equal(true);
    expect(Object.hasOwn(Object.prototype, 'path')).to.equal(false);
  });

  it('handles process control-variable casing according to the host platform', () => {
    files.write('config.yaml', 'value: base\n');
    files.write('config.production.yaml', 'value: production\n');
    process.env.CONFIG_DIR = files.directory;
    process.env.CONFIG_ENV = 'production';
    process.env.CONFIG = '{"object":true}';
    const data = loadConfigLayersFromFiles({
      basePath: files.directory,
      argv: [],
      configDirEnvVar: 'config_dir',
      envNameEnvVar: 'config_env',
      envOverrideObjectVar: 'config'
    });
    expect(data).to.deep.equal(
      process.platform === 'win32'
        ? { value: 'production', object: true }
        : { value: 'base', DIR: files.directory, ENV: 'production' }
    );
  });

  it('retains exact case matching for ordinary supplied environment maps on every platform', () => {
    const env = { CONFIG_DIR: 'data', CONFIG_ENV: 'data-env', CONFIG_value: 'true' };
    expect(readConfigKeyOverrides('CONFIG_', env, ['config_dir', 'config_env'])).to.deep.equal({
      DIR: 'data',
      ENV: 'data-env',
      value: true
    });
    expect(readConfigKeyOverrides('CONFIG_', env, ['CONFIG_DIR', 'CONFIG_ENV'])).to.deep.equal({
      value: true
    });
  });

  for (const [name, yaml] of [
    ['direct object', 'root: &root\n  self: *root\n'],
    ['indirect object', 'root: &root\n  child:\n    parent: *root\n'],
    ['array', 'root: &root [*root]\n'],
    ['mixed object/array', 'root: &root\n  children: [*root]\n']
  ]) {
    it(`rejects ${name} YAML alias cycles with a configuration diagnostic`, () => {
      const filename = files.write('config.yaml', yaml!);
      expect(() => new ConfigLoader().loadYamlConfig(filename)).to.throw(
        'Config value cycle detected:'
      );
      expect(() =>
        loadConfigLayersFromFiles({ basePath: files.directory, argv: [], env: {} })
      ).to.throw('Config value cycle detected:');
    });
  }

  it('rejects cycles inside includes, and can reuse the loader after a failure', () => {
    files.write('fragment.yaml', 'root: &root\n  self: *root\n');
    const filename = files.write('config.yaml', 'value: {$include: ./fragment.yaml}\n');
    const loader = new ConfigLoader();
    expect(() => loader.loadYamlConfig(filename)).to.throw('Config value cycle detected:');
    files.write('fragment.yaml', 'root: valid\n');
    expect(loader.loadYamlConfig(filename)).to.deep.equal({ value: { root: 'valid' } });
  });

  it('allows shared acyclic aliases, arrays and cached includes', () => {
    files.write(
      'fragment.yaml',
      'first: &shared {value: text}\nsecond: *shared\nrows: [*shared, *shared]\n'
    );
    const filename = files.write(
      'config.yaml',
      'first: {$include: ./fragment.yaml}\nsecond: {$include: ./fragment.yaml}\n'
    );
    const data = new ConfigLoader().loadYamlConfig(filename);
    const expected = {
      first: { value: 'text' },
      second: { value: 'text' },
      rows: [{ value: 'text' }, { value: 'text' }]
    };
    expect(data).to.deep.equal({ first: expected, second: expected });
    expect(new ConfigReader(data).getString('second.rows.1.value')).to.equal('text');
  });
});
