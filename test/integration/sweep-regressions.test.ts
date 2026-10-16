import { expect } from 'chai';
import { z } from 'zod';
import {
  ConfigLoader,
  ConfigReader,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles
} from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('full-sweep regressions', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;
  beforeEach(() => {
    files = fixture();
  });
  afterEach(() => files.dispose());

  function hidden(name: string, value: string | undefined): NodeJS.ProcessEnv {
    return Object.defineProperty({}, name, { value, writable: true, configurable: true });
  }

  it('tracks non-enumerable placeholder and directive values, including deletion and empty/undefined fallback', () => {
    files.write('config.yaml', 'value: ${SWEEP_HIDDEN:-fallback}\ndirect: {$env: SWEEP_HIDDEN}\n');
    process.env.SWEEP_HIDDEN = 'process';
    const env = hidden('SWEEP_HIDDEN', 'first');
    const options = { basePath: files.directory, argv: [], env };
    const first = createConfigServiceFromFiles(options);
    expect(first.getString('value')).to.equal('first');
    expect(first.getString('direct')).to.equal('first');
    env.SWEEP_HIDDEN = 'second';
    const second = createConfigServiceFromFiles(options);
    expect(second).not.to.equal(first);
    expect(second.getString('value')).to.equal('second');
    expect(second.getString('direct')).to.equal('second');
    expect(
      createConfigServiceFromFiles({ ...options, env: hidden('SWEEP_HIDDEN', 'second') })
    ).to.equal(second);
    env.SWEEP_HIDDEN = undefined;
    expect(createConfigServiceFromFiles(options).getString('value')).to.equal('process');
    env.SWEEP_HIDDEN = '';
    expect(() => createConfigServiceFromFiles(options)).to.throw('required but not set');
    delete env.SWEEP_HIDDEN;
    expect(createConfigServiceFromFiles(options).getString('direct')).to.equal('process');
  });

  it('cannot reuse successful validation after hidden values change or hidden JSON becomes malformed', () => {
    files.write('config.yaml', 'value: ${SWEEP_HIDDEN:-fallback}\n');
    const env = hidden('SWEEP_HIDDEN', 'allowed');
    const options = {
      basePath: files.directory,
      argv: [],
      env,
      schema: z.object({ value: z.literal('allowed') })
    };
    createConfigServiceFromFiles(options);
    env.SWEEP_HIDDEN = 'rejected';
    expect(() => loadConfigObjectFromFiles(options)).to.throw('Invalid configuration:');
    expect(() => createConfigServiceFromFiles(options)).to.throw('Invalid configuration:');
    files.write('object.yaml', 'value: file\n');
    const objectEnv = hidden('CONFIG', '{"value":"first"}');
    const objectOptions = {
      basePath: files.directory,
      argv: ['--config', 'object.yaml'],
      env: objectEnv
    };
    expect(createConfigServiceFromFiles(objectOptions).getString('value')).to.equal('first');
    objectEnv.CONFIG = '{"value":"second"}';
    expect(createConfigServiceFromFiles(objectOptions).getString('value')).to.equal('second');
    objectEnv.CONFIG = '{';
    expect(() => createConfigServiceFromFiles(objectOptions)).to.throw(
      'CONFIG must be valid JSON object:'
    );
  });

  it('keeps path overrides enumerable and snapshots changes to enumerability and ordering', () => {
    files.write('config.yaml', 'value: file\n');
    const env = hidden('CONFIG_value', 'override');
    const options = { basePath: files.directory, argv: [], env };
    const hiddenService = createConfigServiceFromFiles(options);
    expect(hiddenService.getString('value')).to.equal('file');
    Object.defineProperty(env, 'CONFIG_value', { enumerable: true });
    expect(createConfigServiceFromFiles(options).getString('value')).to.equal('override');
    Object.defineProperty(env, 'CONFIG_value', { enumerable: false });
    expect(createConfigServiceFromFiles(options)).to.equal(hiddenService);
    expect(
      createConfigServiceFromFiles({
        ...options,
        env: { CONFIG_parent: '1', CONFIG_parent_child: '2' }
      }).get('parent')
    ).to.deep.equal({ child: 2 });
    expect(
      createConfigServiceFromFiles({
        ...options,
        env: { CONFIG_parent_child: '2', CONFIG_parent: '1' }
      }).get('parent')
    ).to.equal(1);
  });

  it('tracks hidden discovery controls using custom names', () => {
    files.write('config.test.yaml', 'value: test\n');
    files.write('config.production.yaml', 'value: production\n');
    const env = hidden('APP_DIR', files.directory);
    Object.defineProperty(env, 'APP_ENV', { value: 'test', writable: true });
    const options = { argv: [], env, configDirEnvVar: 'APP_DIR', envNameEnvVar: 'APP_ENV' };
    expect(createConfigServiceFromFiles(options).getString('value')).to.equal('test');
    env.APP_ENV = 'production';
    expect(createConfigServiceFromFiles(options).getString('value')).to.equal('production');
  });

  it('tracks process fallback through differently cased names even when an exact map name masks it', () => {
    files.write('config.yaml', 'value: ${sweep_case_value:-fallback}\n');
    delete process.env.sweep_case_value;
    process.env.SWEEP_CASE_VALUE = 'first';
    const options = { basePath: files.directory, argv: [], env: { SWEEP_CASE_VALUE: 'explicit' } };
    const first = createConfigServiceFromFiles(options);
    expect(first.getString('value')).to.equal(process.platform === 'win32' ? 'first' : 'fallback');
    process.env.SWEEP_CASE_VALUE = 'second';
    const second = createConfigServiceFromFiles(options);
    expect(second.getString('value')).to.equal(
      process.platform === 'win32' ? 'second' : 'fallback'
    );
    expect(second.getString('value')).to.equal(
      (loadConfigObjectFromFiles(options) as { value: string }).value
    );
    if (process.platform === 'win32') {
      expect(second).not.to.equal(first);
    } else {
      expect(second).to.equal(first);
    }
  });

  it('treats comment-only and empty documents as empty layers and undefined includes', () => {
    const emptyDocuments = [
      '# comment\n',
      '\uFEFF # comment\r\n',
      '---\n',
      '--- # comment\n...\n',
      '...\n',
      '%YAML 1.2\n---\n'
    ];
    for (const content of emptyDocuments) {
      const filename = files.write('empty.yaml', content);
      expect(new ConfigLoader().loadYamlConfig(filename), content).to.deep.equal({});
      files.write('config.yaml', 'value: kept\nfragment: {$include: ./empty.yaml}\n');
      expect(
        loadConfigLayersFromFiles({ basePath: files.directory, argv: [], env: {} }),
        content
      ).to.deep.equal({ value: 'kept' });
      expect(
        new ConfigLoader().loadYamlConfig(
          files.write('include.yaml', 'fragment: {$include: ./empty.yaml}\n')
        ).fragment,
        content
      ).to.equal(undefined);
    }
  });

  it('preserves explicit empty scalar includes and rejects scalar roots, malformed and multiple documents', () => {
    for (const content of ['""\n', "''\n", '|\n', '--- ""\n', '!!str\n']) {
      files.write('scalar.yaml', content);
      expect(
        () => new ConfigLoader().loadYamlConfig(files.write('root.yaml', content)),
        content
      ).to.throw('Config root must be an object/mapping:');
      expect(
        new ConfigLoader().loadYamlConfig(
          files.write('include.yaml', 'value: {$include: ./scalar.yaml}\n')
        ).value,
        content
      ).to.equal('');
    }

    for (const content of ['bad: [', '---\n---\n', '%YAML invalid\n---\n']) {
      const filename = files.write('bad.yaml', content);
      expect(() => new ConfigLoader().loadYamlConfig(filename), content).to.throw();
      expect(
        () =>
          new ConfigLoader().loadYamlConfig(
            files.write('include.yaml', 'value: {$include: ./bad.yaml}\n')
          ),
        content
      ).to.throw();
    }
  });

  it('characterizes retained empty/dotted paths and sparse in-memory string arrays', () => {
    const data = { a: { b: 'nested' }, 'a.b': 'literal', sparse: new Array<string>(2) };
    const reader = new ConfigReader(data);
    expect(reader.get('')).to.equal(data);
    expect(reader.get('...')).to.equal(data);
    expect(reader.getString('.a..b.')).to.equal('nested');
    expect(reader.keys().filter((key) => key === 'a.b')).to.have.length(2);
    expect(reader.getStringArray('sparse')).to.equal(data.sparse);
  });
});
