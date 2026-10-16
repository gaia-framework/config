import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const packageName = '@gaia-framework/config';
export const registry = 'https://registry.npmjs.org';

export interface ReleasePlan {
  version: string;
  tag: string;
  dryRun: boolean;
}

export function isReleaseContext(env: NodeJS.ProcessEnv): boolean {
  return (
    env.GITHUB_ACTIONS === 'true' &&
    env.GITHUB_REPOSITORY === 'gaia-framework/config' &&
    ['workflow_dispatch', 'push'].includes(env.GITHUB_EVENT_NAME ?? '') &&
    env.GITHUB_REF === 'refs/heads/main' &&
    env.GITHUB_WORKFLOW_REF ===
      'gaia-framework/config/.github/workflows/publish.yml@refs/heads/main'
  );
}

export function releasePlan(
  env: NodeJS.ProcessEnv,
  manifest: { name: string; version: string }
): ReleasePlan {
  assert.ok(isReleaseContext(env), 'Releases require the original release workflow on main.');
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/, 'Expected the exact workflow commit.');
  assert.equal(manifest.name, packageName, 'Unexpected package identity.');
  parseVersion(manifest.version);
  const automatic = env.GITHUB_EVENT_NAME === 'push';
  if (!automatic) {
    assert.equal(
      env.RELEASE_COMMIT,
      env.GITHUB_SHA,
      'The selected commit must match the reviewed SHA.'
    );
    assert.equal(
      manifest.version,
      env.RELEASE_VERSION,
      'The requested version must match package.json.'
    );
  }

  assert.ok(['true', 'false'].includes(env.RELEASE_DRY_RUN ?? 'true'), 'Invalid dry-run value.');
  const tag = automatic
    ? manifest.version.includes('-')
      ? 'next'
      : 'latest'
    : (env.RELEASE_TAG ?? 'latest');
  assert.ok(['latest', 'next', 'test'].includes(tag), 'Unexpected distribution tag.');
  assert.ok(
    !manifest.version.includes('-') || tag !== 'latest',
    'Use next or test for prereleases.'
  );

  return {
    version: manifest.version,
    tag,
    dryRun: automatic ? env.RELEASE_DRY_RUN === 'true' : env.RELEASE_DRY_RUN !== 'false'
  };
}

function parseVersion(version: string): { core: bigint[]; prerelease: string[] } {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version
    );
  assert.ok(
    match && match[0] === version,
    'Use a canonical semantic version without build metadata.'
  );
  assert.ok(
    match.slice(1, 4).every((part) => BigInt(part!) <= BigInt(Number.MAX_SAFE_INTEGER)),
    'Version components must fit within safe integers.'
  );
  const prerelease = match[4]?.split('.') ?? [];
  assert.ok(
    prerelease.every((part) => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')),
    'Numeric prerelease identifiers cannot have leading zeroes.'
  );

  return { core: match.slice(1, 4).map((part) => BigInt(part!)), prerelease };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) {
      return a.core[index]! > b.core[index]! ? 1 : -1;
    }
  }

  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return Number(b.prerelease.length > 0) - Number(a.prerelease.length > 0);
  }

  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === y) {
      continue;
    }

    if (x === undefined || y === undefined) {
      return x === undefined ? -1 : 1;
    }

    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      return BigInt(x) > BigInt(y) ? 1 : -1;
    }

    if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    }

    return x > y ? 1 : -1;
  }

  return 0;
}

export function versionChanged(
  previous: { name: string; version: string },
  current: { name: string; version: string }
): boolean {
  assert.equal(previous.name, packageName, 'Unexpected previous package identity.');
  assert.equal(current.name, packageName, 'Unexpected package identity.');
  const comparison = compareVersions(current.version, previous.version);
  assert.ok(comparison >= 0, 'Release versions must increase; version rollback is not supported.');

  return comparison > 0;
}

