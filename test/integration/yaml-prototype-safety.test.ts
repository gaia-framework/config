import { expect } from 'chai';
import * as yaml from 'js-yaml';
import { ConfigLoader, createConfigFromFiles, loadConfigLayersFromFiles } from '../../src/index.js';
import { fixture } from '../support/fixtures.js';

describe('YAML parser mapping isolation', () => {
  let files: ReturnType<typeof fixture>;
  const property = 'syntheticInheritedKey';
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    files = fixture();
    original = Object.getOwnPropertyDescriptor(Object.prototype, property);
    expect(original).equal(undefined);
  });

  afterEach(() => {
    if (original) {
      Object.defineProperty(Object.prototype, property, original);
    } else {
      Reflect.deleteProperty(Object.prototype, property);
    }

    files.dispose();
  });

  function blockPrototypeProperty(descriptor: PropertyDescriptor) {
    Object.defineProperty(Object.prototype, property, {
      configurable: true,
      ...descriptor
    });
  }

  for (const [name, content] of [
    ['block', `${property}: root\nnested:\n  ${property}: child\nitems:\n  - ${property}: item`],
    ['flow', `{${property}: root, nested: {${property}: child}, items: [{${property}: item}]}`],
    [
      'explicit map',
      `!!map {${property}: root, nested: !!map {${property}: child}, items: [!!map {${property}: item}]}`
    ]
  ]) {
    it(`retains ${name} mapping keys without invoking inherited accessors`, () => {
      const filename = files.write('config.yaml', content!);
      let calls = 0;
      const getter = () => {
        calls++;
        throw new Error('Inherited getter must not run');
      };

      const setter = () => {
        calls++;
        throw new Error('Inherited setter must not run');
      };

      blockPrototypeProperty({ get: getter, set: setter });
      const result = new ConfigLoader().loadYamlConfig(filename);

      expect(calls).equal(0);
      expect(result).deep.equal({
        [property]: 'root',
        nested: { [property]: 'child' },
        items: [{ [property]: 'item' }]
      });
      expect(Object.getPrototypeOf(result)).equal(Object.prototype);
      expect(Object.getPrototypeOf(result.nested)).equal(Object.prototype);
      expect(Object.getPrototypeOf(result.items)).equal(Array.prototype);
      expect(Object.getOwnPropertyDescriptor(result, property)).deep.equal({
        value: 'root',
        enumerable: true,
        configurable: true,
        writable: true
      });
      expect(Object.getOwnPropertyDescriptor(Object.prototype, property)).deep.equal({
        get: getter,
        set: setter,
        configurable: true,
        enumerable: false
      });
    });
  }

  for (const kind of ['getter-only', 'read-only']) {
    it(`retains keys shadowing a ${kind} inherited property`, () => {
      const filename = files.write('config.yaml', `${property}: own`);
      blockPrototypeProperty(
        kind === 'getter-only'
          ? {
              get: () => {
                throw new Error('Inherited getter must not run');
              }
            }
          : { value: 'inherited', writable: false }
      );

      expect(new ConfigLoader().loadYamlConfig(filename)).deep.equal({ [property]: 'own' });
    });
  }

  it('retains protected keys in YAML includes, layers, overrides and immutable readers', () => {
    files.write('fragment.yml', `${property}: included`);
    files.write('config.yaml', `${property}: base\nfragment: {$include: ./fragment.yml}`);
    files.write('config.local.yaml', `${property}: local`);
    blockPrototypeProperty({
      set() {
        throw new Error('Inherited setter must not run');
      }
    });
    const options = {
      basePath: files.directory,
      argv: [],
      env: {},
      inheritProcessEnv: false
    };

    expect(loadConfigLayersFromFiles(options)).deep.equal({
      [property]: 'local',
      fragment: { [property]: 'included' }
    });
    const reader = createConfigFromFiles({
      ...options,
      env: { [`CONFIG_${property}`]: 'override' },
      immutable: true
    });

    expect(reader.getString(property)).equal('override');
    expect(reader.getString(`fragment.${property}`)).equal('included');
    expect(Object.isFrozen(reader.get(''))).equal(true);
  });

  it('still detects duplicate keys and preserves redacted errors', () => {
    const filename = files.write('config.yaml', `${property}: first\n${property}: second`);
    blockPrototypeProperty({
      set() {
        throw new Error('Inherited setter must not run');
      }
    });

    expect(() => new ConfigLoader().loadYamlConfig(filename)).to.throw('duplicated mapping key');
    expect(() => new ConfigLoader({ safeErrors: true }).loadYamlConfig(filename)).to.throw(
      'Unable to load configuration file.'
    );
  });

  it('retains alias identity rules and cycle detection with protected keys', () => {
    blockPrototypeProperty({
      set() {
        throw new Error('Inherited setter must not run');
      }
    });
    const filename = files.write(
      'config.yaml',
      `first: &shared {${property}: value}\nsecond: *shared`
    );
    const result = new ConfigLoader().loadYamlConfig(filename);

    expect(result.first).deep.equal({ [property]: 'value' });
    expect(result.second).deep.equal(result.first);
    expect(result.second).not.equal(result.first);

    files.write('config.yaml', `first: &cycle {${property}: *cycle}`);
    expect(() => new ConfigLoader().loadYamlConfig(filename)).to.throw(
      'Config value cycle detected:'
    );
  });

  it('keeps scalar-key conversion, special keys and the shared parser schema unchanged', () => {
    const filename = files.write(
      'config.yaml',
      [
        '0: zero',
        'true: boolean-key',
        'null: null-key',
        '"": empty-key',
        '__proto__: {safe: true}',
        'constructor: {prototype: data}',
        '<<: literal-key'
      ].join('\n')
    );
    const result = new ConfigLoader().loadYamlConfig(filename);

    expect(result).deep.equal(
      JSON.parse(
        '{"0":"zero","true":"boolean-key","null":"null-key","":"empty-key","__proto__":{"safe":true},"constructor":{"prototype":"data"},"<<":"literal-key"}'
      )
    );
    expect(Object.getPrototypeOf(result)).equal(Object.prototype);
    expect(Object.getPrototypeOf(yaml.mapTag.create('tag:yaml.org,2002:map'))).equal(
      Object.prototype
    );
    expect(yaml.JSON_SCHEMA.defaultMappingTag).equal(yaml.mapTag);
  });

  it('counts empty merge sources against the parser budget when native merges are enabled', () => {
    const source = 'empty: &empty {}\nvalue: {<<: [*empty, *empty, *empty, *empty]}';

    expect(() => yaml.load(source, { schema: yaml.YAML11_SCHEMA, maxTotalMergeKeys: 3 })).to.throw(
      'merge keys exceeded maxTotalMergeKeys (3)'
    );
    expect(yaml.load(source, { schema: yaml.YAML11_SCHEMA, maxTotalMergeKeys: 4 })).deep.equal({
      empty: {},
      value: {}
    });
  });

  it('keeps merge-like alias sequences as literal data in root and included YAML', () => {
    const values = Array.from({ length: 101 }, () => ({ port: 4001 }));
    const content = `defaults: &defaults ${JSON.stringify(values)}\nvalue: {<<: *defaults}`;
    const filename = files.write('fragment.yaml', content);
    const expected = { defaults: values, value: { '<<': values } };
    const loader = new ConfigLoader();

    expect(loader.loadYamlConfig(filename)).deep.equal(expected);
    const root = files.write('config.yaml', 'included: {$include: ./fragment.yaml}');
    expect(loader.loadYamlConfig(root)).deep.equal({ included: expected });
  });

  for (const key of ['9000', 'true', 'null']) {
    it(`protects the normalized ${key} scalar key`, () => {
      expect(Object.hasOwn(Object.prototype, key)).equal(false);
      const filename = files.write('config.yaml', `${key}: retained`);
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        set() {
          throw new Error('Inherited scalar-key setter must not run');
        }
      });

      try {
        expect(new ConfigLoader().loadYamlConfig(filename)).deep.equal({ [key]: 'retained' });
      } finally {
        Reflect.deleteProperty(Object.prototype, key);
      }
    });
  }

  for (const key of ['[one, two]', '{one: two}']) {
    it(`preserves complex-key rejection for ${key}`, () => {
      const content = `? ${key}\n: value`;
      const filename = files.write('config.yaml', content);
      const reason = 'object-based map does not support complex keys';

      expect(() => yaml.load(content, { schema: yaml.JSON_SCHEMA })).to.throw(reason);
      expect(() => new ConfigLoader().loadYamlConfig(filename)).to.throw(reason);
    });
  }
});
