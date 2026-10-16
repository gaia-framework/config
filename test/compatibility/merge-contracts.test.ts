import { expect } from 'chai';
import { mergeAll, mergeConfig } from '../../src/merge.js';

describe('Merge property construction compatibility', () => {
  it('merges deterministic nested values and special keys with explicit expected graphs', () => {
    const names = ['ordinary', '__proto__', 'constructor', 'toString', '', 'a.b', '01'];
    for (let index = 0; index < 250; index++) {
      const key = names[index % names.length]!;
      const shared = [index, { nested: true }];
      const untouched = { identity: index };
      const base = Object.fromEntries([
        [key, { keep: index, replaced: [0], cleared: true }],
        ['untouched', untouched]
      ]);
      const override = Object.fromEntries([
        [key, { extra: index + 1, replaced: shared, cleared: null, ignored: undefined }]
      ]);
      const expected = Object.fromEntries([
        [key, { keep: index, replaced: shared, cleared: null, extra: index + 1 }],
        ['untouched', untouched]
      ]);
      const actual = mergeAll([base, override, { [key]: undefined }]);
      expect(actual).deep.equal(expected);
      expect(Object.keys(actual)).deep.equal(Object.keys(expected));
      expect(Object.getOwnPropertyDescriptors(actual)).deep.equal(
        Object.getOwnPropertyDescriptors(expected)
      );
      expect(Object.getPrototypeOf(actual)).equal(Object.prototype);
      expect(actual[key].replaced).equal(shared);
      expect(mergeConfig(base, override).untouched).equal(untouched);
      expect(base[key].cleared).equal(true);
    }
  });

  it('preserves getter observation order, source descriptors and array identity', () => {
    function observe(merge: typeof mergeConfig) {
      const calls: string[] = [];
      const shared = [1, 2];
      const symbol = Symbol.for('config-merge-synthetic');
      const base = Object.freeze({
        get first() {
          calls.push('base first');

          return { keep: true };
        },
        [symbol]: 'retained'
      });
      const override = {
        get first() {
          calls.push('override first');

          return {
            get child() {
              calls.push('nested child');

              return shared;
            }
          };
        },
        get second() {
          calls.push('override second');

          return shared;
        },
        ignored: undefined
      };
      const result = merge(base, override);

      expect(result.first.child).equal(shared);
      expect(result.second).equal(shared);
      expect(Object.isFrozen(base)).equal(true);
      expect(Object.getOwnPropertyDescriptor(base, 'first')!.get).a('function');

      return { calls, result, descriptors: Object.getOwnPropertyDescriptors(result) };
    }

    const observed = observe(mergeConfig);
    expect(observed.calls).deep.equal([
      'base first',
      'override first',
      'override second',
      'nested child'
    ]);
    expect(observed.result).deep.equal({
      first: { keep: true, child: [1, 2] },
      second: [1, 2],
      [Symbol.for('config-merge-synthetic')]: 'retained'
    });
    expect(observed.descriptors.first).deep.equal({
      value: { keep: true, child: [1, 2] },
      enumerable: true,
      configurable: true,
      writable: true
    });
  });

  for (const kind of ['setter', 'getter', 'readonly']) {
    it(`keeps inherited ${kind} properties as own data without invoking accessors`, () => {
      const key = 'syntheticMergeProperty';
      expect(Object.hasOwn(Object.prototype, key)).equal(false);
      const descriptor =
        kind === 'readonly'
          ? { value: 'inherited', writable: false }
          : {
              [kind === 'setter' ? 'set' : 'get']: () => {
                throw new Error('Inherited accessor must not run');
              }
            };
      Object.defineProperty(Object.prototype, key, { configurable: true, ...descriptor });

      try {
        const layers = [{ [key]: { [key]: 'first' } }, { [key]: { extra: true } }];
        const actual = mergeAll(layers);

        expect(actual).deep.equal({ [key]: { [key]: 'first', extra: true } });
        expect(Object.getOwnPropertyDescriptor(actual, key)).deep.equal({
          value: { [key]: 'first', extra: true },
          configurable: true,
          enumerable: true,
          writable: true
        });
      } finally {
        Reflect.deleteProperty(Object.prototype, key);
      }
    });
  }

  it('checks inherited properties after resolving nested getters', () => {
    const key = 'syntheticLateMergeProperty';
    expect(Object.hasOwn(Object.prototype, key)).equal(false);
    const nested = {
      get child() {
        Object.defineProperty(Object.prototype, key, {
          configurable: true,
          set() {
            throw new Error('A newly installed setter must not run');
          }
        });

        return 'retained';
      }
    };

    try {
      expect(mergeConfig({}, { [key]: nested })).deep.equal({ [key]: { child: 'retained' } });
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
    }
  });
});