export function npmCliPath(): string {
  const directory = path.dirname(process.execPath);
  const filename = [
    path.join(directory, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js')
  ].find((candidate) => existsSync(candidate));
  assert.ok(filename, 'Node 24 must include npm for trusted publishing.');

  return filename;
}

export function publishArguments(archive: string, plan: ReleasePlan): string[] {
  const args = [
    'publish',
    path.resolve(archive),
    '--registry',
    registry,
    '--access',
    'public',
    '--tag',
    plan.tag,
    '--ignore-scripts',
    '--json'
  ];
  if (plan.dryRun) {
    args.push('--dry-run');
  }

  return args;
}

type RunNpm = (args: string[]) => string;

interface PublishedVersion {
  name: string;
  version: string;
  dist: { integrity: string };
}

export async function registryVersion(version: string): Promise<PublishedVersion | null> {
  const response = await fetch(
    `${registry}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
    {
      signal: AbortSignal.timeout(15_000)
    }
  );
  if (response.status === 404) {
    await response.body?.cancel();

    return null;
  }

  assert.ok(response.ok, `Registry lookup failed: HTTP ${response.status}.`);

  const published = (await response.json()) as Partial<PublishedVersion> | null;
  assert.ok(
    published &&
      published.name === packageName &&
      typeof published.version === 'string' &&
      typeof published.dist?.integrity === 'string',
    'Registry returned invalid release metadata.'
  );

  return published as PublishedVersion;
}

export function assertArchiveMatches(
  archive: string,
  version: string,
  published: PublishedVersion | null
): void {
  assert.ok(
    published,
    'The release is not yet visible on npm; rerun verification after processing.'
  );
  assert.equal(published.name, packageName, 'Unexpected registry package.');
  assert.equal(published.version, version, 'Unexpected registry version.');
  const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
  assert.equal(
    published.dist.integrity,
    integrity,
    'Published archive differs from this release; never overwrite a version.'
  );
}

export async function publishIfNeeded(
  archive: string,
  plan: ReleasePlan,
  env: NodeJS.ProcessEnv,
  run: RunNpm,
  lookup: (version: string) => Promise<PublishedVersion | null> = registryVersion
): Promise<void> {
  assert.ok(isReleaseContext(env), 'Only the original main workflow can inspect a release.');
  const published = await lookup(plan.version);
  if (published) {
    assertArchiveMatches(archive, plan.version, published);
    console.log(
      `Verified existing npm archive for ${packageName}@${plan.version}; upload skipped.`
    );

    return;
  }

  const tagged = await lookup(plan.tag);
  if (tagged) {
    assert.ok(
      compareVersions(plan.version, tagged.version) > 0,
      `Refusing to move npm ${plan.tag} backwards or repeat a processing release.`
    );
  }

  publishArchive(archive, plan, env, run);
  console.log(`${plan.dryRun ? 'Dry-run inspected' : 'Submitted'} ${packageName}@${plan.version}.`);
}

export function assertPublishingEnabled(env: NodeJS.ProcessEnv): void {
  assert.equal(
    env.NPM_TRUSTED_PUBLISHING_ENABLED,
    'true',
    'Live publishing is disabled until npm trust and release approval are configured.'
  );
}

export function assertReviewerProtection(
  environment: {
    name: string;
    can_admins_bypass: boolean;
    protection_rules: Array<{ type: string; reviewers?: unknown[] }>;
    deployment_branch_policy: {
      protected_branches: boolean;
      custom_branch_policies: boolean;
    } | null;
  },
  branches: { branch_policies: Array<{ name: string; type: string }> }
): void {
  assert.equal(environment.name, 'npm', 'The npm release environment is required.');
  assert.equal(
    environment.can_admins_bypass,
    false,
    'Release approvals must not allow administrator bypass.'
  );
  assert.ok(
    environment.protection_rules.some(
      (rule) => rule.type === 'required_reviewers' && (rule.reviewers?.length ?? 0) > 0
    ),
    'Live publishing requires environment reviewer protection; it cannot be bypassed by enablement.'
  );
  assert.deepEqual(
    environment.deployment_branch_policy,
    { protected_branches: false, custom_branch_policies: true },
    'Release environment must restrict deployment to the selected main branch.'
  );
  assert.deepEqual(
    branches.branch_policies.map(({ name, type }) => ({ name, type })),
    [{ name: 'main', type: 'branch' }],
    'Only the main branch may deploy to the npm environment.'
  );
}

export function publishArchive(
  archive: string,
  plan: ReleasePlan,
  env: NodeJS.ProcessEnv,
  run: RunNpm
): void {
  assert.ok(isReleaseContext(env), 'Only the original main workflow can publish an archive.');
  if (!plan.dryRun) {
    assertPublishingEnabled(env);
  }

  const packed = JSON.parse(
    run(['pack', path.resolve(archive), '--dry-run', '--ignore-scripts', '--json'])
  ) as Array<{ name: string; version: string }>;
  assert.equal(packed.length, 1, 'Expected exactly one release archive.');
  assert.equal(packed[0]?.name, packageName, 'The archive must contain the expected package.');
  assert.equal(packed[0]?.version, plan.version, 'The archive version must match the release.');
  if (!plan.dryRun) {
    assert.ok(
      env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      'A live release requires the protected GitHub OIDC publishing job.'
    );
  }

  run(publishArguments(archive, plan));
}

function selectRelease(plan: ReleasePlan, manifest: { name: string; version: string }): void {
  let requested = true;
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    const before = process.env.RELEASE_BEFORE ?? '';
    assert.match(before, /^[a-f0-9]{40}$/, 'Expected the previous push commit.');
    if (before === '0'.repeat(40)) {
      requested = false;
    } else {
      const previous = JSON.parse(
        execFileSync('git', ['show', `${before}:package.json`], { encoding: 'utf8' })
      );
      requested = versionChanged(previous, manifest);
    }
  }

  assert.ok(process.env.GITHUB_OUTPUT, 'Release selection requires GitHub job outputs.');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `requested=${requested}\nversion=${plan.version}\ncommit=${process.env.GITHUB_SHA}\ntag=${plan.tag}\ndry-run=${plan.dryRun}\n`
  );
  console.log(
    requested
      ? `Selected ${packageName}@${plan.version}.`
      : 'No version increase selected; validation only.'
  );
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const plan = releasePlan(process.env, manifest);
  if (process.argv[2] === 'select') {
    selectRelease(plan, manifest);

    return;
  }

  if (process.argv[2] === 'protection') {
    assertPublishingEnabled(process.env);
    assert.ok(process.argv[3] && process.argv[4], 'Supply environment and branch-policy files.');
    assertReviewerProtection(
      JSON.parse(readFileSync(process.argv[3], 'utf8')),
      JSON.parse(readFileSync(process.argv[4], 'utf8'))
    );
    console.log('Required reviewers and main-only environment protection verified.');

    return;
  }

  if (process.argv[2] === 'verify') {
    if (!plan.dryRun) {
      assertPublishingEnabled(process.env);
    }

    console.log(`Verified ${packageName}@${plan.version} at ${process.env.GITHUB_SHA}.`);

    return;
  }

  const archive = process.argv[3];
  assert.ok(archive, 'Supply the Yarn archive path.');
  if (process.argv[2] === 'registry') {
    assertArchiveMatches(archive, plan.version, await registryVersion(plan.version));
    console.log('Public npm integrity matches the exact release archive.');

    return;
  }

  assert.equal(
    process.argv[2],
    'publish',
    'Expected select, verify, protection, registry or publish.'
  );
  const run: RunNpm = (args) =>
    execFileSync(process.execPath, [npmCliPath(), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit']
    });
  await publishIfNeeded(archive, plan, process.env, run);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
