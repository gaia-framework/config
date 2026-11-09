import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const repository = 'gaia-framework/config';

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

type RunGitHub = (args: string[]) => CommandResult;
type Pause = (milliseconds: number) => Promise<unknown>;

const visibilityAttempts = 10;
const visibilityDelayMs = 2_000;
const freshReadHeaders = ['--header', 'Cache-Control: no-cache'];

interface Release {
  tag_name: string;
  target_commitish: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; digest: string | null }>;
}

export interface GitHubReleasePlan {
  version: string;
  commit: string;
  latest: boolean;
}

function command(run: RunGitHub, args: string[]): string {
  const result = run(args);
  assert.equal(result.status, 0, `GitHub CLI failed: ${result.stderr}`);

  return result.stdout;
}

function tagCommit(tag: string, run: RunGitHub): string | null {
  const result = run(['api', `repos/${repository}/git/ref/tags/${tag}`, ...freshReadHeaders]);
  if (result.status !== 0 && /\(HTTP 404\)/.test(result.stderr)) {
    return null;
  }

  assert.equal(result.status, 0, `Cannot inspect release tag: ${result.stderr}`);
  let object = JSON.parse(result.stdout).object as { type: string; sha: string };
  for (let depth = 0; depth < 10; depth++) {
    assert.match(object.sha, /^[a-f0-9]{40}$/, 'GitHub returned an invalid tag object.');
    if (object.type === 'commit') {
      return object.sha;
    }

    assert.equal(object.type, 'tag', 'Release tags must resolve to commits.');
    object = JSON.parse(
      command(run, ['api', `repos/${repository}/git/tags/${object.sha}`, ...freshReadHeaders])
    ).object;
  }

  throw new Error('Release tag nesting exceeds the supported limit.');
}

function checkTag(tag: string, commit: string, run: RunGitHub): string | null {
  const existing = tagCommit(tag, run);
  if (existing !== null) {
    assert.equal(
      existing,
      commit,
      'Existing release tag points to another commit; refusing to move it.'
    );
  }

  return existing;
}

function findRelease(tag: string, run: RunGitHub): Release | undefined {
  // Listing authenticated releases includes drafts, including interrupted creations.
  const pages = JSON.parse(
    command(run, [
      'api',
      '--paginate',
      '--slurp',
      `repos/${repository}/releases?per_page=100`,
      ...freshReadHeaders
    ])
  ) as Release[][];
  assert.ok(
    Array.isArray(pages) && pages.every(Array.isArray),
    'Invalid GitHub releases response.'
  );
  const matches = pages.flat().filter((release) => release.tag_name === tag);
  assert.ok(matches.length <= 1, 'Multiple releases use this tag; resolve the conflict manually.');

  return matches[0];
}

async function waitForVisibility<T>(
  read: () => T | undefined,
  description: string,
  pause: Pause
): Promise<T> {
  for (let attempt = 1; attempt <= visibilityAttempts; attempt++) {
    const value = read();
    if (value !== undefined) {
      return value;
    }

    if (attempt < visibilityAttempts) {
      console.log(`Waiting for ${description} (${attempt}/${visibilityAttempts}).`);
      await pause(visibilityDelayMs);
    }
  }

  throw new Error(
    `Timed out waiting for ${description} after ${visibilityAttempts} reads; rerun this job to resume.`
  );
}

function matchingAsset(release: Release, archive: string, pendingUpload = false): boolean {
  const matches = release.assets.filter((asset) => asset.name === path.basename(archive));
  assert.ok(matches.length <= 1, 'Duplicate release assets must be resolved manually.');
  if (matches.length === 0) {
    return false;
  }

  if (pendingUpload && matches[0]!.digest === null) {
    return false;
  }

  const digest = `sha256:${createHash('sha256').update(readFileSync(archive)).digest('hex')}`;
  assert.equal(
    matches[0]!.digest,
    digest,
    'Existing release asset differs or has no verifiable digest.'
  );

  return true;
}

function assertDraftRelease(release: Release, plan: GitHubReleasePlan): void {
  assert.equal(release.target_commitish, plan.commit, 'Draft release targets another commit.');
  assert.equal(release.draft, true, 'Release must remain a draft until publication.');
  assert.equal(
    release.prerelease,
    plan.version.includes('-'),
    'Draft release has different prerelease metadata.'
  );
}

