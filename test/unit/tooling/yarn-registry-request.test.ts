import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';

import { waitForRegistry } from '../../package/wait-for-registry.js';

describe('Pinned Yarn registry request', () => {
  it('matches the readiness URL and metadata format to a real Yarn install', async () => {
    const name = '@example/config-release-probe';
    const version = '1.0.0';
    const directory = mkdtempSync(path.join(tmpdir(), 'config-registry-probe-'));
    const requests: Array<{ url: string | undefined; accept: string | undefined }> = [];
    const server = createServer((request, response) => {
      requests.push({ url: request.url, accept: request.headers.accept });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name, versions: {}, 'dist-tags': {} }));
    });
    let request: sinon.SinonStub | undefined;

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const registry = `http://127.0.0.1:${address.port}`;
      writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({ private: true, dependencies: { [name]: version } })
      );
      writeFileSync(path.join(directory, 'yarn.lock'), '');
      writeFileSync(
        path.join(directory, '.yarnrc.yml'),
        `npmRegistryServer: "${registry}"\nunsafeHttpWhitelist:\n  - 127.0.0.1\n`
      );
      const yarn = fileURLToPath(
        new URL('../../../.yarn/releases/yarn-4.12.0.cjs', import.meta.url)
      );
      // Resolve from either the source tree or the compiled test tree.
      const runtime = yarn.includes(`${path.sep}dist${path.sep}`)
        ? fileURLToPath(new URL('../../../../.yarn/releases/yarn-4.12.0.cjs', import.meta.url))
        : yarn;
      let output = '';
      const child = spawn(process.execPath, [runtime, 'install'], {
        cwd: directory,
        env: {
          ...process.env,
          YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
          YARN_ENABLE_GLOBAL_CACHE: 'false',
          YARN_GLOBAL_FOLDER: path.join(directory, 'global')
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        output += String(chunk);
      });
      const status = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      assert.equal(status, 1, output);
      assert.match(output, /YN0082/);
      assert.equal(requests.length, 1);

      request = sinon
        .stub(globalThis, 'fetch')
        .resolves(Response.json({ name, versions: { [version]: { name, version } } }));
      await waitForRegistry(name, version);

      const [url, options] = request.firstCall.args as Parameters<typeof fetch>;
      assert.equal(new URL(String(url)).pathname, requests[0]?.url);
      assert.equal(new Headers(options?.headers).get('accept'), requests[0]?.accept ?? null);
    } finally {
      request?.restore();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
