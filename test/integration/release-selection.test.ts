import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fixture } from '../support/fixtures.js';

describe('Release selection from a merged Git commit', () => {
  for (const [previousVersion, currentVersion, requested, initialPush] of [
    ['0.1.1', '0.1.1', false, false],
    ['0.1.1', '0.1.2', true, false],
    ['0.1.1', '0.2.0-rc.1', true, false],
    ['0.1.3', '0.1.3', false, true]
  ] as const) {
    it(`selects ${currentVersion} after ${initialPush ? 'initial push' : previousVersion}: ${requested}`, () => {
      const files = fixture();
      try {
        function git(args: string[]): string {
          return execFileSync(
            'git',
            [
              '-c',
              'user.name=Fixture',
              '-c',
              'user.email=fixture@example.invalid',
              '-c',
              'commit.gpgsign=false',
              '-c',
              'core.autocrlf=false',
              '-c',
              `core.hooksPath=${files.directory}/no-hooks`,
              ...args
            ],
            { cwd: files.directory, encoding: 'utf8' }
          ).trim();
        }

        git(['init', '--quiet']);
        const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
        const script = files.write(
          'scripts/release.ts',
          readFileSync(new URL(`../../scripts/release${extension}`, import.meta.url), 'utf8')
        );
        files.write(
          'package.json',
          JSON.stringify({
            name: '@gaia-framework/config',
            version: previousVersion,
            type: 'module'
          })
        );
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'Previous version']);
        const before = git(['rev-parse', 'HEAD']);
        files.write(
          'package.json',
          JSON.stringify({
            name: '@gaia-framework/config',
            version: currentVersion,
            type: 'module'
          })
        );
        git(['add', '.']);

        if (!initialPush) {
          git(['commit', '--quiet', '--allow-empty', '-m', 'Merged change']);
        }

        const commit = git(['rev-parse', 'HEAD']);
        const output = files.write('outputs', '');
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          GITHUB_ACTIONS: 'true',
          GITHUB_REPOSITORY: 'gaia-framework/config',
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_SHA: commit,
          GITHUB_WORKFLOW_REF:
            'gaia-framework/config/.github/workflows/publish.yml@refs/heads/main',
          GITHUB_OUTPUT: output,
          RELEASE_BEFORE: initialPush ? '0'.repeat(40) : before,
          RELEASE_DRY_RUN: 'false',
          NPM_TRUSTED_PUBLISHING_ENABLED: 'false'
        };
        const result = spawnSync(process.execPath, [script, 'select'], {
          cwd: files.directory,
          env,
          encoding: 'utf8'
        });

        assert.equal(result.status, 0, result.stderr);
        const outputs = Object.fromEntries(
          readFileSync(output, 'utf8')
            .trim()
            .split('\n')
            .map((line) => line.split('='))
        );
        assert.deepEqual(outputs, {
          requested: String(requested),
          version: currentVersion,
          commit,
          tag: currentVersion.includes('-') ? 'next' : 'latest',
          'dry-run': 'false'
        });

        for (const invalidBefore of ['', 'main', 'f'.repeat(40)]) {
          const rejected = spawnSync(process.execPath, [script, 'select'], {
            cwd: files.directory,
            env: { ...env, RELEASE_BEFORE: invalidBefore },
            encoding: 'utf8'
          });
          assert.notEqual(rejected.status, 0);
        }
      } finally {
        files.dispose();
      }
    });
  }
});
