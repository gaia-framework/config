import { expect } from 'chai';
import { z } from 'zod';
import {
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles,
  resetConfigServiceCacheForTests
} from '../../src/index.js';
import type { LoadConfigOptions } from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('configuration cache and control-variable isolation', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;
  beforeEach(() => {
    files = fixture();
    files.write('config.yaml', 'value: file\n');
  });
  afterEach(() => files.dispose());

  function options(extra: LoadConfigOptions = {}): LoadConfigOptions {
    return { basePath: files.directory, argv: [], env: {}, ...extra };
  }

  it('validates each distinct schema even after an unvalidated or differently validated cache entry', () => {
    const base = options();
    const unvalidated = createConfigServiceFromFiles(base);
    const firstSchema = z.object({ value: z.string().transform((value) => `first:${value}`) });
    const secondSchema = z.object({ value: z.string().transform((value) => `second:${value}`) });
    const first = createConfigServiceFromFiles({ ...base, schema: firstSchema });
    const second = createConfigServiceFromFiles({ ...base, schema: secondSchema });
    expect(first.getString('value')).to.equal('first:file');
    expect(second.getString('value')).to.equal('second:file');
    expect(first).not.to.equal(unvalidated);
    expect(second).not.to.equal(first);
    expect(createConfigServiceFromFiles({ ...base, schema: firstSchema })).to.equal(first);
    const rejected = z.never();
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => createConfigServiceFromFiles({ ...base, schema: rejected })).to.throw(
        'Invalid configuration:'
      );
    }

    expect(createConfigServiceFromFiles(base)).to.equal(unvalidated);
  });

  it('snapshots caller-supplied environments, including mutation of the same environment object', () => {
    const env = { CONFIG_value: 'first' };
    const first = createConfigServiceFromFiles(options({ env }));
    env.CONFIG_value = 'second';
    const second = createConfigServiceFromFiles(options({ env }));
    expect(second).not.to.equal(first);
    expect(second.getString('value')).to.equal('second');
    env.CONFIG_value = 'first';
    expect(createConfigServiceFromFiles(options({ env: { ...env } }))).to.equal(first);
    expect(
      createConfigServiceFromFiles(
        options({
          env,
          fileBaseName: 'config',
          configDirEnvVar: 'CONFIG_DIR',
          envNameEnvVar: 'CONFIG_ENV',
          envOverrideObjectVar: 'CONFIG',
          envOverridePrefix: 'CONFIG_'
        })
      )
    ).to.equal(first);
  });

  it('isolates changed process overrides when no environment map is supplied', () => {
    const base = { basePath: files.directory, argv: [] };
    process.env.CONFIG_value = 'first';
    const first = createConfigServiceFromFiles(base);
    process.env.CONFIG_value = 'second';
    const second = createConfigServiceFromFiles(base);
    expect(second.getString('value')).to.equal('second');
    expect(second).not.to.equal(first);
  });

  it('tracks process fallback for placeholders, while an explicit value masks that fallback', () => {
    files.write('config.yaml', 'value: ${CACHE_FALLBACK_VALUE:-missing}\n');
    process.env.CACHE_FALLBACK_VALUE = 'first';
    const first = createConfigServiceFromFiles(options());
    process.env.CACHE_FALLBACK_VALUE = 'second';
    const second = createConfigServiceFromFiles(options());
    expect(second).not.to.equal(first);
    expect(second.getString('value')).to.equal('second');
    const explicit = options({ env: { CACHE_FALLBACK_VALUE: 'explicit' } });
    const masked = createConfigServiceFromFiles(explicit);
    process.env.CACHE_FALLBACK_VALUE = 'third';
    const afterProcessChange = createConfigServiceFromFiles(explicit);
    expect(afterProcessChange.getString('value')).to.equal('explicit');
    // Windows may still consume that process value through a differently cased name.
    if (process.platform === 'win32') {
      expect(afterProcessChange).not.to.equal(masked);
    } else {
      expect(afterProcessChange).to.equal(masked);
    }

    const undefinedEntry = createConfigServiceFromFiles(
      options({ env: { CACHE_FALLBACK_VALUE: undefined } })
    );
    expect(undefinedEntry.getString('value')).to.equal('third');
    const emptyEntry = createConfigServiceFromFiles(options({ env: { CACHE_FALLBACK_VALUE: '' } }));
    expect(emptyEntry.getString('value')).to.equal('missing');
  });

  it('partitions whole-object variable names and key prefixes even with identical environment entries', () => {
    const env = {
      FIRST: '{"value":"first"}',
      SECOND: '{"value":"second"}',
      A_value: 'a',
      B_value: 'b'
    };
    const first = createConfigServiceFromFiles(
      options({ env, envOverrideObjectVar: 'FIRST', envOverridePrefix: 'UNUSED_' })
    );
    const second = createConfigServiceFromFiles(
      options({ env, envOverrideObjectVar: 'SECOND', envOverridePrefix: 'UNUSED_' })
    );
    expect(first.getString('value')).to.equal('first');
    expect(second.getString('value')).to.equal('second');
    expect(second).not.to.equal(first);
    const a = createConfigServiceFromFiles(options({ env, envOverridePrefix: 'A_' }));
    const b = createConfigServiceFromFiles(options({ env, envOverridePrefix: 'B_' }));
    expect(a.getString('value')).to.equal('a');
    expect(b.getString('value')).to.equal('b');
    expect(a).not.to.equal(b);
  });

  it('rechecks process fallback for $env directives, including removal after a successful cached load', () => {
    files.write('config.yaml', 'value: {$env: CACHE_DIRECT_VALUE}\n');
    process.env.CACHE_DIRECT_VALUE = 'first';
    const first = createConfigServiceFromFiles(options());
    process.env.CACHE_DIRECT_VALUE = 'second';
    const second = createConfigServiceFromFiles(options());
    expect(second.getString('value')).to.equal('second');
    expect(second).not.to.equal(first);
    delete process.env.CACHE_DIRECT_VALUE;
    expect(() => createConfigServiceFromFiles(options())).to.throw('required but not set');
  });

  it('preserves override enumeration order in cache isolation for conflicting paths', () => {
    const first = createConfigServiceFromFiles(
      options({ env: { CONFIG_nested: '1', CONFIG_nested_value: '2' } })
    );
    const second = createConfigServiceFromFiles(
      options({ env: { CONFIG_nested_value: '2', CONFIG_nested: '1' } })
    );
    expect(first.get('nested')).to.deep.equal({ value: 2 });
    expect(second.get('nested')).to.equal(1);
    expect(second).not.to.equal(first);
  });

  it('resets both schema-bound and schema-free caches under the existing test guard', () => {
    const schema = z.object({ value: z.string() });
    const first = createConfigServiceFromFiles(options());
    const validated = createConfigServiceFromFiles({ ...options(), schema });
    expect(createConfigServiceFromFiles({ ...options(), schema })).to.equal(validated);
    resetConfigServiceCacheForTests();
    expect(createConfigServiceFromFiles(options())).not.to.equal(first);
    expect(createConfigServiceFromFiles({ ...options(), schema })).not.to.equal(validated);
  });

  it('uses neutral controls for discovery without leaking them into raw or strict-schema data', () => {
    files.write('config.production.yaml', 'value: production\n');
    const base = { argv: [], env: { CONFIG_DIR: files.directory, CONFIG_ENV: 'production' } };
    expect(loadConfigLayersFromFiles(base)).to.deep.equal({ value: 'production' });
    expect(
      loadConfigObjectFromFiles({ ...base, schema: z.strictObject({ value: z.string() }) })
    ).to.deep.equal({ value: 'production' });
    expect(createConfigServiceFromFiles(base).keys()).to.deep.equal(['value']);
  });

  it('excludes exact custom controls and a prefixed whole-object control, retaining normal overrides', () => {
    const base = {
      argv: [],
      configDirEnvVar: 'APP_DIRECTORY',
      envNameEnvVar: 'APP_ENVIRONMENT',
      envOverrideObjectVar: 'APP_CONFIG',
      envOverridePrefix: 'APP_',
      env: {
        APP_DIRECTORY: files.directory,
        APP_ENVIRONMENT: 'production',
        APP_CONFIG: '{"value":"object"}',
        APP_value: 'key',
        APP_DIRECTORY_child: 'legitimate'
      }
    };
    expect(loadConfigLayersFromFiles(base)).to.deep.equal({
      value: 'key',
      DIRECTORY: { child: 'legitimate' }
    });
    expect(
      loadConfigLayersFromFiles(
        options({ envOverridePrefix: 'NODE_', env: { NODE_ENV: 'production', NODE_value: 'key' } })
      )
    ).to.deep.equal({ value: 'key' });
  });

  it('retains explicitly configured DIR/ENV keys and treats unselected control names as normal data', () => {
    files.write('config.yaml', 'value: file\nDIR: file-directory\nENV: file-environment\n');
    const env = {
      CONFIG_DIR: files.directory,
      CONFIG_ENV: 'production',
      CONFIG: '{"DIR":"object-directory"}'
    };
    expect(loadConfigLayersFromFiles(options({ env }))).to.deep.equal({
      value: 'file',
      DIR: 'object-directory',
      ENV: 'file-environment'
    });
    const selected = createConfigServiceFromFiles(options({ env, envName: 'production' }));
    const unselected = createConfigServiceFromFiles(
      options({ env, envName: 'production', configDirEnvVar: 'APP_DIR', envNameEnvVar: 'APP_ENV' })
    );
    expect(unselected.getString('DIR')).to.equal(files.directory);
    expect(unselected.getString('ENV')).to.equal('production');
    expect(selected.getString('DIR')).to.equal('object-directory');
    expect(unselected).not.to.equal(selected);
  });

  it('keeps custom naming options without introducing a DIR property', () => {
    const config = loadConfigLayersFromFiles({
      argv: [],
      configDirEnvVar: 'SERVICE_CONFIG_DIR',
      envNameEnvVar: 'SERVICE_ENV',
      envOverrideObjectVar: 'SERVICE_CONFIG',
      envOverridePrefix: 'SERVICE_CONFIG_',
      env: {
        SERVICE_CONFIG_DIR: files.directory,
        SERVICE_ENV: 'production',
        SERVICE_CONFIG_value: 'key'
      }
    });
    expect(config).to.deep.equal({ value: 'key' });
  });
});
