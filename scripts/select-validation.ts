import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function coversCommit(value: unknown, commit: string): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const run = value as Record<string, unknown>;

  if (run.event !== 'pull_request' || run.head_sha !== commit) {
    return false;
  }

  return (
    run.status === 'queued' ||
    run.status === 'in_progress' ||
    (run.status === 'completed' && ['success', 'failure'].includes(String(run.conclusion)))
  );
}

export async function validationRequired(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch
): Promise<boolean> {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF === 'refs/heads/main') {
    return true;
  }

  try {
    assert.ok(env.GITHUB_REPOSITORY && env.GITHUB_SHA && env.GH_TOKEN);
    const commit = env.GITHUB_SHA;

    const endpoint = new URL(
      `/repos/${env.GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs`,
      env.GITHUB_API_URL ?? 'https://api.github.com'
    );
    endpoint.searchParams.set('event', 'pull_request');
    endpoint.searchParams.set('head_sha', commit);
    endpoint.searchParams.set('per_page', '100');

    const response = await request(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GH_TOKEN}`
      },
      signal: AbortSignal.timeout(15_000)
    });
    assert.ok(response.ok);

    const result = (await response.json()) as { workflow_runs?: unknown };
    assert.ok(Array.isArray(result.workflow_runs));

    return !result.workflow_runs.some((run: unknown) => coversCommit(run, commit));
  } catch {
    // Missing permissions, API failures and malformed responses must never skip CI.
    console.warn('Could not confirm PR validation; running branch validation.');

    return true;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const required = await validationRequired(process.env);
  assert.ok(process.env.GITHUB_OUTPUT, 'GitHub Actions output path is required.');
  appendFileSync(process.env.GITHUB_OUTPUT, `required=${required}\n`);
  console.log(required ? 'Running full validation.' : 'This commit is covered by PR validation.');
}
