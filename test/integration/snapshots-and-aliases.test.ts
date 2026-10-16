import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  ConfigError,
  ConfigLoader,
  ConfigReader,
  createConfig,
  createConfigService,
  createConfigFromFiles,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles
} from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('Include aliases, literal key enumeration and immutable snapshots', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;

  beforeEach(() => {
    files = fixture();
  });

  afterEach(() => {
    sinon.restore();
    files.dispose();
  });

  function directoryAlias(target: string, name: string) {
    const filename = path.join(files.directory, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.symlinkSync(target, filename, process.platform === 'win32' ? 'junction' : 'dir');

    return filename;
  }

  function options() {
    return { basePath: files.directory, argv: [], env: {}, inheritProcessEnv: false };
  }

  describe('canonical cycle identity with lexical relative resolution', () => {
    it('detects direct cycles through directory symlinks or Windows junctions', () => {
      const filename = files.write('config.yaml', 'next: {$include: ./alias/config.yaml}');
      directoryAlias(files.directory, 'alias');
      const loader = new ConfigLoader();

      expect(() => loader.loadYamlConfig(filename)).to.throw('$include cycle detected:');
      expect(() => loader.loadYamlConfig(filename)).to.throw(path.join('alias', 'config.yaml'));

      files.write('config.yaml', 'value: repaired');
      expect(loader.loadYamlConfig(filename)).deep.equal({ value: 'repaired' });
    });

    it('detects indirect alias cycles, aliased root entrypoints and fragment cycles', () => {
      files.write('config.yaml', 'next: {$include: ./parts/next.yaml}');
      files.write('parts/next.yaml', 'next: {$include: ../alias/config.yaml#next}');
      const alias = directoryAlias(files.directory, 'alias');

      for (const filename of [
        path.join(files.directory, 'config.yaml'),
        path.join(alias, 'config.yaml')
      ]) {
        expect(() => new ConfigLoader().loadYamlConfig(filename)).to.throw(
          '$include cycle detected:'
        );
      }
    });

    it('preserves include/file paths relative to alias spelling and keeps context-specific caches', () => {
      files.write('sibling.yaml', 'value: physical');
      files.write('sibling.txt', 'physical text');
      files.write('links/sibling.yaml', 'value: lexical');
      files.write('links/sibling.txt', 'lexical text');
      const entry = files.write(
        'real/entry.yaml',
        'part: {$include: ../sibling.yaml}\ntext: {$file: ../sibling.txt}'
      );
      directoryAlias(path.dirname(entry), 'links/alias');
      const filename = files.write(
        'config.yaml',
        [
          'physical: {$include: ./real/entry.yaml}',
          'lexical: {$include: ./links/alias/entry.yaml}',
          'again: {$include: ./links/alias/entry.yaml}'
        ].join('\n')
      );
      const reads = sinon.spy(fs, 'readFileSync');
      const data = new ConfigLoader().loadYamlConfig(filename);

      expect(data).deep.equal({
        physical: { part: { value: 'physical' }, text: 'physical text' },
        lexical: { part: { value: 'lexical' }, text: 'lexical text' },
        again: { part: { value: 'lexical' }, text: 'lexical text' }
      });
      expect(data.lexical).equal(data.again);
      expect(
        reads
          .getCalls()
          .filter((call) => call.args[0] === path.join(files.directory, 'links/alias/entry.yaml'))
      ).length(1);
    });

    it('retains safe error boundaries for canonical identity lookup failures and alias cycles', () => {
      const filename = files.write('config.yaml', 'next: {$include: ./alias/config.yaml}');
      directoryAlias(files.directory, 'alias');
      expect(() => new ConfigLoader({ safeErrors: true }).loadYamlConfig(filename)).to.throw(
        ConfigError
      );
      const realpath = sinon.stub(fs, 'realpathSync').throws(new Error('SYNTHETIC_PRIVATE'));
      Object.assign(realpath, {
        native: sinon.stub().throws(new Error('SYNTHETIC_NATIVE_PRIVATE'))
      });

      try {
        new ConfigLoader({ safeErrors: true }).loadYamlConfig(filename);
        expect.fail('Expected a safe file error');
      } catch (error) {
        expect(error).instanceOf(ConfigError);
        expect((error as ConfigError).code).equal('CONFIG_FILE_LOAD_FAILED');
        expect(String(error)).not.include('SYNTHETIC_PRIVATE');
      }

      realpath.restore();
    });
  });

  describe('keyPaths()', () => {
    it('enumerates literal dotted, empty and special keys without changing legacy keys()', () => {
      const reader = createConfig(
        JSON.parse(
          '{"a.b":"literal","a":{"b":"nested"},"":{"child":1},"list":[{"item":1}],"__proto__":{"safe":true}}'
        )
      );
      expect(reader.keys()).deep.equal([
        'a.b',
        'a',
        'a.b',
        '',
        'child',
        'list',
        '__proto__',
        '__proto__.safe'
      ]);
      expect(reader.keyPaths()).deep.equal([
        ['a.b'],
        ['a'],
        ['a', 'b'],
        [''],
        ['', 'child'],
        ['list'],
        ['__proto__'],
        ['__proto__', 'safe']
      ]);

      for (const segments of reader.keyPaths()) {
        expect(reader.getOptional(segments)).not.equal(undefined);
      }

      expect(reader.keyPaths().some((segments) => segments.includes('item'))).equal(false);
    });

    it('returns independent outer/inner arrays and delegates through services', () => {
      const reader = createConfig({ a: { b: 1 } });
      const service = createConfigService(reader);
      const paths = service.keyPaths();
      paths[0]!.push('corrupted');
      paths[1]![0] = 'changed';
      paths.pop();

      expect(reader.keyPaths()).deep.equal([['a'], ['a', 'b']]);
      expect(service.keyPaths()).deep.equal(reader.keyPaths());
      expect(createConfig({}).keyPaths()).deep.equal([]);
    });
  });

  describe('immutable: true', () => {
    it('clones and deeply freezes snapshots without freezing or sharing caller-owned data', () => {
      const input = { object: { value: 'before' }, list: [{ value: 'before' }] };
      const reader = createConfig(input, undefined, { immutable: true });
      const object = reader.get<typeof input.object>('object');
      const list = reader.get<typeof input.list>('list');

      expect(object).not.equal(input.object);
      expect(list).not.equal(input.list);
      expect(list[0]).not.equal(input.list[0]);
      expect(Object.isFrozen(reader.get(''))).equal(true);
      expect(Object.isFrozen(object)).equal(true);
      expect(Object.isFrozen(list)).equal(true);
      expect(Object.isFrozen(list[0])).equal(true);
      expect(Object.isFrozen(input)).equal(false);
      expect(Object.isFrozen(input.object)).equal(false);
      input.object.value = 'after';
      input.list[0]!.value = 'after';
      input.list.push({ value: 'extra' });

      expect(reader.getString('object.value')).equal('before');
      expect(reader.getString('list.0.value')).equal('before');
      expect(list).length(1);
      expect(() => {
        object.value = 'mutated';
      }).to.throw(TypeError);
      expect(() => list.push({ value: 'mutated' })).to.throw(TypeError);
      expect(reader.keyPaths()).deep.equal([['object'], ['object', 'value'], ['list']]);
    });

    it('preserves shared references inside the snapshot, own descriptors, null prototypes and sparse arrays', () => {
      const marker = Symbol('metadata');
      const shared = { value: 1 };
      const sparse = new Array(3);
      sparse[2] = shared;
      const input = Object.assign(
        Object.create(null),
        JSON.parse('{"__proto__":{"value":"own"}}'),
        {
          first: shared,
          second: shared,
          sparse,
          nil: null,
          absent: undefined,
          nan: NaN,
          infinity: Infinity
        }
      );
      Object.defineProperty(input, 'hidden', { value: shared, enumerable: false });
      input[marker] = shared;
      const reader = new ConfigReader(input, { immutable: true });
      const snapshot = reader.get<typeof input>('');

      expect(Object.getPrototypeOf(snapshot)).equal(null);
      expect(reader.get('first')).equal(reader.get('second'));
      expect(reader.get('first')).equal(snapshot.hidden);
      expect(reader.get('first')).equal(snapshot[marker]);
      expect(reader.get('first')).not.equal(shared);
      expect(reader.getString('__proto__.value')).equal('own');
      expect(Object.hasOwn(snapshot.sparse, 0)).equal(false);
      expect(snapshot.sparse).length(3);
      expect(snapshot.sparse[2]).equal(snapshot.first);
      expect(reader.getOptional('absent')).equal(undefined);
      expect(Number.isNaN(reader.get('nan'))).equal(true);
      expect(reader.getNumber('infinity')).equal(Infinity);
      expect(snapshot.nil).equal(null);
      expect(Object.getOwnPropertyDescriptor(snapshot, 'hidden')?.enumerable).equal(false);
      expect(reader.keys()).not.include('hidden');
      expect(Object.isFrozen(shared)).equal(false);
    });

    it('leaves existing reference behavior and permissive values unchanged by default', () => {
      const object = { value: 1 };
      const date = new Date(0);
      const reader = createConfig({ object, date });

      expect(reader.get('object')).equal(object);
      expect(reader.get('date')).equal(date);
      object.value = 2;
      expect(reader.getNumber('object.value')).equal(2);
      expect(Object.isFrozen(object)).equal(false);
    });

    it('rejects unsupported objects/value types without freezing any original values', () => {
      class Custom {
        value = 1;
      }
      const customArray = Object.setPrototypeOf([], null);

      for (const value of [
        new Date(),
        new Map(),
        new Set(),
        new Uint8Array(1),
        /text/,
        new Custom(),
        customArray,
        () => 1,
        Symbol('value'),
        1n
      ]) {
        const input = { okay: { value: 1 }, value };
        expect(() => createConfig(input, undefined, { immutable: true })).to.throw(
          /Immutable configuration/
        );
        expect(Object.isFrozen(input.okay)).equal(false);
      }

      expect(() => new ConfigReader([] as never, { immutable: true })).to.throw(
        /root must be an object/
      );
    });

    it('rejects accessor properties without invoking them, including hidden and symbol properties', () => {
      for (const key of ['value', Symbol('value')]) {
        const getter = sinon.spy(() => 'SYNTHETIC_PRIVATE');
        const input = Object.defineProperty({}, key, { get: getter });
        expect(() => new ConfigReader(input, { immutable: true })).to.throw(/accessor properties/);
        expect(() => createConfig(input, undefined, { immutable: true })).to.throw(
          /accessor properties/
        );
        expect(getter.callCount).equal(0);
      }
    });

    it('rejects cyclic snapshots and sanitizes unsupported input errors in safe mode', () => {
      const cycle: Record<PropertyKey, unknown> = {};
      cycle[Symbol('self')] = cycle;
      expect(() => new ConfigReader(cycle, { immutable: true })).to.throw(/cycle detected/);
      expect(() => createConfig(cycle, z.any(), { immutable: true })).to.throw(/cycle detected/);

      for (const action of [
        () => new ConfigReader({ value: new Date() }, { immutable: true, safeErrors: true }),
        () => createConfig(cycle, undefined, { immutable: true, safeErrors: true })
      ]) {
        expect(action).to.throw(ConfigError, 'Invalid configuration input.');
      }
    });

    it('snapshots transformed schema output and preserves scalar-to-object transforms', () => {
      const schema = z.string().transform((value) => ({ nested: { value }, values: ['one'] }));
      const reader = createConfig('synthetic', schema, { immutable: true });

      expect(reader.getString('nested.value')).equal('synthetic');
      expect(Object.isFrozen(reader.get('nested'))).equal(true);
      expect(() => reader.getStringArray('values').push('two')).to.throw(TypeError);
    });

    it('supports factory and withOptions entrypoints and partitions service caches', () => {
      const original = createConfig({ value: { name: 'first' } });
      const snapshot = original.withOptions({ immutable: true });
      expect(snapshot.get('value')).not.equal(original.get('value'));
      expect(Object.isFrozen(snapshot.get('value'))).equal(true);
      expect(
        Object.isFrozen(createConfigService(original, undefined, { immutable: true }).get('value'))
      ).equal(true);
      expect(
        Object.isFrozen(
          createConfigService({ value: {} }, undefined, { immutable: true }).get('value')
        )
      ).equal(true);
      expect(Object.isFrozen(original.get('value'))).equal(false);
      expect(Object.isFrozen(snapshot.withOptions({ immutable: false }).get('value'))).equal(true);
      files.write('config.yaml', 'value: {name: first}');
      const cached = createConfigServiceFromFiles(options());
      const immutable = createConfigServiceFromFiles({ ...options(), immutable: true });

      expect(immutable).not.equal(cached);
      expect(createConfigServiceFromFiles({ ...options(), immutable: true })).equal(immutable);
      expect(createConfigServiceFromFiles({ ...options(), immutable: false })).equal(cached);
      expect(Object.isFrozen(immutable.get('value'))).equal(true);
      expect(Object.isFrozen(cached.get('value'))).equal(false);
      expect(
        Object.isFrozen(createConfigFromFiles({ ...options(), immutable: true }).get('value'))
      ).equal(true);
      expect(
        createConfigServiceFromFiles({ ...options(), immutable: true, cache: false })
      ).not.equal(immutable);
      expect(Object.isFrozen(loadConfigLayersFromFiles({ ...options(), immutable: true }))).equal(
        false
      );
      expect(Object.isFrozen(loadConfigObjectFromFiles({ ...options(), immutable: true }))).equal(
        false
      );
    });

    it('handles deep immutable data without recursive clone or freeze traversal', () => {
      let value: Record<string, unknown> = { leaf: 'text' };

      for (let depth = 0; depth < 1500; depth++) {
        value = { child: value };
      }

      const reader = createConfig(value, undefined, { immutable: true });
      expect(reader.keyPaths()).length(1501);
      expect(reader.getString([...new Array<string>(1500).fill('child'), 'leaf'])).equal('text');
    });
  });
});
