import { expect } from 'chai';
import fs from 'node:fs';
import { ConfigLoader } from '../../../src/index.js';
import { fixture } from '../../support/fixtures.js';

describe('TOML document contract', () => {
  let files: ReturnType<typeof fixture>;

  beforeEach(() => {
    files = fixture();
  });

  afterEach(() => files.dispose());

  function load(text: string) {
    return new ConfigLoader({ inheritProcessEnv: false }).loadTomlConfig(
      files.write('config.toml', text)
    );
  }

  for (const text of ['', '# comment\n', '\ufeff# BOM\r\n']) {
    it(`accepts an empty document ${JSON.stringify(text)}`, () => {
      expect(load(text)).deep.equal({});
    });
  }

  it('parses TOML 1.1 tables, quoted/dotted keys, arrays and multiline inline tables', () => {
    expect(
      load(`
title = 'synthetic'
mixed = [1, "two", true]
inline = {
  enabled = true,
}
[routing."route.v1"]
enabled = true
[[workers]]
name = "first"
[[workers]]
name = "second"
`)
    ).deep.equal({
      title: 'synthetic',
      mixed: [1, 'two', true],
      inline: { enabled: true },
      routing: { 'route.v1': { enabled: true } },
      workers: [{ name: 'first' }, { name: 'second' }]
    });
  });

  it('preserves literal, escaped, multiline, Unicode and Windows-path strings', () => {
    expect(
      load(String.raw`
path = 'C:\synthetic\config'
unicode = "\u03b1\x42"
basic = "line\nnext"
multiline = """
first
second"""
literal = '''
raw\ntext'''
`)
    ).deep.equal({
      path: 'C:\\synthetic\\config',
      unicode: 'αB',
      basic: 'line\nnext',
      multiline: 'first\nsecond',
      literal: 'raw\\ntext'
    });
  });

  it('retains numeric bases, safe boundaries, signed zero and special floats', () => {
    const data = load(`
hex = 0xff
octal = 0o755
binary = 0b1010
grouped = 1_000
max = 9007199254740991
min = -9007199254740991
exponent = 1.5e2
negativeZero = -0.0
positiveInfinity = inf
negativeInfinity = -inf
notNumber = nan
quoted = "9223372036854775807"
`);
    expect(data).include({ hex: 255, octal: 493, binary: 10, grouped: 1000, exponent: 150 });
    expect(data.max).equal(Number.MAX_SAFE_INTEGER);
    expect(data.min).equal(Number.MIN_SAFE_INTEGER);
    expect(Object.is(data.negativeZero, -0)).equal(true);
    expect(data.positiveInfinity).equal(Infinity);
    expect(data.negativeInfinity).equal(-Infinity);
    expect(Number.isNaN(data.notNumber)).equal(true);
    expect(data.quoted).equal('9223372036854775807');
  });

  for (const integer of ['9007199254740992', '-9007199254740992', '9223372036854775807']) {
    it(`rejects unsafe integer ${integer} instead of rounding`, () => {
      expect(() => load(`value = ${integer}`)).to.throw(/safe integer.*Quote/);
    });
  }

  for (const date of [
    '1979-05-27',
    '07:32:00',
    '07:32',
    '1979-05-27T07:32:00',
    '1979-05-27T07:32:00.123456789Z',
    '1979-05-27T07:32:00-07:00',
    '2020-02-30'
  ]) {
    it(`rejects native date/time ${date} and preserves its quoted spelling`, () => {
      expect(() => load(`value = ${date}`)).to.throw(/date\/time.*Quote/);
      expect(load(`value = "${date}"`).value).equal(date);
    });
  }

  it('normalizes null markers in tables and arrays without changing ordinary objects', () => {
    expect(
      load(`
clear = { "$null" = true }
items = [{ "$null" = true }, 1]
ordinary = { "$null" = true, other = 1 }
[nested.clear]
"$null" = true
`)
    ).deep.equal({
      clear: null,
      items: [null, 1],
      ordinary: { $null: true, other: 1 },
      nested: { clear: null }
    });
  });

  for (const argument of ['false', '"true"', '1', '[]', '{}', '"${FLAG:-true}"']) {
    it(`rejects invalid null directive argument ${argument}`, () => {
      expect(() => load(`value = { "$null" = ${argument} }`)).to.throw('$null directive');
    });
  }

  for (const text of [
    'value =',
    'value = "unfinished',
    'value = 01',
    'value = 1__0',
    'value = 0xZZ',
    'value = null',
    'value = true\nvalue = false',
    'value = 1\n[value]\nchild = 2',
    '[section]\n[section]',
    'value = "\\q"',
    'value = [1,',
    'value = "\u0000"'
  ]) {
    it(`rejects malformed TOML ${JSON.stringify(text)}`, () => {
      expect(() => load(text)).to.throw();
    });
  }

  it('retains special keys as own data without polluting prototypes', () => {
    const data = load('__proto__.polluted = true\nconstructor.prototype.value = 2');
    expect(Object.hasOwn(data, '__proto__')).equal(true);
    expect(data.__proto__).deep.equal({ polluted: true });
    expect(data.constructor).deep.equal({ prototype: { value: 2 } });
    expect(({} as any).polluted).equal(undefined);
    expect(Object.getPrototypeOf(data)).equal(Object.prototype);
  });

  it('rejects malformed UTF-8 bytes and accepts valid non-ASCII text', () => {
    const filename = files.write('invalid.toml', '');
    fs.writeFileSync(filename, Buffer.from([0x76, 0x3d, 0x22, 0xc3, 0x28, 0x22]));
    expect(() => new ConfigLoader().loadTomlConfig(filename)).to.throw(/encoded data/);
    expect(load('value = "こんにちは"').value).equal('こんにちは');
  });

  it('bounds dotted/table paths and inline nesting before resolution', () => {
    const dotted = (depth: number) => `${Array(depth).fill('next').join('.')} = 1`;
    expect(() => load(dotted(101))).not.to.throw();
    expect(() => load(dotted(102))).to.throw(/depth|nest/);
    expect(() => load(`[${Array(102).fill('next').join('.')}]\nvalue = 1`)).to.throw(/depth|nest/);
    expect(() => load(`value = ${'['.repeat(101)}1${']'.repeat(101)}`)).to.throw(/depth|nest/);
    expect(() => load(`value = ${'{ next = '.repeat(101)}1${'}'.repeat(101)}`)).to.throw(
      /depth|nest/
    );
  });

  it('rejects scalar, array and null roots after directive resolution', () => {
    files.write('values.json', '[1, 2]');
    files.write('text.txt', 'synthetic');
    for (const text of [
      '"$null" = true',
      '"$include" = "./values.json"',
      '"$file" = "./text.txt"',
      '"$env" = "VALUE"'
    ]) {
      const filename = files.write('root.toml', text);
      const loader = new ConfigLoader({ env: { VALUE: 'synthetic' }, inheritProcessEnv: false });
      expect(() => loader.loadTomlConfig(filename)).to.throw(/Config root/);
    }
  });

  it('keeps legacy YAML methods YAML-only and dispatches case-insensitive TOML extensions', () => {
    const loader = new ConfigLoader();
    const toml = files.write('settings.TOML', 'value = 1');
    const yaml = files.write('yaml.toml', 'value: 2');
    expect(loader.loadConfigFile(toml)).deep.equal({ value: 1 });
    expect(loader.loadYamlConfig(yaml)).deep.equal({ value: 2 });
    expect(() => loader.loadYamlConfig(toml)).to.throw(/Config root/);
    expect(loader.loadTomlConfig(files.write('settings.custom', 'value = 3'))).deep.equal({
      value: 3
    });
    expect(loader.loadConfigFile(files.write('settings.custom', 'value: 4'))).deep.equal({
      value: 4
    });
    expect(loader.loadTomlConfig('missing.toml')).deep.equal({});
  });
});
