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
    assert.equal(url, 'https://registry.npmjs.org/%40gaia-framework%2Fconfig');
    assert.deepEqual(options?.headers, { accept: 'application/vnd.npm.install-v1+json' });
    assert.ok(options?.signal instanceof AbortSignal);
    assert.equal(clock.now, 0);
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
