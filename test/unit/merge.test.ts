import { expect } from 'chai';
import { mergeAll, mergeConfig } from '../../src/merge.js';

describe('mergeConfig', () => {
  it('deep merges objects and replaces arrays, primitives and null', () => {
    const original = { nested: { keep: 1, replace: 2 }, array: [1], clear: 'value' };
    expect(
      mergeConfig(original, { nested: { replace: false }, array: [2], clear: null })
    ).to.deep.equal({ nested: { keep: 1, replace: false }, array: [2], clear: null });
    expect(original.nested.replace).to.equal(2);
    expect(mergeConfig(1, { nested: true })).to.deep.equal({ nested: true });
  });
  it('ignores undefined, including nested values, and merges in order', () => {
    expect(mergeConfig({ key: 1 }, undefined)).to.deep.equal({ key: 1 });
    expect(
      mergeAll([
        { key: 1, nested: { key: 2 } },
        { key: undefined, nested: { key: undefined } },
        { extra: 3 }
      ])
    ).to.deep.equal({ key: 1, nested: { key: 2 }, extra: 3 });
    expect(mergeAll([])).to.deep.equal({});
  });
});
