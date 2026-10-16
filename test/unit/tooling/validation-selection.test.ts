import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sinon from 'sinon';

import { validationRequired } from '../../../scripts/select-validation.js';

const env: NodeJS.ProcessEnv = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/feature/config',
  GITHUB_REPOSITORY: 'contributor/config',
  GITHUB_SHA: '1'.repeat(40),
  GH_TOKEN: 'synthetic-token'
};

function response(runs: unknown[]): Response {
  return Response.json({ workflow_runs: runs });
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: 'pull_request',
    head_sha: env.GITHUB_SHA,
    status: 'in_progress',
    conclusion: null,
    ...overrides
  };
}

describe('CI validation selection', () => {
  it('always validates PRs, main pushes and manual calls without an API request', async () => {
    const request = sinon.stub().rejects(new Error('Unexpected API request'));

    for (const overrides of [
      { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_EVENT_NAME: 'workflow_dispatch' },
      { GITHUB_EVENT_NAME: 'workflow_call' },
      { GITHUB_REF: 'refs/heads/main' }
    ]) {
      assert.equal(await validationRequired({ ...env, ...overrides }, request), true);
    }

    assert.equal(request.callCount, 0);
  });

  it('validates feature pushes without PR CI, including forks', async () => {
    const request = sinon.stub().resolves(response([]));

    assert.equal(await validationRequired(env, request), true);

    const [endpoint, options] = request.firstCall.args;
    assert.equal(endpoint.origin, 'https://api.github.com');
    assert.equal(endpoint.pathname, '/repos/contributor/config/actions/workflows/ci.yml/runs');
    assert.equal(endpoint.searchParams.get('event'), 'pull_request');
    assert.equal(endpoint.searchParams.get('head_sha'), env.GITHUB_SHA);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.ok(options.signal instanceof AbortSignal);
  });

  it('skips duplicate pushes only for queued, active or completed PR checks at the same SHA', async () => {
    for (const state of [
      { status: 'queued' },
      { status: 'in_progress' },
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' }
    ]) {
      const request = sinon.stub().resolves(response([run(state)]));
      assert.equal(await validationRequired(env, request), false);
    }
  });

  it('keeps coverage when PR CI was canceled, skipped, blocked or belongs to another commit/event', async () => {
    const runs = [
      ...['cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'neutral'].map(
        (conclusion) => run({ status: 'completed', conclusion })
      ),
      run({ status: 'waiting' }),
      run({ status: 'unknown' }),
      run({ head_sha: '2'.repeat(40) }),
      run({ event: 'push' }),
      null,
      {}
    ];

    assert.equal(await validationRequired(env, sinon.stub().resolves(response(runs))), true);
  });

  it('runs validation on HTTP errors, invalid JSON and unexpected response shapes', async () => {
    const warning = sinon.stub(console, 'warn');

    try {
      for (const result of [
        new Response('Forbidden', { status: 403 }),
        new Response('Unavailable', { status: 503 }),
        new Response('invalid json'),
        Response.json(null),
        Response.json({}),
        Response.json({ workflow_runs: {} })
      ]) {
        assert.equal(await validationRequired(env, sinon.stub().resolves(result)), true);
      }

      assert.equal(warning.callCount, 6);
    } finally {
      warning.restore();
    }
  });

  it('runs validation when credentials are unavailable or the lookup times out', async () => {
    const warning = sinon.stub(console, 'warn');
    const request = sinon.stub().rejects(new Error('Timeout'));

    try {
      assert.equal(await validationRequired({ ...env, GH_TOKEN: undefined }, request), true);
      assert.equal(request.callCount, 0);
      assert.equal(await validationRequired(env, request), true);
      assert.equal(request.callCount, 1);
    } finally {
      warning.restore();
    }
  });

  it('writes the actual workflow output when executed directly by Node 24', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'config-ci-selection-'));
    const output = path.join(directory, 'output');

    try {
      execFileSync(process.execPath, ['scripts/select-validation.ts'], {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_OUTPUT: output
        }
      });

      assert.equal(readFileSync(output, 'utf8'), 'required=true\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
