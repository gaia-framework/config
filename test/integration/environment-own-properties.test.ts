import { expect } from 'chai';
import {
  ConfigLoader,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles
} from '../../src/index.js';
import { readConfigObjectEnv } from '../../src/envOverrides.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('own environment entries', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;
  const names = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'];
  beforeEach(() => {
    files = fixture();
    for (const name of names) {
      delete process.env[name];
    }
  });
  afterEach(() => files.dispose());

  it('uses fallbacks rather than inherited functions or objects in pure and mixed placeholders', () => {
    for (const name of names) {
      const filename = files.write(
        'config.yaml',
        JSON.stringify({
          pure: '${' + name + ':-fallback}',
          mixed: 'prefix ${' + name + ':-fallback}',
          boolean: '${' + name + ':-false}'
        })
      );
      for (const loader of [new ConfigLoader(), new ConfigLoader({ env: {} })]) {
        expect(loader.loadYamlConfig(filename), name).to.deep.equal({
          pure: 'fallback',
          mixed: 'prefix fallback',
          boolean: false
        });
      }
    }
  });

  it('rejects required inherited names for placeholders and $env directives', () => {
    for (const name of names) {
      for (const value of ['${' + name + '}', 'prefix ${' + name + '}', { $env: name }]) {
        const filename = files.write('config.yaml', JSON.stringify({ value }));
        for (const loader of [new ConfigLoader(), new ConfigLoader({ env: {} })]) {
          expect(() => loader.loadYamlConfig(filename), name).to.throw('not set');
        }
      }
    }
  });

  it('accepts explicit special-name entries and preserves per-key process fallback and empty masking', () => {
    for (const name of names) {
      process.env[name] = 'process';
      const filename = files.write(
        'config.yaml',
        JSON.stringify({
          pure: '${' + name + '}',
          mixed: 'prefix ${' + name + '}',
          direct: { $env: name }
        })
      );
      const inherited = Object.create({ [name]: 'inherited' }) as NodeJS.ProcessEnv;
      for (const env of [{}, inherited, { [name]: undefined }]) {
        expect(new ConfigLoader({ env }).loadYamlConfig(filename), name).to.deep.equal({
          pure: 'process',
          mixed: 'prefix process',
          direct: 'process'
        });
      }

      expect(
        new ConfigLoader({ env: { [name]: 'own' } }).loadYamlConfig(filename),
        name
      ).to.deep.equal({ pure: 'own', mixed: 'prefix own', direct: 'own' });
      expect(
        () => new ConfigLoader({ env: { [name]: '' } }).loadYamlConfig(filename),
        name
      ).to.throw('not set');
      delete process.env[name];
    }
  });

  it('ignores inherited custom controls and still accepts explicit special-name controls', () => {
    files.write('config.yaml', 'value: base\n');
    files.write('config.production.yaml', 'value: production\n');
    for (const name of names) {
      const options = {
        basePath: files.directory,
        argv: [],
        env: {},
        envNameEnvVar: name,
        envOverrideObjectVar: name
      };
      expect(loadConfigLayersFromFiles(options), name).to.deep.equal({ value: 'base' });
      expect(readConfigObjectEnv(name, {}), name).to.equal(undefined);
      expect(
        loadConfigLayersFromFiles({
          ...options,
          envOverrideObjectVar: 'UNUSED',
          env: { [name]: 'production' }
        }),
        name
      ).to.deep.equal({ value: 'production' });
      expect(
        loadConfigLayersFromFiles({
          ...options,
          envName: 'test',
          env: { [name]: '{"value":"object"}' }
        }),
        name
      ).to.deep.equal({ value: 'object' });
      expect(
        loadConfigLayersFromFiles({
          argv: ['--config', files.write('selected.yaml', 'value: selected\n')],
          envName: 'test',
          configDirEnvVar: name,
          env: {}
        }),
        name
      ).to.deep.equal({ value: 'selected' });
      expect(
        loadConfigLayersFromFiles({
          argv: [],
          envName: 'test',
          configDirEnvVar: name,
          env: { [name]: files.directory }
        }),
        name
      ).to.deep.equal({ value: 'base' });
    }
  });

  it('ignores inherited application entries and controls without affecting cache identity', () => {
    delete process.env.OWN_ENV_VALUE;
    const filename = files.write('config.yaml', 'value: ${OWN_ENV_VALUE:-fallback}\n');
    const prototype = {
      OWN_ENV_VALUE: 'inherited',
      CONFIG: '{"value":"inherited-object"}',
      CONFIG_ENV: 'production'
    };
    const env = Object.create(prototype) as NodeJS.ProcessEnv;
    const options = { basePath: files.directory, argv: [], env };
    expect(new ConfigLoader({ env }).loadYamlConfig(filename)).to.deep.equal({ value: 'fallback' });
    const service = createConfigServiceFromFiles(options);
    expect(service.getString('value')).to.equal('fallback');
    prototype.OWN_ENV_VALUE = 'changed';
    expect(createConfigServiceFromFiles(options)).to.equal(service);
    process.env.OWN_ENV_VALUE = 'process';
    expect(createConfigServiceFromFiles(options).getString('value')).to.equal('process');
  });

  it('retains Windows process casing and exact supplied-map casing', () => {
    process.env.OWN_ENV_CASE = 'process';
    const filename = files.write('config.yaml', 'value: ${own_env_case:-fallback}\n');
    expect(new ConfigLoader().loadYamlConfig(filename).value).to.equal(
      process.platform === 'win32' ? 'process' : 'fallback'
    );
    expect(
      new ConfigLoader({ env: { OWN_ENV_CASE: 'map' } }).loadYamlConfig(filename).value
    ).to.equal(process.platform === 'win32' ? 'process' : 'fallback');
    expect(
      new ConfigLoader({ env: { own_env_case: 'own' } }).loadYamlConfig(filename).value
    ).to.equal('own');
  });
});
