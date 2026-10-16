import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { finishGitHubRelease } from '../../../scripts/github-release.js';
import { fixture } from '../../support/fixtures.js';

const commit = '1'.repeat(40);
const plan = { version: '0.2.0', commit, latest: true };

function github(archive: string) {
  const calls: string[][] = [];
  const state = {
    tag: null as string | null,
    annotated: false,
    failure: '',
    release: undefined as
      | undefined
      | {
          tag_name: string;
          target_commitish: string;
          draft: boolean;
          prerelease: boolean;
          assets: Array<{ name: string; digest: string | null }>;
        }
  };
  const digest = `sha256:${createHash('sha256').update(readFileSync(archive)).digest('hex')}`;
  const success = (value: unknown) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });

  function run(args: string[]) {
    calls.push(args);
    if (args[0] === 'api') {
      assert.equal(args[args.indexOf('--header') + 1], 'Cache-Control: no-cache');

      if (args[1]?.includes('/git/ref/')) {
        if (!state.tag) {
          return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
        }

        return success({ object: { type: state.annotated ? 'tag' : 'commit', sha: state.tag } });
      }

      if (args[1]?.includes('/git/tags/')) {
        return success({ object: { type: 'commit', sha: state.tag } });
      }

      assert.ok(args.includes('--paginate') && args.includes('--slurp'));

      return success([[...(state.release ? [state.release] : [])]]);
    }

    assert.equal(args[0], 'release');
    assert.equal(args[args.indexOf('--repo') + 1], 'gaia-framework/config');
    switch (args[1]) {
      case 'create':
        state.release = {
          tag_name: args[2]!,
          target_commitish: args[args.indexOf('--target') + 1]!,
          draft: args.includes('--draft'),
          prerelease: args.includes('--prerelease'),
          assets: []
        };
        break;
      case 'upload':
        assert.equal(args[3], archive);
        assert.ok(state.release);
        state.release.assets.push({ name: 'package.tgz', digest });
        break;
      case 'edit':
        assert.ok(state.release);
        state.release.draft = false;
        state.tag = state.release.target_commitish;
        break;
      default:
        throw new Error(`Unexpected GitHub command: ${args.join(' ')}`);
    }

    if (state.failure === args[1]) {
      return { status: 1, stdout: '', stderr: 'synthetic lost response after accepted mutation' };
    }

    return success({});
  }

  return { calls, state, run };
}

