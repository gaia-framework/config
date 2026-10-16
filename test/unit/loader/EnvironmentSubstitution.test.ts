import { expect } from 'chai';
import sinon from 'sinon';
import { EnvironmentSubstitution } from '../../../src/loader/EnvironmentSubstitution.js';

describe('EnvironmentSubstitution', () => {
  it('preserves ordinary strings exactly without reading the environment', () => {
    const substitution = new EnvironmentSubstitution({ env: {}, inheritProcessEnv: false });
    const read = sinon.spy(substitution, 'read');

    for (const input of [
      '',
      'plain',
      '  true  ',
      'false',
      '$',
      '$$value',
      '$ {name}',
      '}',
      '日本語',
      '\ntext\t'
    ]) {
      expect(substitution.resolveScalar(input)).to.equal(input);
      expect(substitution.substitute(input)).to.equal(input);
    }

    expect(read.called).to.equal(false);
  });

  it('reuses expression metadata while observing every environment read and failure', () => {
    let value: string | undefined = 'first';
    let reads = 0;
    const env = Object.defineProperty({}, 'VALUE', {
      get() {
        reads++;

        return value;
      }
    });
    const substitution = new EnvironmentSubstitution({ env, inheritProcessEnv: false });

    expect(substitution.resolveScalar('${VALUE:-fallback}')).to.equal('first');

    value = 'second';
    expect(substitution.substitute('prefix/${VALUE:-fallback}')).to.equal('prefix/second');

    value = '';
    expect(substitution.resolveScalar('${VALUE:-fallback}')).to.equal('fallback');

    value = undefined;
    expect(substitution.resolveScalar('${VALUE:-fallback}')).to.equal('fallback');
    expect(() => substitution.resolveScalar('${VALUE}')).to.throw(/not set/);

    value = 'restored';
    expect(substitution.resolveScalar('${VALUE}')).to.equal('restored');
    expect(reads).to.equal(6);
  });

  it('keeps cached boolean fallbacks context-sensitive and environment values fresh', () => {
    const env = { FLAG: '' };
    const substitution = new EnvironmentSubstitution({ env, inheritProcessEnv: false });

    expect(substitution.substitute('flag=${FLAG:-"true"}')).to.equal('flag=true');
    expect(substitution.resolveScalar('${FLAG:-"true"}')).to.equal(true);

    env.FLAG = 'FALSE';
    expect(substitution.resolveScalar('${FLAG:-"true"}')).to.equal(false);
    expect(substitution.substitute('flag=${FLAG:-"true"}')).to.equal('flag=FALSE');

    env.FLAG = 'invalid';
    expect(() => substitution.resolveScalar('${FLAG:-"true"}')).to.throw(
      /must be "true" or "false"/
    );

    env.FLAG = ' true ';
    expect(substitution.resolveScalar('${FLAG:-"true"}')).to.equal(true);
  });

  it('bounds cached metadata while resolving new expressions after saturation', () => {
    const substitution = new EnvironmentSubstitution({ env: {}, inheritProcessEnv: false });
    const state = substitution as unknown as { expressionCache: Map<string, unknown> | undefined };

    expect(substitution.substitute('ordinary')).to.equal('ordinary');
    expect(state.expressionCache).to.equal(undefined);

    for (let index = 0; index < 1000; index++) {
      expect(substitution.resolveScalar(`\${ITEM_${index}:-value-${index}}`)).to.equal(
        `value-${index}`
      );
    }

    expect(state.expressionCache?.size).to.equal(256);
    expect(substitution.resolveScalar('${ITEM_0:-value-0}')).to.equal('value-0');
    expect(substitution.resolveScalar('${AFTER_LIMIT:-extra}')).to.equal('extra');
    expect(substitution.substitute('${AFTER_LIMIT:-extra}')).to.equal('extra');
    expect(state.expressionCache?.size).to.equal(256);
  });

  it('limits cached expression length without limiting supported string lengths', () => {
    const substitution = new EnvironmentSubstitution({ env: {}, inheritProcessEnv: false });
    const state = substitution as unknown as { expressionCache: Map<string, unknown> | undefined };
    const fallback = 'x'.repeat(1018);
    const expression = `ITEM:-${fallback}`;

    expect(expression.length).to.equal(1024);
    expect(substitution.resolveScalar(`\${${expression}}`)).to.equal(fallback);
    expect(state.expressionCache?.size).to.equal(1);
    expect(substitution.resolveScalar(`\${${expression}x}`)).to.equal(`${fallback}x`);
    expect(substitution.substitute(`prefix/\${${expression}x}`)).to.equal(`prefix/${fallback}x`);
    expect(state.expressionCache?.size).to.equal(1);

    const longOnly = new EnvironmentSubstitution({ env: {}, inheritProcessEnv: false });
    const longState = longOnly as unknown as { expressionCache: Map<string, unknown> | undefined };

    expect(longOnly.resolveScalar(`\${${expression}x}`)).to.equal(`${fallback}x`);
    expect(longState.expressionCache).to.equal(undefined);
  });

  it('preserves UTF-16 expression keys and fallback strings when storing metadata', () => {
    const env = { ['NAME\uD800']: 'first' };
    const substitution = new EnvironmentSubstitution({ env, inheritProcessEnv: false });

    for (let index = 0; index < 2; index++) {
      expect(substitution.resolveScalar('${NAME\uD800}')).to.equal('first');
      expect(substitution.resolveScalar('${MISSING:-value\uDFFF}')).to.equal('value\uDFFF');
      expect(substitution.substitute('prefix/${MISSING:-value\uDFFF}')).to.equal(
        'prefix/value\uDFFF'
      );
    }
  });

  it('retains placeholder, escaping and boolean semantics when an opening is present', () => {
    const substitution = new EnvironmentSubstitution({
      env: { NAME: 'worker', ENABLED: 'FALSE', EMPTY: '', NESTED: '${NAME}' },
      inheritProcessEnv: false
    });
    const cases: Array<[string, string | boolean]> = [
      ['${NAME}', 'worker'],
      ['  ${NAME}  ', 'worker'],
      ['path/${NAME}', 'path/worker'],
      ['${MISSING:-fallback}', 'fallback'],
      ['${EMPTY:-""}', ''],
      ['${MISSING:-false}', false],
      ['${ENABLED:-true}', false],
      ['${NESTED}', '${NAME}'],
      ['$${NAME}', '${NAME}'],
      ['$$${NAME}', '$${NAME}'],
      ['literal $${NAME}, resolved ${NAME}', 'literal ${NAME}, resolved worker'],
      ['${', '${'],
      ['${}', '${}']
    ];

    for (const [input, expected] of cases) {
      expect(substitution.resolveScalar(input), input).to.equal(expected);
    }

    expect(() => substitution.resolveScalar('${MISSING}')).to.throw(/not set/);
    expect(() => substitution.resolveScalar('${NAME:-true}')).to.throw(/must be "true" or "false"/);
  });
});
