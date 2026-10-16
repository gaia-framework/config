import { expect } from 'chai';
import sinon from 'sinon';
import { ConfigLoader } from '../../src/index.js';
import { fixture } from '../support/fixtures.js';

describe('Loader object construction and resolution order', () => {
  let files: ReturnType<typeof fixture>;

  beforeEach(() => {
    files = fixture();
  });

  afterEach(() => {
    sinon.restore();
    files.dispose();
  });

  for (const format of ['yaml', 'toml']) {
    it(`preserves ${format} property descriptors and bypasses inherited setters`, () => {
      const data = JSON.parse(
        '{"__proto__":{"safe":true},"constructor":{"prototype":"data"},"syntheticSetter":{"syntheticSetter":2},"":"empty"}'
      );
      const content =
        format === 'yaml'
          ? JSON.stringify(data)
          : [
              '"__proto__" = { safe = true }',
              'constructor = { prototype = "data" }',
              'syntheticSetter = { syntheticSetter = 2 }',
              '"" = "empty"'
            ].join('\n');
      const filename = files.write(`config.${format}`, content);
      const loader = new ConfigLoader();

      let setterCalls = 0;
      Object.defineProperty(Object.prototype, 'syntheticSetter', {
        configurable: true,
        set() {
          setterCalls++;
        }
      });

      try {
        const result = loader.loadConfigFile(filename);

        expect(result).deep.equal(data);
        expect(Object.getPrototypeOf(result)).equal(Object.prototype);
        expect(setterCalls).equal(0);

        for (const key of Object.keys(data)) {
          expect(Object.getOwnPropertyDescriptor(result, key)).deep.equal({
            value: data[key],
            enumerable: true,
            writable: true,
            configurable: true
          });
        }
      } finally {
        Reflect.deleteProperty(Object.prototype, 'syntheticSetter');
      }
    });

    it(`resolves ${format} nested values in order and reads the environment each time`, () => {
      const data = { first: '${VALUE}', nested: { second: '${VALUE}' }, items: ['${VALUE}'] };
      const content =
        format === 'yaml'
          ? JSON.stringify(data)
          : ['first = "${VALUE}"', 'nested = { second = "${VALUE}" }', 'items = ["${VALUE}"]'].join(
              '\n'
            );
      const filename = files.write(`config.${format}`, content);
      let reads = 0;
      const env = Object.defineProperty({}, 'VALUE', {
        get() {
          return String(++reads);
        }
      });
      const loader = new ConfigLoader({ env, inheritProcessEnv: false });

      expect(loader.loadConfigFile(filename)).deep.equal({
        first: '1',
        nested: { second: '2' },
        items: ['3']
      });
      expect(loader.loadConfigFile(filename)).deep.equal({
        first: '4',
        nested: { second: '5' },
        items: ['6']
      });
      expect(reads).equal(6);
    });

    it(`retains ${format} first-failure order and recovers on the same loader`, () => {
      const content =
        format === 'yaml'
          ? 'first: "${MISSING}"\nlater: "${LATER}"'
          : 'first = "${MISSING}"\nlater = "${LATER}"';
      const filename = files.write(`config.${format}`, content);
      let reads = 0;
      const env: NodeJS.ProcessEnv = Object.defineProperty({}, 'LATER', {
        get() {
          reads++;

          return 'later';
        }
      });
      const loader = new ConfigLoader({ env, inheritProcessEnv: false });

      expect(() => loader.loadConfigFile(filename)).to.throw('MISSING');
      expect(reads).equal(0);
      env.MISSING = 'available';
      expect(loader.loadConfigFile(filename)).deep.equal({ first: 'available', later: 'later' });
      expect(reads).equal(1);
    });
  }

  it('captures sibling getters before recursive resolution and retains the single-key probe', () => {
    const events: string[] = [];
    const filename = files.write('config.yaml', 'placeholder: true');
    const parsed = {
      get first() {
        events.push('first');

        return '${VALUE}';
      },
      get second() {
        events.push('second');

        return {
          get child() {
            events.push('child');

            return 'nested';
          }
        };
      }
    };
    const env = Object.defineProperty({}, 'VALUE', {
      get() {
        events.push('environment');

        return 'synthetic';
      }
    });
    const loader = new ConfigLoader({ env, inheritProcessEnv: false });
    const parser = loader as unknown as { parseYaml(raw: string): unknown };
    sinon.stub(parser, 'parseYaml').returns(parsed);

    expect(loader.loadYamlConfig(filename)).deep.equal({
      first: 'synthetic',
      second: { child: 'nested' }
    });
    expect(events).deep.equal(['first', 'second', 'environment', 'child', 'child']);
  });

  it('keeps YAML aliases detached while repeated mixed-format includes share their cached result', () => {
    files.write('part.json', '{"items":[{"value":"synthetic"}]}');
    files.write(
      'part.toml',
      'value = { "$include" = "./part.json#items.0" }\nclear = { "$null" = true }'
    );
    const filename = files.write(
      'config.yaml',
      [
        'first: &shared {value: synthetic}',
        'second: *shared',
        'include: {$include: ./part.toml}',
        'again: {$include: ./part.toml}'
      ].join('\n')
    );
    const result = new ConfigLoader().loadYamlConfig(filename);

    expect(result.first).deep.equal(result.second);
    expect(result.first).not.equal(result.second);
    expect(result.include).equal(result.again);
    expect(result.include).deep.equal({ value: { value: 'synthetic' }, clear: null });
  });
});
