import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigLoader, ConfigReader } from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('configuration edge cases and retained quirks', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;
  beforeEach(() => {
    files = fixture();
  });
  afterEach(() => files.dispose());
  it('rejects malformed JSON, indirect cycles, unsupported includes and fragment traversal through scalars', () => {
    files.write('broken.json', '{');
    files.write('a.yaml', 'a: {$include: "b.yaml"}');
    files.write('b.yaml', 'b: {$include: "a.yaml"}');
    files.write('scalar.json', '{"scalar":1,"arr":[1]}');
    files.write('file.ini', 'value = 1');
    for (const include of [
      'broken.json',
      'a.yaml',
      'file.ini',
      'scalar.json#scalar.child',
      'scalar.json#arr.nope',
      'scalar.json#arr.-1',
      'scalar.json#missing.child'
    ]) {
      const filename = files.write('config.yaml', `a: {$include: "${include}"}`);
      expect(() => new ConfigLoader().loadYamlConfig(filename), include).to.throw();
    }
  });
  it('supports absolute file/include paths, yml includes, empty includes and ordinary directive-like objects', () => {
    const text = files.write('text.txt', 'text');
    const yaml = files.write('fragment.yml', 'value: 1');
    files.write('empty.yml', '');
    const filename = files.write(
      'config.yaml',
      JSON.stringify({
        text: { $file: text },
        fragment: { $include: yaml },
        empty: { $include: './empty.yml' },
        ordinary: { $file: 3, another: true },
        unknown: { $unknown: 'value' }
      })
    );
    expect(new ConfigLoader().loadYamlConfig(filename)).to.deep.equal({
      text: 'text',
      fragment: { value: 1 },
      empty: undefined,
      ordinary: { $file: 3, another: true },
      unknown: { $unknown: 'value' }
    });
  });
  it('surfaces unreadable file errors without changing the original error', () => {
    const secret = files.write('text.txt', 'text');
    const filename = files.write('config.yaml', 'text: {$file: "text.txt"}');
    const original = fs.readFileSync;
    const expected = new Error('synthetic EACCES');
    const stub = sinon.stub(fs, 'readFileSync').callsFake(((target: any, ...args: any[]) => {
      if (String(target) === secret) {
        throw expected;
      }

      return (original as any)(target, ...args);
    }) as typeof fs.readFileSync);
    try {
      expect(() => new ConfigLoader().loadYamlConfig(filename)).to.throw(expected);
    } finally {
      stub.restore();
    }
  });
  it('retains native Number conversions, optional getters, key snapshots and cached reader values', () => {
    const data = {
      blank: '',
      truth: true,
      falsehood: false,
      arr: ['a'],
      value: 'first',
      nil: null
    };
    const reader = new ConfigReader(data);
    expect(reader.getNumber('blank')).to.equal(0);
    expect(reader.getNumber('truth')).to.equal(1);
    expect(reader.getOptionalNumber('falsehood')).to.equal(0);
    expect(reader.get('arr.0')).to.equal('a');
    for (const key of ['arr.nope', 'arr.-1', 'arr.99', 'value.child', 'nil.child', 'missing']) {
      expect(reader.getOptional(key)).to.equal(undefined);
    }

    expect(reader.get('value')).to.equal('first');
    data.value = 'changed';
    expect(reader.get('value')).to.equal('first');
    const keys = reader.keys();
    keys.push('external');
    expect(reader.keys()).not.to.include('external');
    for (const [value, result] of [
      ['true', true],
      ['1', true],
      ['yes', true],
      ['on', true],
      ['FALSE', false],
      ['0', false],
      ['no', false],
      ['off', false]
    ] as const) {
      expect(new ConfigReader({ value }).getBoolean('value')).to.equal(result);
    }

    expect(() => new ConfigReader({ value: ' true ' }).getBoolean('value')).to.throw();
    expect(new ConfigReader({ value: 1 }).getOptionalBoolean('value')).to.equal(undefined);
  });
  it('retains loader-instance include caches after file changes', () => {
    files.write('included.yaml', 'value: first');
    const filename = files.write('config.yaml', 'include: {$include: "included.yaml"}');
    const loader = new ConfigLoader();
    expect(loader.loadYamlConfig(filename).include).to.deep.equal({ value: 'first' });
    files.write('included.yaml', 'value: second');
    expect(loader.loadYamlConfig(filename).include).to.deep.equal({ value: 'first' });
    expect(new ConfigLoader().loadYamlConfig(filename).include).to.deep.equal({ value: 'second' });
    expect(path.isAbsolute(filename)).to.equal(true);
  });
});
