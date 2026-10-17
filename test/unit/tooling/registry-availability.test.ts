import assert from 'node:assert/strict';
import sinon from 'sinon';

import { waitForRegistry } from '../../package/wait-for-registry.js';

const name = '@gaia-framework/config';
const version = '0.1.1';

function metadata(versions: Record<string, unknown> = {}): Response {
  return Response.json({ name, versions });
}

function published(): Response {
  return metadata({ [version]: { name, version } });
}

describe('Public registry availability', () => {
  let clock: sinon.SinonFakeTimers;
  let request: sinon.SinonStub<Parameters<typeof fetch>, ReturnType<typeof fetch>>;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    request = sinon.stub(globalThis, 'fetch');
    sinon.stub(console, 'log');
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  it('checks exact public Yarn resolution metadata without authentication', async () => {
    request.resolves(published());

    await waitForRegistry(name, version);

    sinon.assert.calledOnce(request);
    const [url, options] = request.firstCall.args;
    assert.equal(url, 'https://registry.npmjs.org/@gaia-framework%2fconfig');
    assert.equal(options?.headers, undefined);
    assert.ok(options?.signal instanceof AbortSignal);
    assert.equal(clock.now, 0);
  });

  it('authenticates private metadata requests with the consumer read token', async () => {
    sinon.stub(process, 'env').value({ ...process.env, NPM_TOKEN: 'synthetic-read-token' });
    request.resolves(published());

    await waitForRegistry(name, version);

    assert.deepEqual(request.firstCall.args[1]?.headers, {
      authorization: 'Bearer synthetic-read-token'
    });
  });

  it('waits for the exact version rather than accepting an older latest release', async () => {
    request.onFirstCall().resolves(metadata({ '0.1.0': { name, version: '0.1.0' } }));
    request.onSecondCall().resolves(published());

    const waiting = waitForRegistry(name, version);
    await clock.runAllAsync();
    await waiting;

    sinon.assert.calledTwice(request);
    assert.equal(clock.now, 10_000);
  });

  it('also waits for Yarn installation after metadata becomes available', async () => {
    request.callsFake(async () => published());
    const install = sinon.stub();
    install.onFirstCall().returns({
      status: 1,
      stdout: `\u001b[31mYN0082: ${name}@npm:${version}: No candidates found\u001b[0m`,
      stderr: ''
    });
    install.onSecondCall().returns({ status: 0, stdout: '', stderr: '' });

    const waiting = waitForRegistry(name, version, install);
    await clock.runAllAsync();
    await waiting;

    sinon.assert.calledTwice(install);
    sinon.assert.calledTwice(request);
    assert.equal(clock.now, 10_000);
  });

  it('does not attempt installation until metadata contains the version', async () => {
    request.onFirstCall().resolves(metadata());
    request.onSecondCall().resolves(published());
    const install = sinon.stub().returns({ status: 0, stdout: '', stderr: '' });

    const waiting = waitForRegistry(name, version, install);
    await clock.runAllAsync();
    await waiting;

    sinon.assert.calledOnce(install);
  });

  it('bounds retries when Yarn never resolves the newly published version', async () => {
    request.callsFake(async () => published());
    const install = sinon.stub().returns({
      status: 1,
      stdout: `YN0082: ${name}@npm:${version}: No candidates found`,
      stderr: ''
    });

    const failure = assert.rejects(
      waitForRegistry(name, version, install),
      /after 30 checks.*do not republish/
    );
    await clock.runAllAsync();
    await failure;

    assert.equal(install.callCount, 30);
    assert.equal(clock.now, 290_000);
  });

  for (const output of [
    `YN0041: ${name}@npm:${version}: Invalid authentication`,
    'YN0082: another-package@npm:1.0.0: No candidates found',
    `YN0082: ${name}@npm:9.9.9: No candidates found`,
    `YN0082: ${name}@npm:${version}: No candidates found\nYN0041: Invalid authentication`,
    `YN0082: ${name}@npm:${version}: No candidates found\nYN0082: dependency@npm:1.0.0: No candidates found`,
    'A lifecycle script failed.'
  ]) {
    it(`does not retry a terminal installation failure: ${output}`, async () => {
      request.resolves(published());
      const install = sinon.stub().returns({ status: 1, stdout: output, stderr: '' });

      await assert.rejects(waitForRegistry(name, version, install), /installation failed/);

      sinon.assert.calledOnce(install);
      assert.equal(clock.now, 0);
    });
  }

  it('does not retry a failed process launch', async () => {
    request.resolves(published());
    const error = new Error('Unable to launch Yarn');
    const install = sinon.stub().returns({ status: null, error, stdout: '', stderr: '' });

    await assert.rejects(waitForRegistry(name, version, install), error);

    sinon.assert.calledOnce(install);
  });

  it('does not retry an interrupted installation', async () => {
    request.resolves(published());
    const install = sinon.stub().returns({
      status: null,
      signal: 'SIGTERM',
      stdout: `YN0082: ${name}@npm:${version}: No candidates found`,
      stderr: ''
    });

    await assert.rejects(waitForRegistry(name, version, install), /installation failed/);

    sinon.assert.calledOnce(install);
  });

  it('uses the plain package path for unscoped packages', async () => {
    request.resolves(
      Response.json({ name: 'example', versions: { [version]: { name: 'example', version } } })
    );

    await waitForRegistry('example', version);

    assert.equal(request.firstCall.args[0], 'https://registry.npmjs.org/example');
  });

  for (const status of [404, 429, 500, 503]) {
    it(`retries HTTP ${status} before accepting the published version`, async () => {
      request.onFirstCall().resolves(new Response(null, { status }));
      request.onSecondCall().resolves(published());

      const waiting = waitForRegistry(name, version);
      await clock.runAllAsync();
      await waiting;

      sinon.assert.calledTwice(request);
    });
  }

  for (const error of [
    new TypeError('fetch failed'),
    new DOMException('timeout', 'TimeoutError')
  ]) {
    it(`retries a transient ${error.name}`, async () => {
      request.onFirstCall().rejects(error);
      request.onSecondCall().resolves(published());

      const waiting = waitForRegistry(name, version);
      await clock.runAllAsync();
      await waiting;

      sinon.assert.calledTwice(request);
    });
  }

  it('fails after a bounded number of checks without retrying publication', async () => {
    request.callsFake(async () => metadata());

    const failure = assert.rejects(
      waitForRegistry(name, version),
      /after 30 checks.*do not republish/
    );
    await clock.runAllAsync();
    await failure;

    assert.equal(request.callCount, 30);
    assert.equal(clock.now, 290_000);
  });

  for (const status of [400, 401, 403]) {
    it(`fails immediately on HTTP ${status}`, async () => {
      request.resolves(new Response(null, { status }));

      await assert.rejects(waitForRegistry(name, version), new RegExp(`HTTP ${status}`));

      sinon.assert.calledOnce(request);
    });
  }

  it('does not mask malformed JSON', async () => {
    request.resolves(new Response('invalid json'));

    await assert.rejects(waitForRegistry(name, version), SyntaxError);

    sinon.assert.calledOnce(request);
  });

  for (const errorName of ['TimeoutError', 'AbortError']) {
    it(`retries ${errorName} while reading the response body`, async () => {
      const response = published();
      sinon.stub(response, 'json').rejects(new DOMException('timeout', errorName));
      request.onFirstCall().resolves(response);
      request.onSecondCall().resolves(published());

      const waiting = waitForRegistry(name, version);
      await clock.runAllAsync();
      await waiting;

      sinon.assert.calledTwice(request);
    });
  }

  for (const invalid of [
    null,
    [],
    { name },
    { name, versions: null },
    { name, versions: { [version]: null } }
  ]) {
    it(`rejects malformed metadata ${JSON.stringify(invalid)}`, async () => {
      request.resolves(Response.json(invalid));

      await assert.rejects(waitForRegistry(name, version), /invalid .*metadata/);

      sinon.assert.calledOnce(request);
    });
  }

  it('does not mask unexpected failures', async () => {
    request.rejects(new Error('unexpected failure'));

    await assert.rejects(waitForRegistry(name, version), /unexpected failure/);

    sinon.assert.calledOnce(request);
  });

  for (const release of [
    { name: 'another-package', version },
    { name, version: '0.1.0' }
  ]) {
    it(`rejects a mismatched release ${JSON.stringify(release)}`, async () => {
      request.resolves(metadata({ [version]: release }));

      await assert.rejects(waitForRegistry(name, version), /unexpected release/);

      sinon.assert.calledOnce(request);
    });
  }

  it('rejects metadata for another package', async () => {
    request.resolves(Response.json({ name: 'another-package', versions: {} }));

    await assert.rejects(waitForRegistry(name, version), /unexpected package/);

    sinon.assert.calledOnce(request);
  });
});
