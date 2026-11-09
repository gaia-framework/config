import { expect } from 'chai';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ConfigLoader, ConfigReader, loadConfigObjectFromFiles } from '../../src/index.js';
import { z } from 'zod';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('additional supported contracts', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;
  beforeEach(() => {
    files = fixture();
  });
  afterEach(() => files.dispose());
  it('falls back per placeholder to process env when supplied map omits a value', () => {
    process.env.CONTRACT_LABEL = 'process';
    const filename = files.write(
      'config.yaml',
      'a: ${CONTRACT_LABEL}\nb: {$env: CONTRACT_LABEL}\n'
    );
    expect(new ConfigLoader({ env: {} }).loadYamlConfig(filename)).to.deep.equal({
      a: 'process',
      b: 'process'
    });
    expect(() =>
      new ConfigLoader({ env: { CONTRACT_LABEL: '' } }).loadYamlConfig(filename)
    ).to.throw();
  });
  it('preserves invalid quoted-fallback normalization and rejects required variables in mixed strings', () => {
    const filename = files.write(
      'config.yaml',
      JSON.stringify({ value: '${CONTRACT_ABSENT:-"a\\q"}' })
    );
    expect(
      new ConfigLoader({ env: { CONTRACT_ABSENT: '' } }).loadYamlConfig(filename).value
    ).to.equal('a\\q');
    files.write('config.yaml', 'value: prefix ${CONTRACT_ABSENT}');
    expect(() =>
      new ConfigLoader({ env: { CONTRACT_ABSENT: '' } }).loadYamlConfig(filename)
    ).to.throw('referenced in config but not set');
  });
  it('rejects null/undefined fragment traversal and an undefined final fragment', () => {
    files.write('empty.yml', '');
    files.write('null.json', 'null');
    files.write('nested.yml', 'value: {$include: "empty.yml"}');
    for (const selection of [
      'null.json#child',
      'empty.yml#child',
      'nested.yml#value',
      'nested.yml#value.child'
    ]) {
      const filename = files.write(
        'config.yaml',
        JSON.stringify({ value: { $include: selection } })
      );
      expect(() => new ConfigLoader().loadYamlConfig(filename), selection).to.throw(
        '$include fragment not found'
      );
    }
  });
  it('retains cached missing results, invalid array traversal and no deep defensive cloning', () => {
    const data: Record<string, any> = { arr: ['a'], scalar: true, nil: null };
    const reader = new ConfigReader(data);
    expect(reader.getOptional('later')).to.equal(undefined);
    data.later = 'new';
    expect(reader.getOptional('later')).to.equal(undefined);
    expect(reader.get('arr')).to.equal(data.arr);
    for (const key of ['arr.0.child', 'arr.1', 'arr.-1', 'arr.0.1', 'scalar.child', 'nil.child']) {
      expect(reader.has(key)).to.equal(false);
    }

    expect(new ConfigReader({ n: NaN }).getNumber('n')).to.satisfy(Number.isNaN);
    expect(new ConfigReader({ n: Infinity }).getNumber('n')).to.equal(Infinity);
  });
  it('rejects file schema failures after load and does not resolve directives in override objects', () => {
    files.write('config.yaml', 'value: false\n');
    expect(() =>
      loadConfigObjectFromFiles({
        basePath: files.directory,
        argv: [],
        env: {},
        schema: z.object({ value: z.string() })
      })
    ).to.throw('Invalid configuration:\nvalue:');
    expect(
      loadConfigObjectFromFiles({
        basePath: files.directory,
        argv: [],
        env: { CONFIG: '{"value":{"$env":"MISSING_VARIABLE"}}' }
      })
    ).to.deep.equal({ value: { $env: 'MISSING_VARIABLE' } });
  });
  it('does not load local .env files when importing the package in any environment', () => {
    files.write('.env', 'CONTRACT_DOTENV=synthetic\n');
    const root = new URL('../../src/index.js', import.meta.url).href;
    const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    // Compiled checks must execute the emitted JS without a second transformation.
    const importArguments = import.meta.url.endsWith('.ts') ? ['--import', loader] : [];

    for (const nodeEnv of ['development', 'test', 'production']) {
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: nodeEnv };

      delete env.CONTRACT_DOTENV;

      const script = files.write(
        'run.ts',
        `import ${JSON.stringify(root)}; console.log('RESULT:' + JSON.stringify(process.env.CONTRACT_DOTENV === 'synthetic'));`
      );
      const result = spawnSync(process.execPath, [...importArguments, script], {
        cwd: files.directory,
        env,
        encoding: 'utf8'
      });

      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout.trim().split('\n').at(-1)).to.equal('RESULT:false');
    }
  });
});