describe('GitHub Release creation and recovery', () => {
  const files = fixture();
  const archive = files.write('package.tgz', 'synthetic validated archive');

  after(() => files.dispose());

  it('creates generated notes at the exact commit, uploads, then publishes the draft', async () => {
    const api = github(archive);

    await finishGitHubRelease(plan, archive, api.run);

    const mutations = api.calls.filter((args) => args[0] === 'release');
    assert.deepEqual(
      mutations.map((args) => args[1]),
      ['create', 'upload', 'edit']
    );
    assert.ok(mutations[0]!.includes('--generate-notes'));
    assert.ok(mutations[0]!.includes('--draft'));
    assert.equal(mutations[0]![2], 'v0.2.0');
    assert.equal(mutations[0]![mutations[0]!.indexOf('--target') + 1], commit);
    assert.ok(mutations[2]!.includes('--latest=true'));
    assert.equal(api.state.release?.draft, false);
    assert.equal(api.state.tag, commit);
  });

  for (const phase of ['create', 'upload', 'edit']) {
    it(`resumes an interrupted ${phase} without duplicating existing work`, async () => {
      const api = github(archive);
      api.state.failure = phase;

      await assert.rejects(() => finishGitHubRelease(plan, archive, api.run), /lost response/);

      api.state.failure = '';
      await finishGitHubRelease(plan, archive, api.run);

      for (const command of ['create', 'upload', 'edit']) {
        assert.equal(
          api.calls.filter((args) => args[0] === 'release' && args[1] === command).length,
          1
        );
      }

      assert.equal(api.state.release?.draft, false);
    });
  }

  it('leaves a completed matching release untouched on repeated runs', async () => {
    const api = github(archive);
    await finishGitHubRelease(plan, archive, api.run);
    api.calls.length = 0;

    await finishGitHubRelease(plan, archive, api.run);

    assert.ok(api.calls.every((args) => args[0] === 'api'));
  });

  it('supports matching annotated tags', async () => {
    const api = github(archive);
    api.state.tag = commit;
    api.state.annotated = true;

    await finishGitHubRelease(plan, archive, api.run);

    assert.ok(api.calls.some((args) => args[1]?.includes('/git/tags/')));
  });

  it('rejects a conflicting tag before creating or changing a release', async () => {
    const api = github(archive);
    api.state.tag = '2'.repeat(40);

    await assert.rejects(() => finishGitHubRelease(plan, archive, api.run), /another commit/);

    assert.ok(api.calls.every((args) => args[0] === 'api'));
  });

  it('does not treat a permissions error as a missing tag', async () => {
    const calls: string[][] = [];
    await assert.rejects(
      () =>
        finishGitHubRelease(plan, archive, (args) => {
          calls.push(args);

          return { status: 1, stdout: '', stderr: 'gh: Forbidden (HTTP 403)' };
        }),
      /Cannot inspect release tag/
    );
    assert.equal(calls.length, 1);
  });

  it('refuses a draft targeting a different commit', async () => {
    const api = github(archive);
    api.state.failure = 'create';
    await assert.rejects(() => finishGitHubRelease(plan, archive, api.run));
    api.state.release!.target_commitish = '2'.repeat(40);
    api.state.failure = '';
    api.calls.length = 0;

    await assert.rejects(() => finishGitHubRelease(plan, archive, api.run), /another commit/);

    assert.ok(api.calls.every((args) => args[0] === 'api'));
  });

  it('rechecks a draft target after uploading before publishing the release', async () => {
    const api = github(archive);
    await assert.rejects(
      () =>
        finishGitHubRelease(plan, archive, (args) => {
          const result = api.run(args);
          if (args[0] === 'release' && args[1] === 'upload') {
            api.state.release!.target_commitish = '2'.repeat(40);
          }

          return result;
        }),
      /another commit/
    );

    assert.equal(api.state.release?.draft, true);
    assert.ok(!api.calls.some((args) => args[0] === 'release' && args[1] === 'edit'));
  });

  for (const digest of [null, 'sha256-different']) {
    it(`refuses an existing asset with digest ${digest}`, async () => {
      const api = github(archive);
      api.state.failure = 'upload';
      await assert.rejects(() => finishGitHubRelease(plan, archive, api.run));
      api.state.release!.assets[0]!.digest = digest;
      api.state.failure = '';
      api.calls.length = 0;

      await assert.rejects(() => finishGitHubRelease(plan, archive, api.run), /differs|digest/);

      assert.ok(api.calls.every((args) => args[0] === 'api'));
    });
  }

  it('keeps prereleases off latest and does not mark old stable recovery as latest', async () => {
    const prerelease = github(archive);
    await finishGitHubRelease(
      { ...plan, version: '0.3.0-rc.1', latest: false },
      archive,
      prerelease.run
    );
    assert.equal(prerelease.state.release?.prerelease, true);
    assert.ok(prerelease.calls.some((args) => args.includes('--latest=false')));
    await assert.rejects(
      () => finishGitHubRelease({ ...plan, version: '0.3.0-rc.1' }, archive, prerelease.run),
      /Prereleases/
    );

    const oldStable = github(archive);
    await finishGitHubRelease({ ...plan, latest: false }, archive, oldStable.run);
    assert.ok(oldStable.calls.some((args) => args.includes('--latest=false')));
  });

  it('rejects malformed version and commit inputs before running commands', async () => {
    const api = github(archive);
    await assert.rejects(() =>
      finishGitHubRelease({ ...plan, version: '0.2.0\ninjected' }, archive, api.run)
    );
    await assert.rejects(() => finishGitHubRelease({ ...plan, commit: 'main' }, archive, api.run));
    assert.equal(api.calls.length, 0);
  });

  for (const missingReads of [3, 9]) {
    it(`waits through ${missingReads} missing draft reads without creating another release`, async () => {
      const api = github(archive);
      const delays: number[] = [];
      let hiddenReads = 0;

      await finishGitHubRelease(
        plan,
        archive,
        (args) => {
          const result = api.run(args);
          if (args.includes('--paginate') && api.state.release && hiddenReads < missingReads) {
            hiddenReads++;

            return { ...result, stdout: '[[]]' };
          }

          return result;
        },
        async (milliseconds) => delays.push(milliseconds)
      );

      assert.deepEqual(delays, Array<number>(missingReads).fill(2_000));
      assert.deepEqual(
        api.calls.filter((args) => args[0] === 'release').map((args) => args[1]),
        ['create', 'upload', 'edit']
      );
    });
  }

  for (const visibility of ['missing release', 'missing asset', 'pending digest']) {
    it(`waits for an uploaded archive with ${visibility} without uploading it twice`, async () => {
      const api = github(archive);
      const delays: number[] = [];
      let hiddenReads = 0;

      await finishGitHubRelease(
        plan,
        archive,
        (args) => {
          const result = api.run(args);
          if (args.includes('--paginate') && api.state.release?.assets.length && hiddenReads < 2) {
            hiddenReads++;
            const candidate = structuredClone(api.state.release);
            if (visibility === 'missing release') {
              return { ...result, stdout: '[[]]' };
            }

            if (visibility === 'missing asset') {
              candidate.assets = [];
            } else {
              candidate.assets[0]!.digest = null;
            }

            return { ...result, stdout: JSON.stringify([[candidate]]) };
          }

          return result;
        },
        async (milliseconds) => delays.push(milliseconds)
      );

      assert.deepEqual(delays, [2_000, 2_000]);
      assert.equal(
        api.calls.filter((args) => args[0] === 'release' && args[1] === 'upload').length,
        1
      );
      assert.equal(api.state.release?.draft, false);
    });
  }

  it('waits for the published tag without publishing the draft again', async () => {
    const api = github(archive);
    const delays: number[] = [];
    let hiddenReads = 0;

    await finishGitHubRelease(
      plan,
      archive,
      (args) => {
        const result = api.run(args);
        if (
          args[1]?.includes('/git/ref/') &&
          api.state.release?.draft === false &&
          hiddenReads < 3
        ) {
          hiddenReads++;

          return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
        }

        return result;
      },
      async (milliseconds) => delays.push(milliseconds)
    );

    assert.deepEqual(delays, [2_000, 2_000, 2_000]);
    assert.equal(api.calls.filter((args) => args[0] === 'release' && args[1] === 'edit').length, 1);
    assert.equal(api.state.tag, commit);
  });

  it('waits for a completed release tag during recovery without changing the release', async () => {
    const api = github(archive);
    await finishGitHubRelease(plan, archive, api.run);
    api.calls.length = 0;
    const delays: number[] = [];
    let checkingPublished = false;
    let hiddenReads = 0;

    await finishGitHubRelease(
      plan,
      archive,
      (args) => {
        const result = api.run(args);
        if (args.includes('--paginate')) {
          checkingPublished = true;
        }

        if (checkingPublished && args[1]?.includes('/git/ref/') && hiddenReads < 2) {
          hiddenReads++;

          return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
        }

        return result;
      },
      async (milliseconds) => delays.push(milliseconds)
    );

    assert.deepEqual(delays, [2_000, 2_000]);
    assert.ok(api.calls.every((args) => args[0] === 'api'));
  });

  for (const phase of ['create', 'upload', 'edit']) {
    it(`bounds ${phase} visibility reads and preserves recovery after timeout`, async () => {
      const api = github(archive);
      const delays: number[] = [];
      let hiddenReads = 0;

      await assert.rejects(
        () =>
          finishGitHubRelease(
            plan,
            archive,
            (args) => {
              const result = api.run(args);
              if (
                phase === 'edit' &&
                args[1]?.includes('/git/ref/') &&
                api.state.release?.draft === false
              ) {
                hiddenReads++;

                return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
              }

              if (
                args.includes('--paginate') &&
                api.state.release &&
                (phase === 'create' || (phase === 'upload' && api.state.release.assets.length > 0))
              ) {
                hiddenReads++;

                return { ...result, stdout: '[[]]' };
              }

              return result;
            },
            async (milliseconds) => delays.push(milliseconds)
          ),
        /Timed out waiting for .* after 10 reads; rerun this job to resume/
      );

      assert.equal(hiddenReads, 10);
      assert.deepEqual(delays, Array<number>(9).fill(2_000));
      assert.equal(
        api.calls.filter((args) => args[0] === 'release' && args[1] === phase).length,
        1
      );

      await finishGitHubRelease(plan, archive, api.run);

      for (const mutation of ['create', 'upload', 'edit']) {
        assert.equal(
          api.calls.filter((args) => args[0] === 'release' && args[1] === mutation).length,
          1
        );
      }

      assert.equal(api.state.release?.draft, false);
    });
  }

  for (const failure of ['wrong target', 'wrong digest', 'wrong prerelease', 'published draft']) {
    it(`stops immediately for ${failure} in an upload response`, async () => {
      const api = github(archive);
      let pauses = 0;

      await assert.rejects(
        () =>
          finishGitHubRelease(
            plan,
            archive,
            (args) => {
              const result = api.run(args);
              if (args.includes('--paginate') && api.state.release?.assets.length) {
                const candidate = structuredClone(api.state.release);
                switch (failure) {
                  case 'wrong target':
                    candidate.target_commitish = '2'.repeat(40);
                    break;
                  case 'wrong digest':
                    candidate.assets[0]!.digest = 'sha256:different';
                    break;
                  case 'wrong prerelease':
                    candidate.prerelease = true;
                    break;
                  case 'published draft':
                    candidate.draft = false;
                    break;
                }

                return { ...result, stdout: JSON.stringify([[candidate]]) };
              }

              return result;
            },
            async () => pauses++
          ),
        /another commit|differs|prerelease|remain a draft/
      );

      assert.equal(pauses, 0);
      assert.ok(!api.calls.some((args) => args[0] === 'release' && args[1] === 'edit'));
    });
  }

  for (const status of [403, 500]) {
    it(`does not mask HTTP ${status} while waiting for draft visibility`, async () => {
      const api = github(archive);
      let pauses = 0;

      await assert.rejects(
        () =>
          finishGitHubRelease(
            plan,
            archive,
            (args) => {
              const result = api.run(args);
              if (args.includes('--paginate') && api.state.release) {
                return { status: 1, stdout: '', stderr: `gh: API failure (HTTP ${status})` };
              }

              return result;
            },
            async () => pauses++
          ),
        new RegExp(`GitHub CLI failed:.*HTTP ${status}`)
      );

      assert.equal(pauses, 0);
      assert.deepEqual(
        api.calls.filter((args) => args[0] === 'release').map((args) => args[1]),
        ['create']
      );
    });
  }

  it('rejects a conflicting tag immediately after publication', async () => {
    const api = github(archive);
    let pauses = 0;

    await assert.rejects(
      () =>
        finishGitHubRelease(
          plan,
          archive,
          (args) => {
            const result = api.run(args);
            if (args[0] === 'release' && args[1] === 'edit') {
              api.state.tag = '2'.repeat(40);
            }

            return result;
          },
          async () => pauses++
        ),
      /another commit/
    );

    assert.equal(pauses, 0);
  });
});
