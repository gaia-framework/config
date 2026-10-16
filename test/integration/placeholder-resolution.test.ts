import { expect } from 'chai';
import * as yaml from 'js-yaml';
import { stringify } from 'smol-toml';
import { ConfigLoader } from '../../src/index.js';
import { fixture } from '../support/fixtures.js';

describe('placeholder metadata reuse through file loading', () => {
  let files: ReturnType<typeof fixture>;

  beforeEach(() => {
    files = fixture();
  });

  afterEach(() => files.dispose());

  for (const format of ['yaml', 'toml'] as const) {
    function write(name: string, data: Record<string, unknown>): string {
      return files.write(name, format === 'yaml' ? yaml.dump(data) : stringify(data));
    }

    it(`observes every environment getter across repeated ${format} loads`, () => {
      let reads = 0;
      const env = Object.defineProperty({}, 'VALUE', {
        get() {
          return `read${++reads}`;
        }
      });
      const filename = write(`config.${format}`, {
        values: ['${VALUE:-fallback}', '${VALUE:-fallback}', 'prefix/${VALUE:-fallback}'],
        selected: { $env: 'VALUE' }
      });
      const loader = new ConfigLoader({ env, inheritProcessEnv: false });

      expect(loader.loadConfigFile(filename)).to.deep.equal({
        values: ['read1', 'read2', 'prefix/read3'],
        selected: 'read4'
      });
      expect(loader.loadConfigFile(filename)).to.deep.equal({
        values: ['read5', 'read6', 'prefix/read7'],
        selected: 'read8'
      });
      expect(reads).to.equal(8);
    });

    it(`preserves literal, substituted and escaped ${format} directive arguments`, () => {
      files.write('message.txt', 'synthetic text');
      files.write('part.json', '{"section":{"value":"${NAME:-first}"}}');
      files.write('${piece}.json', '{"value":"escaped path"}');

      const filename = write(`config.${format}`, {
        literalEnvironment: { $env: 'NAME' },
        substitutedEnvironment: { $env: '${VARIABLE:-NAME}' },
        literalText: { $file: './message.txt' },
        substitutedText: { $file: '${TEXT:-./message.txt}' },
        literalInclude: { $include: './part.json#section' },
        substitutedInclude: { $include: '${PART:-./part.json}#section' },
        escapedInclude: { $include: './$${piece}.json' },
        flags: ['${FLAG:-true}', 'flag=${FLAG:-true}', '$${FLAG:-true}']
      });
      const env = { NAME: 'first', FLAG: 'false' };
      const loader = new ConfigLoader({ env, inheritProcessEnv: false });
      const first = loader.loadConfigFile(filename);

      expect(first).to.deep.equal({
        literalEnvironment: 'first',
        substitutedEnvironment: 'first',
        literalText: 'synthetic text',
        substitutedText: 'synthetic text',
        literalInclude: { value: 'first' },
        substitutedInclude: { value: 'first' },
        escapedInclude: { value: 'escaped path' },
        flags: [false, 'flag=false', '${FLAG:-true}']
      });
      expect(first.literalInclude).to.equal(first.substitutedInclude);

      env.NAME = 'second';
      env.FLAG = 'true';

      const second = loader.loadConfigFile(filename);

      expect(second.literalEnvironment).to.equal('second');
      expect(second.substitutedEnvironment).to.equal('second');
      expect(second.flags).to.deep.equal([true, 'flag=true', '${FLAG:-true}']);
      expect(second.literalInclude).to.equal(first.literalInclude);

      const fresh = new ConfigLoader({ env, inheritProcessEnv: false }).loadConfigFile(filename);

      expect(fresh.literalInclude).to.deep.equal({ value: 'second' });
    });
  }
});