export async function finishGitHubRelease(
  plan: GitHubReleasePlan,
  archive: string,
  run: RunGitHub,
  pause: Pause = setTimeout
): Promise<void> {
  assert.equal(
    plan.version.trim(),
    plan.version,
    'Release versions cannot contain surrounding whitespace.'
  );
  assert.match(plan.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Invalid release version.');
  assert.match(plan.commit, /^[a-f0-9]{40}$/, 'Expected an exact release commit.');
  const tag = `v${plan.version}`;
  const prerelease = plan.version.includes('-');
  assert.ok(!prerelease || !plan.latest, 'Prereleases cannot become the latest GitHub Release.');
  checkTag(tag, plan.commit, run);
  let release = findRelease(tag, run);
  if (!release) {
    const args = [
      'release',
      'create',
      tag,
      '--repo',
      repository,
      '--target',
      plan.commit,
      '--title',
      tag,
      '--generate-notes',
      '--draft'
    ];
    if (prerelease) {
      args.push('--prerelease');
    }

    command(run, args);
    release = await waitForVisibility(() => findRelease(tag, run), `created draft ${tag}`, pause);
  }

  assert.equal(
    release.prerelease,
    prerelease,
    'Existing release has different prerelease metadata.'
  );
  if (!release.draft) {
    assert.ok(
      matchingAsset(release, archive),
      'Published release is missing its validated archive.'
    );
    await waitForVisibility(
      () => checkTag(tag, plan.commit, run) ?? undefined,
      `published tag ${tag}`,
      pause
    );
    console.log(`GitHub Release ${tag} is already complete.`);

    return;
  }

  assertDraftRelease(release, plan);
  if (!matchingAsset(release, archive)) {
    command(run, ['release', 'upload', tag, archive, '--repo', repository]);
    release = await waitForVisibility(
      () => {
        const candidate = findRelease(tag, run);
        if (!candidate) {
          return undefined;
        }

        assertDraftRelease(candidate, plan);

        return matchingAsset(candidate, archive, true) ? candidate : undefined;
      },
      `uploaded archive for ${tag}`,
      pause
    );
  }

  assertDraftRelease(release, plan);
  checkTag(tag, plan.commit, run);
  command(run, [
    'release',
    'edit',
    tag,
    '--repo',
    repository,
    '--draft=false',
    `--latest=${plan.latest}`
  ]);
  await waitForVisibility(
    () => checkTag(tag, plan.commit, run) ?? undefined,
    `published tag ${tag}`,
    pause
  );
  console.log(`Created GitHub Release ${tag} from ${plan.commit}.`);
}

async function main(): Promise<void> {
  assert.equal(
    process.env.GITHUB_REPOSITORY,
    repository,
    'Only the original repository may release.'
  );
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(
    process.env.GITHUB_WORKFLOW_REF,
    `${repository}/.github/workflows/publish.yml@refs/heads/main`
  );
  assert.ok(['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME ?? ''));
  assert.equal(process.env.RELEASE_DRY_RUN, 'false', 'Dry-runs cannot create GitHub Releases.');
  assert.equal(process.env.RELEASE_COMMIT, process.env.GITHUB_SHA);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, '@gaia-framework/config');
  assert.equal(manifest.version, process.env.RELEASE_VERSION);
  const archive = process.argv[2];
  assert.ok(archive, 'Supply the validated release archive.');
  const response = await fetch('https://registry.npmjs.org/@gaia-framework%2Fconfig/latest', {
    signal: AbortSignal.timeout(15_000)
  });
  assert.ok(response.ok, `Cannot determine npm latest: HTTP ${response.status}.`);
  const latest = (await response.json()) as { name: string; version: string };
  assert.equal(latest.name, manifest.name);
  assert.equal(typeof latest.version, 'string');

  await finishGitHubRelease(
    {
      version: manifest.version,
      commit: process.env.RELEASE_COMMIT!,
      latest: process.env.RELEASE_TAG === 'latest' && latest.version === manifest.version
    },
    archive,
    (args) => spawnSync('gh', args, { encoding: 'utf8', timeout: 120_000 })
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
