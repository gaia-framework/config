import { expect } from 'chai';
import { z } from 'zod';
import {
  ConfigLoader,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles,
  resetConfigServiceCacheForTests
} from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('placeholder escaping and environment source isolation', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;
  beforeEach(() => {
    files = fixture();
  });
  afterEach(() => files.dispose());

  it('separates process and plain-map services in both call orders, retaining reuse within each source', () => {
    files.write('config.yaml', 'value: file\n');
    process.env.CONFIG_DIR = files.directory;
    const options = {
      basePath: files.directory,
      envName: 'test',
      argv: [],
      configDirEnvVar: 'config_dir'
    };
    const env = { ...process.env };
    const rawProcess = loadConfigLayersFromFiles(options);
    const rawMap = loadConfigLayersFromFiles({ ...options, env });
    expect(rawProcess).to.deep.equal(
      process.platform === 'win32' ? { value: 'file' } : { value: 'file', DIR: files.directory }
    );
    expect(rawMap).to.deep.equal({ value: 'file', DIR: files.directory });
    for (const mapFirst of [false, true]) {
      resetConfigServiceCacheForTests();
      if (mapFirst) {
        createConfigServiceFromFiles({ ...options, env });
      }

      const processService = createConfigServiceFromFiles(options);
      const mapService = createConfigServiceFromFiles({ ...options, env });
      expect(mapService).not.to.equal(processService);
      expect(processService.getString('value')).to.equal('file');
      expect(mapService.getString('value')).to.equal('file');
      expect(processService.getOptionalString('DIR')).to.equal(rawProcess.DIR);
      expect(mapService.getString('DIR')).to.equal(rawMap.DIR);
      expect(createConfigServiceFromFiles({ ...options, env: process.env })).to.equal(
        processService
      );
      expect(createConfigServiceFromFiles({ ...options, env: { ...env } })).to.equal(mapService);
    }
  });

  it('cannot bypass strict map validation using a process-environment cache entry', () => {
    files.write('config.yaml', 'value: file\n');
    process.env.CONFIG_DIR = files.directory;
    const options = {
      basePath: files.directory,
      envName: 'test',
      argv: [],
      configDirEnvVar: 'config_dir',
      schema: z.strictObject({ value: z.string() })
    };
    const env = { ...process.env };
    expect(() => loadConfigObjectFromFiles({ ...options, env })).to.throw('Invalid configuration:');
    if (process.platform === 'win32') {
      expect(createConfigServiceFromFiles(options).getString('value')).to.equal('file');
    } else {
      expect(() => createConfigServiceFromFiles(options)).to.throw('Invalid configuration:');
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => createConfigServiceFromFiles({ ...options, env })).to.throw(
        'Invalid configuration:'
      );
    }
  });

  it('preserves former marker text in plain strings, substitutions and fallbacks', () => {
    const marker = '__GAIA_ESC_OPEN__{literal}';
    const openMarker = '__GAIA_ESC_OPEN__{literal';
    const filename = files.write(
      'config.yaml',
      JSON.stringify({
        plain: marker,
        repeated: `${marker} ${marker}`,
        pure: '${ESCAPING_VALUE}',
        mixed: 'prefix ${ESCAPING_VALUE} suffix',
        fallback: '${ESCAPING_MISSING:-' + marker + '}',
        pureFallback: '${ESCAPING_MISSING:-' + openMarker + '}',
        escaped: '$${ESCAPING_MISSING} ' + marker
      })
    );
    const data = new ConfigLoader({
      env: { ESCAPING_VALUE: marker, ESCAPING_MISSING: '' }
    }).loadYamlConfig(filename);
    expect(data).to.deep.equal({
      plain: marker,
      repeated: `${marker} ${marker}`,
      pure: marker,
      mixed: `prefix ${marker} suffix`,
      fallback: marker,
      pureFallback: openMarker,
      escaped: '${ESCAPING_MISSING} ' + marker
    });
  });

  it('does not reinterpret environment values as escaped or active placeholders', () => {
    const value = '__GAIA_ESC_OPEN__{literal} $${KEEP} ${KEEP}';
    const filename = files.write(
      'config.yaml',
      JSON.stringify({
        pure: '${ESCAPING_VALUE}',
        mixed: 'prefix ${ESCAPING_VALUE}',
        direct: { $env: 'ESCAPING_VALUE' }
      })
    );
    expect(
      new ConfigLoader({ env: { ESCAPING_VALUE: value } }).loadYamlConfig(filename)
    ).to.deep.equal({ pure: value, mixed: `prefix ${value}`, direct: value });
  });

  it('preserves marker text in directive arguments and included values', () => {
    const marker = '__GAIA_ESC_OPEN__{literal}';
    files.write(`${marker}.txt`, 'synthetic text');
    files.write(`${marker}.json`, JSON.stringify({ value: marker }));
    const filename = files.write(
      'config.yaml',
      JSON.stringify({
        text: { $file: `./${marker}.txt` },
        included: { $include: `./${marker}.json#value` },
        direct: { $env: marker }
      })
    );
    expect(new ConfigLoader({ env: { [marker]: marker } }).loadYamlConfig(filename)).to.deep.equal({
      text: 'synthetic text',
      included: marker,
      direct: marker
    });
  });
});
