import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { npmCliPath, packageName, publishArguments } from '../../scripts/release.js';
import { fixture } from '../support/fixtures.js';

function runNpm(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCliPath(), ...args], { env });
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk;
    });

    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, output });
    });
  });
}

describe('Release upload through the real npm CLI', function () {
  this.timeout(30000);

  const cases = [
    {
      name: 'uploads the exact archive and selected tag to a disposable registry',
      rejected: false
    },
    {
      name: 'reports rejected uploads as failures',
      rejected: true
    }
  ];

  for (const { name, rejected } of cases) {
    it(name, async () => {
      const files = fixture();
      const requests: Array<{ authorization: string | undefined; body: any }> = [];

      const server = createServer(async (request, response) => {
        if (request.method !== 'PUT') {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'not_found' }));

          return;
        }

        const chunks: Buffer[] = [];

        for await (const chunk of request) {
          chunks.push(Buffer.from(chunk));
        }

        requests.push({
          authorization: request.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
        });

        response.writeHead(rejected ? 403 : 201, { 'content-type': 'application/json' });
        response.end(JSON.stringify(rejected ? { error: 'synthetic_forbidden' } : { ok: true }));
      });

      try {
        files.write(
          'package.json',
          JSON.stringify({
            name: packageName,
            version: '0.1.0',
            type: 'module',
            files: ['index.js'],
            scripts: { prepublishOnly: 'node -e "process.exit(99)"' }
          })
        );

        files.write('index.js', 'export const fixture = true;\n');

        const userConfig = files.write('user.npmrc', '');
        const globalConfig = files.write('global.npmrc', '');
        const env = { ...process.env };

        for (const key of Object.keys(env)) {
          if (/^(npm_config_|npm_token$|node_auth_token$)/i.test(key)) {
            delete env[key];
          }
        }

        Object.assign(env, {
          NPM_CONFIG_USERCONFIG: userConfig,
          NPM_CONFIG_GLOBALCONFIG: globalConfig,
          NPM_CONFIG_CACHE: path.join(files.directory, 'cache'),
          NPM_CONFIG_UPDATE_NOTIFIER: 'false',
          NPM_CONFIG_FETCH_RETRIES: '0',
          NPM_CONFIG_PROVENANCE: 'false'
        });

        const [packed] = JSON.parse(
          execFileSync(process.execPath, [npmCliPath(), 'pack', '--json', '--ignore-scripts'], {
            cwd: files.directory,
            env,
            encoding: 'utf8'
          })
        ) as Array<{ filename: string }>;

        assert.ok(packed);

        const archive = path.join(files.directory, packed.filename);

        await new Promise<void>((resolve) => {
          server.listen(0, '127.0.0.1', resolve);
        });

        const port = (server.address() as AddressInfo).port;
        const registry = `http://127.0.0.1:${port}`;

        files.write('user.npmrc', `//127.0.0.1:${port}/:_authToken=synthetic-test-only\n`);

        const args = publishArguments(archive, { version: '0.1.0', tag: 'test', dryRun: false });
        args[args.indexOf('--registry') + 1] = registry;

        const result = await runNpm(args, env);

        assert.equal(result.status === 0, !rejected, result.output);
        assert.equal(requests.length, 1);

        const request = requests[0]!;

        assert.equal(request.authorization, 'Bearer synthetic-test-only');
        assert.equal(request.body.name, packageName);
        assert.deepEqual(request.body['dist-tags'], { test: '0.1.0' });

        const attachment = Object.values(request.body._attachments)[0] as { data: string };
        const uploaded = Buffer.from(attachment.data, 'base64');

        assert.deepEqual(uploaded, readFileSync(archive));
        assert.equal(
          request.body.versions['0.1.0'].dist.integrity,
          `sha512-${createHash('sha512').update(uploaded).digest('base64')}`
        );
      } finally {
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        }

        files.dispose();
      }
    });
  }
});
