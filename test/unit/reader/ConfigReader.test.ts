import { expect } from 'chai';
import { ConfigReader } from '../../../src/reader/ConfigReader.js';

describe('ConfigReader', () => {
  let reader: ConfigReader;
  const configData = {
    foo: 'bar',
    num: 42,
    boolTrue: true,
    boolFalse: false,
    strTrue: 'true',
    strFalse: 'false',
    arr: ['a', 'b'],
    nested: {
      key: 'value',
      deep: {
        val: 123
      }
    },
    nullVal: null
  };

  beforeEach(() => {
    reader = new ConfigReader(configData);
  });

  describe('has', () => {
    it('should return true for existing keys', () => {
      expect(reader.has('foo')).to.equal(true);
      expect(reader.has('nested.key')).to.equal(true);
    });
    it('should return false for missing keys', () => {
      expect(reader.has('missing')).to.equal(false);
      expect(reader.has('nested.missing')).to.equal(false);
    });
    it('should return false for null values', () => {
      expect(reader.has('nullVal')).to.equal(false);
    });
  });

  describe('keys', () => {
    it('should return all keys including nested', () => {
      const keys = reader.keys();
      expect(keys).to.include.members([
        'foo',
        'num',
        'boolTrue',
        'boolFalse',
        'strTrue',
        'strFalse',
        'arr',
        'nested',
        'nested.key',
        'nested.deep',
        'nested.deep.val',
        'nullVal'
      ]);
    });
  });

  describe('get', () => {
    it('should return value for existing key', () => {
      expect(reader.get('foo')).to.equal('bar');
      expect(reader.get('nested.key')).to.equal('value');
    });
    it('should throw for missing key', () => {
      expect(() => reader.get('missing')).to.throw('Missing config key: missing');
    });
    it('should throw for null value', () => {
      expect(() => reader.get('nullVal')).to.throw('Missing config key: nullVal');
    });
  });

  describe('getOptional', () => {
    it('should return value for existing key', () => {
      expect(reader.getOptional('foo')).to.equal('bar');
    });
    it('should return undefined for missing key', () => {
      expect(reader.getOptional('missing')).to.equal(undefined);
    });
    it('should return undefined for null value', () => {
      expect(reader.getOptional('nullVal')).to.equal(undefined);
    });
  });

  describe('getString', () => {
    it('should return string value', () => {
      expect(reader.getString('foo')).to.equal('bar');
    });
    it('should throw if value is not a string', () => {
      expect(() => reader.getString('num')).to.throw("Config key 'num' must be a string");
    });
  });

  describe('getOptionalString', () => {
    it('should return string value', () => {
      expect(reader.getOptionalString('foo')).to.equal('bar');
    });
    it('should return undefined if value is not a string', () => {
      expect(reader.getOptionalString('num')).to.equal(undefined);
    });
    it('should return undefined for missing key', () => {
      expect(reader.getOptionalString('missing')).to.equal(undefined);
    });
  });

  describe('getNumber', () => {
    it('should return number value', () => {
      expect(reader.getNumber('num')).to.equal(42);
    });
    it('should parse string number', () => {
      const r = new ConfigReader({ strNum: '123' });
      expect(r.getNumber('strNum')).to.equal(123);
    });
    it('should throw if value is not a number', () => {
      expect(() => reader.getNumber('foo')).to.throw("Config key 'foo' must be a number");
    });
  });

  describe('getOptionalNumber', () => {
    it('should return number value', () => {
      expect(reader.getOptionalNumber('num')).to.equal(42);
    });
    it('should parse string number', () => {
      const r = new ConfigReader({ strNum: '123' });
      expect(r.getOptionalNumber('strNum')).to.equal(123);
    });
    it('should return undefined if value is not a number', () => {
      expect(reader.getOptionalNumber('foo')).to.equal(undefined);
    });
    it('should return undefined for missing key', () => {
      expect(reader.getOptionalNumber('missing')).to.equal(undefined);
    });
  });

  describe('getBoolean', () => {
    it('should return boolean value', () => {
      expect(reader.getBoolean('boolTrue')).to.equal(true);
      expect(reader.getBoolean('boolFalse')).to.equal(false);
    });
    it('should parse string boolean', () => {
      expect(reader.getBoolean('strTrue')).to.equal(true);
      expect(reader.getBoolean('strFalse')).to.equal(false);
    });
    it('should throw if value is not a boolean', () => {
      expect(() => reader.getBoolean('foo')).to.throw("Config key 'foo' must be a boolean");
    });
  });

  describe('getOptionalBoolean', () => {
    it('should return boolean value', () => {
      expect(reader.getOptionalBoolean('boolTrue')).to.equal(true);
      expect(reader.getOptionalBoolean('boolFalse')).to.equal(false);
    });
    it('should parse string boolean', () => {
      expect(reader.getOptionalBoolean('strTrue')).to.equal(true);
      expect(reader.getOptionalBoolean('strFalse')).to.equal(false);
    });
    it('should return undefined if value is not a boolean', () => {
      expect(reader.getOptionalBoolean('foo')).to.equal(undefined);
    });
    it('should return undefined for missing key', () => {
      expect(reader.getOptionalBoolean('missing')).to.equal(undefined);
    });
  });

  describe('getStringArray', () => {
    it('should return string array', () => {
      expect(reader.getStringArray('arr')).to.deep.equal(['a', 'b']);
    });
    it('should throw if value is not a string array', () => {
      expect(() => reader.getStringArray('foo')).to.throw("Config key 'foo' must be a string[]");
      expect(() => reader.getStringArray('num')).to.throw("Config key 'num' must be a string[]");
    });
  });

  describe('getOptionalStringArray', () => {
    it('should return string array', () => {
      expect(reader.getOptionalStringArray('arr')).to.deep.equal(['a', 'b']);
    });
    it('should return undefined if value is not a string array', () => {
      expect(reader.getOptionalStringArray('foo')).to.equal(undefined);
      expect(reader.getOptionalStringArray('num')).to.equal(undefined);
    });
    it('should return undefined for missing key', () => {
      expect(reader.getOptionalStringArray('missing')).to.equal(undefined);
    });
  });
});
