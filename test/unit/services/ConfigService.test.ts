import { expect } from 'chai';
import sinon from 'sinon';
import { ConfigService } from '../../../src/services/ConfigService.js';
import { ConfigReader } from '../../../src/reader/ConfigReader.js';

describe('ConfigService', () => {
  let sandbox: sinon.SinonSandbox;
  let configReaderStub: sinon.SinonStubbedInstance<ConfigReader>;
  let service: ConfigService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    configReaderStub = sandbox.createStubInstance(ConfigReader);
    service = new ConfigService(configReaderStub);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('has', () => {
    it('should delegate to ConfigReader.has', () => {
      configReaderStub.has.withArgs('foo').returns(true);
      expect(service.has('foo')).to.equal(true);
    });
  });

  describe('keys', () => {
    it('should delegate to ConfigReader.keys', () => {
      configReaderStub.keys.returns(['a', 'b']);
      expect(service.keys()).to.deep.equal(['a', 'b']);
    });
  });

  describe('get', () => {
    it('should delegate to ConfigReader.get', () => {
      configReaderStub.get.withArgs('foo').returns('bar');
      expect(service.get('foo')).to.equal('bar');
    });
  });

  describe('getOptional', () => {
    it('should delegate to ConfigReader.getOptional', () => {
      configReaderStub.getOptional.withArgs('foo').returns(undefined);
      expect(service.getOptional('foo')).to.equal(undefined);
    });
  });

  describe('getString', () => {
    it('should delegate to ConfigReader.getString', () => {
      configReaderStub.getString.withArgs('foo').returns('bar');
      expect(service.getString('foo')).to.equal('bar');
    });
  });

  describe('getOptionalString', () => {
    it('should delegate to ConfigReader.getOptionalString', () => {
      configReaderStub.getOptionalString.withArgs('foo').returns(undefined);
      expect(service.getOptionalString('foo')).to.equal(undefined);
    });
  });

  describe('getNumber', () => {
    it('should delegate to ConfigReader.getNumber', () => {
      configReaderStub.getNumber.withArgs('num').returns(42);
      expect(service.getNumber('num')).to.equal(42);
    });
  });

  describe('getOptionalNumber', () => {
    it('should delegate to ConfigReader.getOptionalNumber', () => {
      configReaderStub.getOptionalNumber.withArgs('num').returns(undefined);
      expect(service.getOptionalNumber('num')).to.equal(undefined);
    });
  });

  describe('getBoolean', () => {
    it('should delegate to ConfigReader.getBoolean', () => {
      configReaderStub.getBoolean.withArgs('flag').returns(true);
      expect(service.getBoolean('flag')).to.equal(true);
    });
  });

  describe('getOptionalBoolean', () => {
    it('should delegate to ConfigReader.getOptionalBoolean', () => {
      configReaderStub.getOptionalBoolean.withArgs('flag').returns(undefined);
      expect(service.getOptionalBoolean('flag')).to.equal(undefined);
    });
  });

  describe('getStringArray', () => {
    it('should delegate to ConfigReader.getStringArray', () => {
      configReaderStub.getStringArray.withArgs('arr').returns(['x', 'y']);
      expect(service.getStringArray('arr')).to.deep.equal(['x', 'y']);
    });
  });

  describe('getOptionalStringArray', () => {
    it('should delegate to ConfigReader.getOptionalStringArray', () => {
      configReaderStub.getOptionalStringArray.withArgs('arr').returns(undefined);
      expect(service.getOptionalStringArray('arr')).to.equal(undefined);
    });
  });
});
