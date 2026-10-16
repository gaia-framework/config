import { expect } from 'chai';
import {
  applyEnvOverrides,
  readConfigKeyOverrides,
  readConfigObjectEnv
} from '../../src/envOverrides.js';
import { isolatedEnvironment } from '../support/fixtures.js';

describe('environment overrides', () => {
  isolatedEnvironment();
  it('ignores dot-only override paths without adding an empty configuration key', () => {
    expect(readConfigKeyOverrides('CONFIG_', { 'CONFIG_.': '1', 'CONFIG_...': '2' })).deep.equal(
      {}
    );
  });

  it('parses object overrides and rejects malformed or non-object JSON', () => {
    expect(readConfigObjectEnv('CONFIG', {})).to.equal(undefined);
    expect(readConfigObjectEnv('CONFIG', { CONFIG: '' })).to.equal(undefined);
    expect(readConfigObjectEnv('CONFIG', { CONFIG: '{"a":1}' })).to.deep.equal({ a: 1 });
    for (const value of ['[1]', 'null', 'true', '2', '{']) {
      expect(() => readConfigObjectEnv('CONFIG', { CONFIG: value })).to.throw(
        'CONFIG must be valid JSON object:'
      );
    }
  });
  it('decodes nested paths, literal underscores and hyphens; parses JSON or keeps strings', () => {
    const env = {
      CONFIG_a_b: '2',
      CONFIG_under__score: 'true',
      CONFIG_my___provider: '[1,2]',
      CONFIG_clear: 'null',
      CONFIG_text: 'plain',
      CONFIG_obj: '{"ok":true}',
      CONFIG_: 'ignored',
      CONFIG___: 'ignored',
      OTHER_a: 'ignored',
      CONFIG_skip: undefined
    };
    expect(readConfigKeyOverrides('CONFIG_', env)).to.deep.equal({
      a: { b: 2 },
      under_score: true,
      'my-provider': [1, 2],
      clear: null,
      text: 'plain',
      obj: { ok: true },
      _: 'ignored'
    });
    expect(readConfigKeyOverrides('CUSTOM_', { CUSTOM_a: 'false' })).to.deep.equal({ a: false });
  });
  it('replaces non-object intermediate paths and accepts both override calling forms', () => {
    const env = { CONFIG: '{"a":1,"arr":[1]}', CONFIG_a_b: '2', CONFIG_arr: '[2]' };
    expect(applyEnvOverrides({}, env)).to.deep.equal({ a: { b: 2 }, arr: [2] });
    expect(
      applyEnvOverrides({}, { env, objectEnvVar: 'CONFIG', keyPrefix: 'CONFIG_' })
    ).to.deep.equal({ a: { b: 2 }, arr: [2] });
    expect(readConfigKeyOverrides('CONFIG_', { CONFIG_a: '1', CONFIG_a_b: '2' })).to.deep.equal({
      a: { b: 2 }
    });
  });
  it('uses process environment when no environment is supplied', () => {
    process.env.CONFIG = '{"a":1}';
    process.env.CONFIG_a = '2';
    expect(readConfigObjectEnv()).to.deep.equal({ a: 1 });
    expect(readConfigKeyOverrides()).to.deep.equal({ a: 2 });
    expect(applyEnvOverrides({}, { objectEnvVar: 'CONFIG' })).to.deep.equal({ a: 2 });
  });
  it('honors explicitly excluded control names without suppressing similarly named data paths', () => {
    const env = { CONFIG_DIR: 'control', CONFIG_DIR_child: 'data' };
    expect(readConfigKeyOverrides('CONFIG_', env, ['CONFIG_DIR'])).to.deep.equal({
      DIR: { child: 'data' }
    });
    process.env.CONFIG_DIR = 'control';
    process.env.CONFIG_value = 'data';
    expect(applyEnvOverrides({}, { excludedEnvVars: ['CONFIG_DIR'] })).to.deep.equal({
      value: 'data'
    });
  });
});
