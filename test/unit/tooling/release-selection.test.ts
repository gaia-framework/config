import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sinon from 'sinon';

import {
  assertArchiveMatches,
  compareVersions,
  packageName,
  publishIfNeeded,
  registryVersion,
  releasePlan,
  versionChanged
} from '../../../scripts/release.js';
import { fixture } from '../../support/fixtures.js';

const version = '0.2.0';
const manifest = { name: packageName, version };
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'gaia-framework/config',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: '1'.repeat(40),
  GITHUB_WORKFLOW_REF: 'gaia-framework/config/.github/workflows/publish.yml@refs/heads/main',
  NPM_TRUSTED_PUBLISHING_ENABLED: 'true',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-test-only'
};

describe('Release selection and retry safety', () => {
  afterEach(() => sinon.restore());

  it('skips unchanged versions and requires forward semantic-version changes', () => {
    assert.equal(versionChanged(manifest, manifest), false);
    assert.equal(versionChanged({ ...manifest, version: '0.1.9' }, manifest), true);
    assert.throws(() => versionChanged(manifest, { ...manifest, version: '0.1.9' }), /increase/);
    assert.throws(() => versionChanged({ ...manifest, name: 'other' }, manifest), /identity/);
    assert.throws(() => versionChanged(manifest, { ...manifest, name: 'other' }), /identity/);
  });

  for (const [older, newer] of [
    ['0.9.0', '0.10.0'],
    ['0.10.99', '1.0.0'],
    ['1.0.0', '1.0.1'],
    ['1.0.0-alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.9', '1.0.0-alpha.10'],
    ['1.0.0-alpha.10', '1.0.0-alpha.beta'],
    ['1.0.0-beta', '1.0.0-rc.1'],
    ['1.0.0-rc.1', '1.0.0']
  ]) {
    it(`orders ${older} before ${newer}`, () => {
      assert.equal(compareVersions(older!, newer!), -1);
      assert.equal(compareVersions(newer!, older!), 1);
      assert.equal(compareVersions(older!, older!), 0);
    });
  }

  for (const invalid of [
    'v1.0.0',
    '01.0.0',
    '1.0',
    '1.0.0-01',
    '1.0.0-a..b',
    '1.0.0+build',
    '1.0.0\n',
    '1.0.0\ninjected=true',
    '9007199254740992.0.0'
  ]) {
    it(`rejects invalid or unsupported version ${JSON.stringify(invalid)}`, () => {
      assert.throws(() => releasePlan(env, { ...manifest, version: invalid }));
    });
  }

  it('does not request OIDC or invoke npm when matching published bytes already exist', async () => {
    const files = fixture();
    try {
      const archive = files.write('package.tgz', 'synthetic archive');
      const published = {
        ...manifest,
        dist: {
          integrity: `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`
        }
      };
      const run = sinon.stub();
      const lookup = sinon.stub().resolves(published);

      await publishIfNeeded(archive, { version, tag: 'latest', dryRun: false }, env, run, lookup);

      sinon.assert.notCalled(run);
      sinon.assert.calledOnceWithExactly(lookup, version);
      assert.throws(() => assertArchiveMatches(archive, version, null), /not yet visible/);
      assert.throws(
        () => assertArchiveMatches(archive, version, { ...published, name: 'other' }),
        /package/
      );
      assert.throws(
        () => assertArchiveMatches(archive, version, { ...published, version: '0.1.0' }),
        /version/
      );
    } finally {
      files.dispose();
    }
  });

  it('refuses different published bytes without retrying upload', async () => {
    const files = fixture();
    try {
      const archive = files.write('package.tgz', 'synthetic archive');
      const run = sinon.stub();
      const lookup = sinon.stub().resolves({ ...manifest, dist: { integrity: 'sha512-other' } });

      await assert.rejects(
        publishIfNeeded(archive, { version, tag: 'latest', dryRun: false }, env, run, lookup),
        /differs/
      );

      sinon.assert.notCalled(run);
    } finally {
      files.dispose();
    }
  });

  it('inspects and uploads a missing version while preserving dry-run behavior', async () => {
    for (const dryRun of [true, false]) {
      const run = sinon.stub().returns('[]');
      run.onFirstCall().returns(JSON.stringify([manifest]));
      const lookup = sinon.stub().resolves(null);
      lookup
        .withArgs('latest')
        .resolves({ ...manifest, version: '0.1.0', dist: { integrity: 'synthetic' } });

      await publishIfNeeded('package.tgz', { version, tag: 'latest', dryRun }, env, run, lookup);

      assert.equal(run.callCount, 2);
      assert.equal(run.secondCall.args[0].includes('--dry-run'), dryRun);
    }
  });

  it('rejects tag downgrades and a version still processing before invoking npm', async () => {
    for (const existing of [version, '0.3.0']) {
      const run = sinon.stub();
      const lookup = sinon.stub().resolves(null);
      lookup
        .withArgs('latest')
        .resolves({ ...manifest, version: existing, dist: { integrity: 'synthetic' } });

      await assert.rejects(
        publishIfNeeded('package.tgz', { version, tag: 'latest', dryRun: false }, env, run, lookup),
        /backwards|processing/
      );

      sinon.assert.notCalled(run);
    }
  });

  it('does not treat network failures as an unpublished version', async () => {
    const run = sinon.stub();
    const lookup = sinon.stub().rejects(new Error('registry unavailable'));

    await assert.rejects(
      publishIfNeeded('package.tgz', { version, tag: 'latest', dryRun: false }, env, run, lookup),
      /registry unavailable/
    );

    sinon.assert.notCalled(run);
  });

  it('rejects fork contexts before any registry lookup', async () => {
    const lookup = sinon.stub();

    await assert.rejects(
      publishIfNeeded(
        'package.tgz',
        { version, tag: 'latest', dryRun: false },
        { ...env, GITHUB_REPOSITORY: 'fork/config' },
        sinon.stub(),
        lookup
      ),
      /original main/
    );

    sinon.assert.notCalled(lookup);
  });

  it('uses anonymous exact-version lookups and only treats HTTP 404 as missing', async () => {
    const request = sinon.stub(globalThis, 'fetch');
    const published = { ...manifest, dist: { integrity: 'synthetic' } };
    request.resolves(Response.json(published));
    assert.deepEqual(await registryVersion(version), published);
    assert.equal(
      request.firstCall.args[0],
      'https://registry.npmjs.org/%40gaia-framework%2Fconfig/0.2.0'
    );
    assert.equal(request.firstCall.args[1]?.headers, undefined);
    request.resolves(new Response(null, { status: 404 }));
    assert.equal(await registryVersion(version), null);

    for (const status of [401, 403, 429, 500]) {
      request.resolves(new Response(null, { status }));
      await assert.rejects(registryVersion(version), new RegExp(`HTTP ${status}`));
    }

    for (const invalid of [null, {}, { ...manifest, dist: {} }]) {
      request.resolves(Response.json(invalid));
      await assert.rejects(registryVersion(version), /invalid release metadata/);
    }
  });
});
