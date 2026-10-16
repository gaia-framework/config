import { expect } from 'chai';
import { ConfigLoader } from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

describe('Substitution contracts', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;

  beforeEach(() => {
    files = fixture();
  });

  afterEach(() => files.dispose());

  const cases: Array<[string, string | boolean]> = [
    ['$${VALUE}', '${VALUE}'],
    ['$$${VALUE}', '$${VALUE}'],
    ['$${}', '${}'],
    ['$${unfinished', '${unfinished'],
    ['$${MISSING} ${VALUE} $${MISSING}', '${MISSING} value $${KEEP} ${KEEP} ${MISSING}'],
    ['${MISSING:-$${KEEP}}', '${KEEP}'],
    ['${MISSING:-$${KEEP}', '${KEEP'],
    ['${MISSING:-"$${KEEP}"}', '"${KEEP"}'],
    ['prefix ${MISSING:-$${KEEP}} suffix', 'prefix ${KEEP} suffix'],
    ['${MISSING:-"\\u0024\\u0024{KEEP"}', '$${KEEP'],
    ['prefix ${MISSING:-"\\u0024\\u0024{KEEP"}', 'prefix $${KEEP'],
    ['${VALUE}', 'value $${KEEP} ${KEEP}'],
    ['prefix ${VALUE}', 'prefix value $${KEEP} ${KEEP}'],
    ['${MISSING:-false}', false],
    ['$${MISSING:-false}', '${MISSING:-false}'],
    ['  $${MISSING}  ', '  ${MISSING}  ']
  ];

  for (const [input, expected] of cases) {
    it(`resolves ${JSON.stringify(input)} without rescanning substituted values`, () => {
      const filename = files.write('config.yaml', JSON.stringify({ value: input }));
      const loader = new ConfigLoader({
        env: { VALUE: 'value $${KEEP} ${KEEP}', MISSING: '' },
        inheritProcessEnv: false
      });
      expect(loader.loadYamlConfig(filename)).deep.equal({ value: expected });
    });
  }

  it('ignores inherited environment values for placeholders and directives', () => {
    const env = Object.create({ constructor: 'inherited' });
    const filename = files.write('config.yaml', 'value: ${constructor:-fallback}');
    const loader = new ConfigLoader({ env, inheritProcessEnv: false });
    expect(loader.loadYamlConfig(filename)).deep.equal({ value: 'fallback' });
    files.write('config.yaml', 'value: {$env: constructor}');
    expect(() => loader.loadYamlConfig(filename)).throw('not set');
  });

  it('redacts invalid environment values while explaining boolean fallback requirements', () => {
    const filename = files.write('config.yaml', 'value: ${VALUE:-false}');
    const loader = new ConfigLoader({
      env: { VALUE: 'synthetic-invalid-value' },
      inheritProcessEnv: false
    });
    expect(() => loader.loadYamlConfig(filename)).throw(
      'Environment variable "VALUE" must be "true" or "false" because the config fallback is boolean (false).'
    );
  });
});
