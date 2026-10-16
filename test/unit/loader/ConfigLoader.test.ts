import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as yaml from 'js-yaml';
import { ConfigLoader } from '../../../src/loader/ConfigLoader.js';

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-config-test-'));
}

function writeYamlFile(dir: string, name: string, value: any): string {
  const file = path.join(dir, name);
  const body = yaml.dump(value, { noRefs: true, lineWidth: -1 });
  fs.writeFileSync(file, body, 'utf8');

  return file;
}

function writeTextFile(dir: string, name: string, text: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, 'utf8');

  return file;
}

function writeJsonFile(dir: string, name: string, value: any): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');

  return file;
}

describe('ConfigLoader', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTempDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('loadYamlConfig', () => {
    it('returns {} if the file does not exist', () => {
      // Arrange
      const loader = new ConfigLoader();
      const missing = path.join(dir, 'missing.yaml');

      // Act
      const cfg = loader.loadYamlConfig(missing);

      // Assert
      expect(cfg).to.deep.equal({});
    });

    it('returns {} for an empty YAML file', () => {
      // Arrange
      const loader = new ConfigLoader();
      const file = writeTextFile(dir, 'config.yaml', '');

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg).to.deep.equal({});
    });

    it('returns {} when YAML root is null', () => {
      // Arrange
      const loader = new ConfigLoader();
      const file = writeTextFile(dir, 'config.yaml', 'null\n');

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg).to.deep.equal({});
    });

    it('throws if YAML root is not an object (array)', () => {
      // Arrange
      const loader = new ConfigLoader();
      const file = writeYamlFile(dir, 'config.yaml', ['a', 'b']);

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/Config root must be an object\/mapping/);
    });

    it('throws if YAML root is not an object (scalar)', () => {
      // Arrange
      const loader = new ConfigLoader();
      const file = writeTextFile(dir, 'config.yaml', 'hello\n');

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/Config root must be an object\/mapping/);
    });

    it('loads a simple YAML config and preserves YAML scalar types', () => {
      // Arrange
      const loader = new ConfigLoader();
      const obj = { foo: 'bar', num: 42, bool: true, arr: ['a', 'b'] };
      const file = writeYamlFile(dir, 'config.yaml', obj);

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg).to.deep.equal(obj);
    });
  });

  describe('env substitution', () => {
    it('substitutes env vars in pure placeholders', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', {
        foo: '${MY_ENV}',
        bar: '${MY_ENV:-fallback}'
      });
      const loader = new ConfigLoader({ env: { MY_ENV: 'hello' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.foo).to.equal('hello');
      expect(cfg.bar).to.equal('hello');
    });

    it('uses fallback when env is missing/empty', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { foo: '${MISSING:-fallback}' });

      // Force “missing” regardless of real process.env
      const loader = new ConfigLoader({ env: { MISSING: '' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.foo).to.equal('fallback');
    });

    it('throws when a required env var is missing/empty', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { foo: '${REQUIRED}' });
      const loader = new ConfigLoader({ env: { REQUIRED: '' } });

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/REQUIRED/);
    });

    it('supports quoted fallbacks and empty fallbacks', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', {
        a: '${X:-"abc"}',
        b: "${X:-'def'}",
        c: '${X:-}',
        d: '${X:-""}',
        e: "${X:-''}"
      });
      const loader = new ConfigLoader({ env: { X: '' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.a).to.equal('abc');
      expect(cfg.b).to.equal('def');
      expect(cfg.c).to.equal('');
      expect(cfg.d).to.equal('');
      expect(cfg.e).to.equal('');
    });

    it('escapes $${VAR} to literal ${VAR}', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { foo: '$${VAR}', bar: 'foo$${VAR}bar' });
      const loader = new ConfigLoader();

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.foo).to.equal('${VAR}');
      expect(cfg.bar).to.equal('foo${VAR}bar');
    });

    it('does mixed-string substitution but does not coerce the whole value', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { msg: 'hello ${NAME:-world}!' });
      const loader = new ConfigLoader({ env: { NAME: '' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.msg).to.equal('hello world!');
    });

    it('options.env takes precedence over process.env', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { v: '${PREF_TEST:-fallback}' });
      const original = process.env.PREF_TEST;
      process.env.PREF_TEST = 'fromProcess';

      try {
        const loader = new ConfigLoader({ env: { PREF_TEST: 'fromOptions' } });

        // Act
        const cfg = loader.loadYamlConfig(file);

        // Assert
        expect(cfg.v).to.equal('fromOptions');
      } finally {
        if (original === undefined) {
          delete process.env.PREF_TEST;
        } else {
          process.env.PREF_TEST = original;
        }
      }
    });

    it('empty string in options.env is treated as missing (and does not fall back to process.env)', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { v: '${EMPTY_PREF:-fallback}' });
      const original = process.env.EMPTY_PREF;
      process.env.EMPTY_PREF = 'fromProcess';

      try {
        const loader = new ConfigLoader({ env: { EMPTY_PREF: '' } });

        // Act
        const cfg = loader.loadYamlConfig(file);

        // Assert
        expect(cfg.v).to.equal('fallback');
      } finally {
        if (original === undefined) {
          delete process.env.EMPTY_PREF;
        } else {
          process.env.EMPTY_PREF = original;
        }
      }
    });
  });

  describe('boolean coercion (pure placeholder only)', () => {
    it('coerces to booleans when fallback is boolean', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', {
        flagA: '${BOOL_ENV:-true}',
        flagB: '${BOOL_ENV:-false}'
      });

      // Act 1: env missing -> fallback used (boolean)
      const loader1 = new ConfigLoader({ env: { BOOL_ENV: '' } });
      const cfg1 = loader1.loadYamlConfig(file);

      // Assert 1
      expect(cfg1.flagA).to.equal(true);
      expect(cfg1.flagB).to.equal(false);

      // Act 2: env set -> env parsed as boolean
      const loader2 = new ConfigLoader({ env: { BOOL_ENV: 'false' } });
      const cfg2 = loader2.loadYamlConfig(file);

      // Assert 2
      expect(cfg2.flagA).to.equal(false);
      expect(cfg2.flagB).to.equal(false);
    });

    it('throws if env is not "true"/"false" when fallback is boolean', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { flag: '${BOOL_ENV:-true}' });
      const loader = new ConfigLoader({ env: { BOOL_ENV: 'notabool' } });

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/must be "true" or "false"/);
    });

    it('does NOT coerce if there is no boolean fallback', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { flag: '${BOOL_ENV}' });
      const loader = new ConfigLoader({ env: { BOOL_ENV: 'true' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.flag).to.equal('true'); // string
    });

    it('does NOT coerce mixed strings even if fallback is boolean', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { msg: 'flag=${BOOL_ENV:-true}' });
      const loader = new ConfigLoader({ env: { BOOL_ENV: '' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.msg).to.equal('flag=true'); // string, not boolean
    });

    it('parses boolean values case-insensitively and trims whitespace', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { flag: '${BOOL_ENV:-false}' });
      const loader = new ConfigLoader({ env: { BOOL_ENV: '  TRUE  ' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.flag).to.equal(true);
    });
  });

  describe('$env directive', () => {
    it('resolves $env directive', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { secret: { $env: 'MY_SECRET' } });
      const loader = new ConfigLoader({ env: { MY_SECRET: 'shhh' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.secret).to.equal('shhh');
    });

    it('throws if $env is missing/empty', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { secret: { $env: 'NOT_SET' } });
      const loader = new ConfigLoader({ env: { NOT_SET: '' } });

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/\$env "NOT_SET"/);
    });

    it('supports env substitution in $env name', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { secret: { $env: '${ENV_NAME}' } });
      const loader = new ConfigLoader({ env: { ENV_NAME: 'MY_SECRET', MY_SECRET: 'value' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.secret).to.equal('value');
    });

    it('throws if $env directive value is not a string', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { secret: { $env: 123 } });

      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/\$env directive must be a string/);
    });
  });

  describe('$file directive', () => {
    it('resolves $file directive', () => {
      // Arrange
      writeTextFile(dir, 'secret.txt', 'supersecret');
      const file = writeYamlFile(dir, 'config.yaml', { secret: { $file: './secret.txt' } });
      const loader = new ConfigLoader();

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.secret).to.equal('supersecret');
    });

    it('throws if $file is missing', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { secret: { $file: './missing.txt' } });
      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/\$file not found/);
    });

    it('supports env substitution in $file path', () => {
      // Arrange
      writeTextFile(dir, 'secret.txt', 'supersecret');
      const file = writeYamlFile(dir, 'config.yaml', { secret: { $file: './${FILENAME}' } });
      const loader = new ConfigLoader({ env: { FILENAME: 'secret.txt' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.secret).to.equal('supersecret');
    });

    it('throws if $file directive value is not a string', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { secret: { $file: { nope: true } } });
      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/\$file directive must be a string/);
    });
  });

  describe('$include directive', () => {
    it('includes an entire YAML file', () => {
      // Arrange
      const includedObj = { foo: 'bar', baz: 123 };
      writeYamlFile(dir, 'included.yaml', includedObj);

      const file = writeYamlFile(dir, 'config.yaml', { data: { $include: './included.yaml' } });
      const loader = new ConfigLoader();

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.data).to.deep.equal(includedObj);
    });

    it('includes an entire JSON file', () => {
      // Arrange
      const includedObj = { foo: 'bar', baz: 123 };
      writeJsonFile(dir, 'included.json', includedObj);

      const file = writeYamlFile(dir, 'config.yaml', { data: { $include: './included.json' } });
      const loader = new ConfigLoader();

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.data).to.deep.equal(includedObj);
    });

    it('throws if included file does not exist', () => {
      // Arrange
      const file = writeYamlFile(dir, 'config.yaml', { data: { $include: './nope.yaml' } });
      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/\$include not found/);
    });

    it('supports env substitution in $include path', () => {
      // Arrange
      writeYamlFile(dir, 'included.yaml', { x: 1 });

      const file = writeYamlFile(dir, 'config.yaml', { data: { $include: './${NAME}.yaml' } });
      const loader = new ConfigLoader({ env: { NAME: 'included' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.data).to.deep.equal({ x: 1 });
    });

    it('resolves a fragment path (object path)', () => {
      // Arrange
      writeYamlFile(dir, 'included.yaml', { a: { b: { c: 42 } } });

      const file = writeYamlFile(dir, 'config.yaml', {
        value: { $include: './included.yaml#a.b.c' }
      });
      const loader = new ConfigLoader();

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.value).to.equal(42);
    });

    it('resolves a fragment path (array index)', () => {
      // Arrange
      writeYamlFile(dir, 'included.yaml', { arr: ['foo', 'bar'] });

      const file = writeYamlFile(dir, 'config.yaml', {
        value: { $include: './included.yaml#arr.1' }
      });
      const loader = new ConfigLoader();

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.value).to.equal('bar');
    });

    it('throws on fragment not found (single segment)', () => {
      // Arrange
      writeYamlFile(dir, 'included.yaml', { foo: 'bar' });

      const file = writeYamlFile(dir, 'config.yaml', {
        value: { $include: './included.yaml#notfound' }
      });
      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/fragment not found/);
    });

    it('throws on fragment not found (nested segment)', () => {
      // Arrange
      writeYamlFile(dir, 'included.yaml', { a: { b: { c: 1 } } });

      const file = writeYamlFile(dir, 'config.yaml', {
        value: { $include: './included.yaml#a.b.missing' }
      });
      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/fragment not found/);
    });

    it('throws on fragment index not found', () => {
      // Arrange
      writeYamlFile(dir, 'included.yaml', { arr: ['foo'] });

      const file = writeYamlFile(dir, 'config.yaml', {
        value: { $include: './included.yaml#arr.9' }
      });
      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/fragment index not found/);
    });

    it('throws on $include cycle', () => {
      // Arrange
      writeYamlFile(dir, 'a.yaml', { b: { $include: './b.yaml' } });
      writeYamlFile(dir, 'b.yaml', { a: { $include: './a.yaml' } });

      const file = writeYamlFile(dir, 'config.yaml', { data: { $include: './a.yaml' } });
      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/cycle detected/);
    });

    it('throws on unsupported extension', () => {
      // Arrange
      writeTextFile(dir, 'included.txt', 'foo: bar');

      const file = writeYamlFile(dir, 'config.yaml', { data: { $include: './included.txt' } });
      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/only supports \.yaml\/\.yml\/\.json/);
    });

    it('resolves include paths relative to the source file directory', () => {
      // Arrange
      const sub = path.join(dir, 'sub');
      fs.mkdirSync(sub);

      // included.yaml lives one directory up (dir/)
      writeYamlFile(dir, 'included.yaml', { ok: true });

      // config.yaml lives in sub/ and includes ../included.yaml
      const configPath = writeYamlFile(sub, 'config.yaml', {
        data: { $include: '../included.yaml' }
      });

      const loader = new ConfigLoader();

      // Act
      const cfg = loader.loadYamlConfig(configPath);

      // Assert
      expect(cfg.data).to.deep.equal({ ok: true });
    });

    it('reads the same include file only once per loader instance (cache)', () => {
      // Arrange
      writeYamlFile(dir, 'included.yaml', { x: 1 });
      const file = writeYamlFile(dir, 'config.yaml', {
        a: { $include: './included.yaml' },
        b: { $include: './included.yaml' }
      });

      const loader = new ConfigLoader();
      const sandbox = sinon.createSandbox();
      const spy = sandbox.spy(fs, 'readFileSync');

      try {
        // Act
        const cfg = loader.loadYamlConfig(file);

        // Assert (content)
        expect(cfg.a).to.deep.equal({ x: 1 });
        expect(cfg.b).to.deep.equal({ x: 1 });

        // Assert (cache): included.yaml should be read once (config.yaml itself is also read once)
        const includeReads = spy
          .getCalls()
          .filter((c) => String(c.args[0]).endsWith(path.sep + 'included.yaml'));
        expect(includeReads.length).to.equal(1);
      } finally {
        sandbox.restore();
      }
    });
  });

  describe('combined/nested behavior', () => {
    it('handles nested includes with env interpolation inside included file', () => {
      // Arrange
      writeYamlFile(dir, 'secret.yaml', { value: '${SECRET_ENV:-default}' });
      const file = writeYamlFile(dir, 'config.yaml', { nested: { $include: './secret.yaml' } });

      const loader = new ConfigLoader({ env: { SECRET_ENV: 'supersecret' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.nested.value).to.equal('supersecret');
    });

    it('handles arrays containing directives ($env, $file, $include)', () => {
      // Arrange
      writeTextFile(dir, 'file.txt', 'fileval');
      writeYamlFile(dir, 'frag.yaml', { x: 'fragval' });

      const file = writeYamlFile(dir, 'config.yaml', {
        arr: [{ $env: 'FOO' }, { $file: './file.txt' }, { $include: './frag.yaml#x' }]
      });

      const loader = new ConfigLoader({ env: { FOO: 'bar' } });

      // Act
      const cfg = loader.loadYamlConfig(file);

      // Assert
      expect(cfg.arr).to.deep.equal(['bar', 'fileval', 'fragval']);
    });

    it('throws if the root resolves to a non-object (root $include -> scalar)', () => {
      // Arrange
      writeTextFile(dir, 'included.yaml', 'hello\n');

      // Root itself is a directive object: { $include: "./included.yaml" }
      const file = writeYamlFile(dir, 'config.yaml', { $include: './included.yaml' });

      const loader = new ConfigLoader();

      // Act + Assert
      expect(() => loader.loadYamlConfig(file)).to.throw(/Config root must resolve to an object/);
    });
  });
});
