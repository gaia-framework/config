import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  ConfigError,
  ConfigLoader,
  ConfigReader,
  createConfigServiceFromFiles,
  resetConfigServiceCacheForTests
} from '../../src/index.js';
import { canonicalPath } from '../../src/loader/canonicalPath.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('Behavior-preserving loader and reader optimizations', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;

  beforeEach(() => {
    files = fixture();
  });

  afterEach(() => {
    sinon.restore();
    files.dispose();
  });

  function options() {
    return { basePath: files.directory, argv: [], env: {}, inheritProcessEnv: false };
  }

  describe('native canonical paths with legacy fallback', () => {
    it('uses the native resolver for real files with spaces and Unicode', () => {
      const filename = files.write('space Ã¼nicode/config.yaml', 'value: synthetic');
      const expected = fs.realpathSync(filename);
      const native = sinon.spy(fs.realpathSync, 'native');

      expect(canonicalPath(filename)).equal(expected);
      expect(native.calledOnceWithExactly(filename)).equal(true);
    });

    it('falls back when native resolution fails or is unavailable', () => {
      const filename = files.write('config.yaml', 'value: synthetic');
      const expected = fs.realpathSync(filename);
      const native = sinon.stub(fs.realpathSync, 'native').throws(new Error('native unavailable'));

      expect(canonicalPath(filename)).equal(expected);
      native.restore();
      const fallback = sinon.stub(fs, 'realpathSync').returns(expected);
      Object.assign(fallback, { native: undefined });

      expect(canonicalPath(filename)).equal(expected);
      expect(fallback.calledOnceWithExactly(filename)).equal(true);
    });

    it('retains the legacy error object if both resolvers fail', () => {
      const expected = new Error('synthetic legacy failure');
      const native = sinon.stub().throws(new Error('synthetic native failure'));
      const fallback = sinon.stub(fs, 'realpathSync').throws(expected);
      Object.assign(fallback, { native });

      expect(() => canonicalPath('synthetic')).to.throw(expected);
      expect(native.calledOnceWithExactly('synthetic')).equal(true);
      expect(fallback.calledOnceWithExactly('synthetic')).equal(true);
    });

    it('preserves canonical spellings and cycle chains for mixed short/long and case aliases', () => {
      const filename = files.write('config.yaml', 'value: synthetic');
      const legacy = fs.realpathSync(filename);
      const native = fs.realpathSync.native(filename);
      const targets = process.platform === 'win32' ? [native, filename.toUpperCase()] : [native];

      expect(canonicalPath(legacy)).equal(fs.realpathSync(legacy));

      for (const target of targets) {
        files.write('config.yaml', `next: {$include: ${JSON.stringify(target)}}`);

        function cycleError() {
          try {
            new ConfigLoader().loadYamlConfig(filename);
            expect.fail('Expected a cycle');
          } catch (error) {
            return (error as Error).message;
          }
        }

        const actual = cycleError();
        const fallback = sinon.stub(fs.realpathSync, 'native').throws(new Error('force legacy'));
        expect(actual).equal(cycleError());
        expect(actual).include('$include cycle detected:');
        fallback.restore();
      }
    });

    it('matches fallback outputs and lexical cycle errors for nested, repeated and aliased includes', () => {
      files.write('fragments/part.json', '{"items":[{"value":"synthetic"}]}');
      files.write('fragments/text.txt', 'synthetic text');
      files.write(
        'fragments/part.yaml',
        'json: {$include: ./part.json#items.0}\ntext: {$file: ./text.txt}'
      );
      const alias = path.join(files.directory, 'alias');
      fs.symlinkSync(
        path.join(files.directory, 'fragments'),
        alias,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const filename = files.write(
        'config.yaml',
        'first: {$include: ./alias/part.yaml}\nsecond: {$include: ./alias/part.yaml}'
      );
      const nativeData = new ConfigLoader().loadYamlConfig(filename);
      const fallback = sinon.stub(fs.realpathSync, 'native').throws(new Error('force fallback'));
      const legacyData = new ConfigLoader().loadYamlConfig(filename);
      expect(nativeData).deep.equal(legacyData);
      expect(nativeData.first).equal(nativeData.second);
      expect(legacyData.first).equal(legacyData.second);
      files.write('fragments/part.yaml', 'next: {$include: ../config.yaml}');

      function cycleError() {
        try {
          new ConfigLoader().loadYamlConfig(filename);
          expect.fail('Expected a cycle');
        } catch (error) {
          return (error as Error).message;
        }
      }

      const legacyError = cycleError();
      fallback.restore();
      expect(cycleError()).equal(legacyError);
      expect(legacyError).include('$include cycle detected:');
    });

    it('does not cache canonical identities across loads or alias retargeting', () => {
      const filename = files.write('config.yaml', 'next: {$include: ./alias/config.yaml}');
      files.write('other/config.yaml', 'value: synthetic');
      const alias = path.join(files.directory, 'alias');
      const kind = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(path.join(files.directory, 'other'), alias, kind);
      const loader = new ConfigLoader();
      expect(loader.loadYamlConfig(filename)).deep.equal({ next: { value: 'synthetic' } });
      fs.unlinkSync(alias);
      fs.symlinkSync(files.directory, alias, kind);

      expect(() => loader.loadYamlConfig(filename)).to.throw('$include cycle detected:');
    });
  });

  describe('compact construction-time key index', () => {
    it('indexes synthetic mixed graphs, shared objects and special keys in both snapshot modes', () => {
      const names = ['', 'a.b', '__proto__', 'constructor', '0', '01', 'ü', 'plain'];
      for (const key of names) {
        const shared = { leaf: 3, array: ['value', { ignored: true }], nil: null };
        const data = Object.fromEntries([
          [key, shared],
          ['first', shared],
          ['second', shared]
        ]);
        Object.defineProperty(data, 'hidden', { value: { ignored: true } });
        const prefix = key ? `${key}.` : '';
        const expectedKeys = [
          key,
          `${prefix}leaf`,
          `${prefix}array`,
          `${prefix}nil`,
          'first',
          'first.leaf',
          'first.array',
          'first.nil',
          'second',
          'second.leaf',
          'second.array',
          'second.nil'
        ];
        const expectedPaths = [
          [key],
          [key, 'leaf'],
          [key, 'array'],
          [key, 'nil'],
          ['first'],
          ['first', 'leaf'],
          ['first', 'array'],
          ['first', 'nil'],
          ['second'],
          ['second', 'leaf'],
          ['second', 'array'],
          ['second', 'nil']
        ];
        for (const immutable of [false, true]) {
          const reader = new ConfigReader(data, { immutable });
          expect(reader.keys()).deep.equal(expectedKeys);
          expect(reader.keyPaths()).deep.equal(expectedPaths);
        }
      }
    });

    it('retains the captured index after caller mutation without reading data during enumeration', () => {
      const data: Record<string, any> = { parent: { child: 1 }, list: [{ value: 2 }] };
      const expected = {
        keys: ['parent', 'parent.child', 'list'],
        paths: [['parent'], ['parent', 'child'], ['list']]
      };
      const reader = new ConfigReader(data);
      delete data.parent;
      data.extra = 3;
      const getter = sinon.spy(() => {
        throw new Error('Enumeration must not reread caller data');
      });
      Object.defineProperty(data, 'parent', { get: getter });

      for (let iteration = 0; iteration < 2; iteration++) {
        expect(reader.keys()).deep.equal(expected.keys);
        const paths = reader.keyPaths();
        expect(paths).deep.equal(expected.paths);
        paths[0]!.push('mutated');
        paths.pop();
      }

      expect(getter.called).equal(false);
    });

    it('preserves empty-prefix behavior, property order and inherited/array exclusions', () => {
      const data = Object.assign(Object.create({ inherited: { ignored: 1 } }), {
        '': { '': { leaf: 1 }, sibling: 2 },
        'a.b': 3,
        a: { b: 4 },
        array: [{ ignored: true }]
      });
      Object.defineProperty(data, 'hidden', { value: { ignored: true } });
      const expected = {
        keys: ['', '', 'leaf', 'sibling', 'a.b', 'a', 'a.b', 'array'],
        paths: [
          [''],
          ['', ''],
          ['', '', 'leaf'],
          ['', 'sibling'],
          ['a.b'],
          ['a'],
          ['a', 'b'],
          ['array']
        ]
      };
      const reader = new ConfigReader(data);

      expect(reader.keys()).deep.equal(expected.keys);
      expect(reader.keyPaths()).deep.equal(expected.paths);
      expect(reader.keys()).not.include('inherited');
      expect(reader.keys()).not.include('hidden');
      expect(reader.keys()).include('leaf');
      expect(reader.keyPaths()).deep.include(['', '', 'leaf']);
    });
  });

  describe('retained service discovery and cache behavior', () => {
    it('rechecks ordinary discovery when files change after the initial existence scan', () => {
      files.write('config.yaml', 'value: base');
      const last = path.join(files.directory, 'config.development.local.yaml');
      const original = fs.existsSync;
      let scanned = false;
      sinon.stub(fs, 'existsSync').callsFake((filename) => {
        const exists = original(filename);

        if (filename === last && !scanned) {
          scanned = true;
          files.write('config.local.yaml', 'value: appeared');
        }

        return exists;
      });

      expect(createConfigServiceFromFiles(options()).getString('value')).equal('appeared');
    });

    it('rechecks ordinary strict explicit files before loading on a cache miss', () => {
      const filename = files.write('chosen.yaml', 'value: synthetic');
      const original = fs.existsSync;
      let checks = 0;
      sinon.stub(fs, 'existsSync').callsFake((selected) => {
        const exists = original(selected);

        if (selected === filename && ++checks === 2) {
          fs.unlinkSync(filename);
        }

        return exists;
      });

      expect(() =>
        createConfigServiceFromFiles({
          ...options(),
          argv: ['--config', 'chosen.yaml'],
          strictFiles: true
        })
      ).to.throw(`Explicit config file not found: ${filename}`);
    });

    it('preserves discovery through changing own and inherited option getters', () => {
      files.write('config.first.yaml', 'value: first');
      files.write('config.second.yaml', 'value: second');

      for (const inherited of [false, true]) {
        resetConfigServiceCacheForTests();
        let reads = 0;
        const dynamic = Object.defineProperty({}, 'envName', {
          get() {
            reads++;

            return reads === 1 ? 'first' : 'second';
          }
        });
        const selected = inherited
          ? Object.assign(Object.create(dynamic), options())
          : Object.assign(dynamic, options());

        expect(createConfigServiceFromFiles(selected).getString('value')).equal('second');
        expect(reads).equal(2);
      }
    });

    it('retains discovery on misses/hits and preserves service identity/schema transforms', () => {
      files.write('config.yaml', 'value: 2');
      const schema = z.object({ value: z.number().transform((value) => value * 3) });
      const resolve = sinon.spy(path, 'resolve');
      const selected = { ...options(), schema };
      const service = createConfigServiceFromFiles(selected);
      expect(service.getNumber('value')).equal(6);
      expect(createConfigServiceFromFiles(selected)).equal(service);
      expect(createConfigServiceFromFiles({ ...selected, cache: false })).not.equal(service);
      expect(
        resolve
          .getCalls()
          .filter((call) => call.args[0] === files.directory && call.args.length === 2)
      ).length(16);
    });

    it('rechecks candidates that appear or disappear while the cache fingerprint is evaluated', () => {
      files.write('config.yaml', 'value: base');
      const local = path.join(files.directory, 'config.local.yaml');
      let changed = false;
      const env = Object.defineProperty({}, 'SYNTHETIC_TRIGGER', {
        enumerable: true,
        get() {
          if (!changed) {
            changed = true;
            files.write('config.local.yaml', 'value: local');
          }

          return 'synthetic';
        }
      });
      expect(createConfigServiceFromFiles({ ...options(), env }).getString('value')).equal('local');
      const disappear = Object.defineProperty({}, 'SYNTHETIC_TRIGGER', {
        enumerable: true,
        get() {
          if (fs.existsSync(local)) {
            fs.unlinkSync(local);
          }

          return 'different';
        }
      });
      expect(
        createConfigServiceFromFiles({ ...options(), env: disappear }).getString('value')
      ).equal('base');
    });

    it('rechecks strict explicit files on misses and hits, retaining detailed and safe errors', () => {
      const filename = files.write('chosen.yaml', 'value: synthetic');
      const selected = { ...options(), argv: ['--config', 'chosen.yaml'], strictFiles: true };
      createConfigServiceFromFiles(selected);
      fs.unlinkSync(filename);
      expect(() => createConfigServiceFromFiles(selected)).to.throw(
        `Explicit config file not found: ${filename}`
      );

      for (const safeErrors of [false, true]) {
        files.write('chosen.yaml', 'value: synthetic');
        const env = Object.defineProperty({}, 'SYNTHETIC_TRIGGER', {
          enumerable: true,
          get() {
            if (fs.existsSync(filename)) {
              fs.unlinkSync(filename);
            }

            return 'synthetic';
          }
        });
        const action = () => createConfigServiceFromFiles({ ...selected, env, safeErrors });

        if (safeErrors) {
          expect(action).to.throw(ConfigError, 'Unable to load configuration.');
        } else {
          expect(action).to.throw(`Explicit config file not found: ${filename}`);
        }
      }
    });
  });
});
