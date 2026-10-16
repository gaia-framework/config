import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Evaluator, Lexer, Parser, data } from '@actions/expressions';
import { load } from 'js-yaml';
import sinon from 'sinon';

import {
  isReleaseContext,
  assertPublishingEnabled,
  assertReviewerProtection,
  packageName,
  publishArchive,
  publishArguments,
  registry,
  releasePlan
} from '../../../scripts/release.js';

const sha = '1'.repeat(40);
const manifest = { name: packageName, version: '0.1.0' };

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'gaia-framework/config',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_REF: 'gaia-framework/config/.github/workflows/publish.yml@refs/heads/main',
    RELEASE_VERSION: '0.1.0',
    RELEASE_COMMIT: sha,
    ...overrides
  };
}

const workflow = load(readFileSync('.github/workflows/publish.yml', 'utf8')) as any;
const ci = load(readFileSync('.github/workflows/ci.yml', 'utf8')) as any;

function gate(
  expression: string,
  env: NodeJS.ProcessEnv,
  dryRun: boolean,
  requested = true
): boolean {
  const tokens = new Lexer(expression).lex().tokens;
  const parsed = new Parser(tokens, ['github', 'inputs', 'needs'], []).parse();

  const github = new data.Dictionary(
    { key: 'repository', value: new data.StringData(env.GITHUB_REPOSITORY ?? '') },
    { key: 'event_name', value: new data.StringData(env.GITHUB_EVENT_NAME ?? '') },
    { key: 'ref', value: new data.StringData(env.GITHUB_REF ?? '') }
  );

  const context = new data.Dictionary(
    { key: 'github', value: github },
    {
      key: 'needs',
      value: new data.Dictionary({
        key: 'preflight',
        value: new data.Dictionary({
          key: 'outputs',
          value: new data.Dictionary(
            { key: 'requested', value: new data.StringData(String(requested)) },
            { key: 'dry-run', value: new data.StringData(String(dryRun)) }
          )
        })
      })
    },
    {
      key: 'inputs',
      value: new data.Dictionary({ key: 'dry-run', value: new data.BooleanData(dryRun) })
    }
  );

  return new Evaluator(parsed, context).evaluate().coerceString() === 'true';
}

describe('Release workflow', () => {
  it('handles main pushes and manual dry-runs without duplicate validation', () => {
    assert.deepEqual(Object.keys(workflow.on), ['push', 'workflow_dispatch']);
    assert.deepEqual(workflow.on.push.branches, ['main']);
    assert.deepEqual(ci.on.push, { 'branches-ignore': ['main'] });
    assert.ok('pull_request' in ci.on);

    assert.equal(workflow.on.workflow_dispatch.inputs['dry-run'].default, true);
    assert.equal(workflow.on.workflow_dispatch.inputs.commit.required, true);
    assert.equal(workflow.on.workflow_dispatch.inputs.version.required, true);

    assert.equal(workflow.concurrency['cancel-in-progress'], false);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
  });

  it('runs validation if selection fails or has no output, while respecting cancellation', () => {
    const tokens = new Lexer(ci.jobs.validate.if).lex().tokens;
    const cancelledFunction = { name: 'cancelled', minArgs: 0, maxArgs: 0 };
    const expression = new Parser(tokens, ['needs'], [cancelledFunction]).parse();

    const cases = [
      { result: 'success', required: 'true', cancelled: false, expected: true },
      { result: 'success', required: 'false', cancelled: false, expected: false },
      { result: 'success', required: '', cancelled: false, expected: true },
      { result: 'failure', required: '', cancelled: false, expected: true },
      { result: 'failure', required: 'false', cancelled: false, expected: true },
      { result: 'skipped', required: '', cancelled: false, expected: true },
      { result: 'success', required: 'true', cancelled: true, expected: false }
    ];

    for (const scenario of cases) {
      const context = new data.Dictionary({
        key: 'needs',
        value: new data.Dictionary({
          key: 'select',
          value: new data.Dictionary(
            { key: 'result', value: new data.StringData(scenario.result) },
            {
              key: 'outputs',
              value: new data.Dictionary({
                key: 'required',
                value: new data.StringData(scenario.required)
              })
            }
          )
        })
      });
      const functions = new Map([
        [
          'cancelled',
          { ...cancelledFunction, call: () => new data.BooleanData(scenario.cancelled) }
        ]
      ]);

      assert.equal(
        new Evaluator(expression, context, functions).evaluate().coerceString(),
        String(scenario.expected)
      );
    }
  });

  const denied = [
    ['a fork', { GITHUB_REPOSITORY: 'contributor/config' }],
    ['a feature branch', { GITHUB_REF: 'refs/heads/feature' }],
    ['a release tag', { GITHUB_REF: 'refs/tags/v0.1.0' }],
    ['a pull request', { GITHUB_EVENT_NAME: 'pull_request' }],
    ['a privileged pull request', { GITHUB_EVENT_NAME: 'pull_request_target' }],
    ['a scheduled run', { GITHUB_EVENT_NAME: 'schedule' }]
  ] as const;

  for (const [name, overrides] of denied) {
    it(`skips both workflow gates and rejects the script for ${name}`, () => {
      const env = environment(overrides);

      assert.equal(gate(workflow.jobs.preflight.if, env, false), false);
      assert.equal(gate(workflow.jobs.publish.if, env, false), false);

      assert.equal(isReleaseContext(env), false);
      assert.throws(() => releasePlan(env, manifest), /original release workflow/);
    });
  }

  it('allows an original main dry-run but skips the live publishing job', () => {
    const env = environment();

    assert.equal(gate(workflow.jobs.preflight.if, env, true), true);
    assert.equal(gate(workflow.jobs.publish.if, env, true), false);
    assert.equal(releasePlan(env, manifest).dryRun, true);

    assert.equal(gate(workflow.jobs.publish.if, env, false), true);
    assert.equal(gate(workflow.jobs.publish.if, env, false, false), false);
  });

  it('allows automatic main releases and selects prerelease distribution tags', () => {
    const env = environment({
      GITHUB_EVENT_NAME: 'push',
      RELEASE_VERSION: undefined,
      RELEASE_COMMIT: undefined
    });
    assert.equal(gate(workflow.jobs.preflight.if, env, false), true);
    assert.equal(gate(workflow.jobs.publish.if, env, false), true);
    assert.deepEqual(releasePlan(env, manifest), {
      version: manifest.version,
      tag: 'latest',
      dryRun: false
    });
    assert.equal(releasePlan(env, { ...manifest, version: '0.2.0-rc.1' }).tag, 'next');
    assert.equal(releasePlan({ ...env, RELEASE_DRY_RUN: 'true' }, manifest).dryRun, true);
  });

  it('creates GitHub Releases only after registry acceptance with separately scoped permissions', () => {
    assert.deepEqual(workflow.jobs['verify-registry'].needs, ['preflight', 'publish']);
    assert.deepEqual(workflow.jobs['github-release'].needs, [
      'preflight',
      'archive',
      'verify-registry'
    ]);
    assert.deepEqual(workflow.jobs['github-release'].permissions, { contents: 'write' });
    assert.equal(workflow.jobs['verify-registry'].permissions, undefined);
    assert.ok(
      workflow.jobs['github-release'].steps.some((step: any) =>
        step.run?.includes('scripts/github-release.ts')
      )
    );
    assert.equal(workflow.jobs.publish.concurrency['cancel-in-progress'], false);
    assert.equal(workflow.jobs.publish.concurrency.queue, 'max');
    assert.equal(workflow.jobs['github-release'].concurrency.queue, 'max');
    assert.ok(workflow.concurrency.group.includes('github.sha'));
    assert.ok(ci.concurrency.group.includes('github.event_name'));
    assert.ok(ci.concurrency.group.includes('github.event.pull_request.number'));
    assert.ok(ci.concurrency.group.includes("github.ref == 'refs/heads/main' && github.sha"));
    assert.ok(ci.concurrency.group.endsWith('|| github.ref }}'));
  });

  it('requires the reviewed commit, exact package name/version and original workflow file', () => {
    for (const overrides of [
      { RELEASE_COMMIT: 'main' },
      { RELEASE_COMMIT: '2'.repeat(40) },
      { RELEASE_VERSION: '0.2.0' },
      { GITHUB_WORKFLOW_REF: 'gaia-framework/config/.github/workflows/other.yml@refs/heads/main' },
      { GITHUB_ACTIONS: 'false' },
      { RELEASE_DRY_RUN: 'FALSE' },
      { RELEASE_TAG: 'arbitrary-tag' }
    ]) {
      assert.throws(() => releasePlan(environment(overrides), manifest));
    }

    assert.throws(() => releasePlan(environment(), { ...manifest, name: 'config' }));
  });

  it('keeps prereleases off latest and permits explicit next/test tags', () => {
    const prerelease = { ...manifest, version: '0.1.0-test.1' };

    assert.throws(
      () => releasePlan(environment({ RELEASE_VERSION: prerelease.version }), prerelease),
      /next or test/
    );

    for (const tag of ['next', 'test']) {
      assert.equal(
        releasePlan(
          environment({ RELEASE_VERSION: prerelease.version, RELEASE_TAG: tag }),
          prerelease
        ).tag,
        tag
      );
    }
  });

  it('requires full platform validation and archive inspection before protected publishing', () => {
    assert.equal(workflow.jobs.validate.needs, undefined);
    assert.equal(workflow.jobs.validate.uses, './.github/workflows/ci.yml');
    assert.deepEqual(workflow.jobs.validate.permissions, { contents: 'read', actions: 'read' });
    assert.deepEqual(ci.permissions, { contents: 'read' });
    assert.deepEqual(ci.jobs.select.permissions, { contents: 'read', actions: 'read' });
    assert.equal(ci.jobs.validate.needs, 'select');
    assert.equal(
      ci.jobs.validate.if,
      "!cancelled() && (needs.select.result != 'success' || needs.select.outputs.required != 'false')"
    );

    assert.ok('workflow_call' in ci.on);
    assert.deepEqual(ci.jobs.validate.strategy.matrix.os, ['ubuntu-latest', 'windows-latest']);

    assert.deepEqual(workflow.jobs.archive.needs, ['preflight', 'validate']);
    assert.deepEqual(workflow.jobs.publish.needs, ['preflight', 'archive']);
    assert.equal(workflow.jobs.publish.environment, 'npm');

    assert.deepEqual(workflow.jobs.publish.permissions, {
      contents: 'read',
      actions: 'read',
      'id-token': 'write'
    });

    assert.equal(workflow.jobs.archive.permissions, undefined);
    assert.equal(workflow.jobs.validate.secrets, undefined);
    assert.deepEqual(workflow.jobs.preflight.permissions, { contents: 'read', actions: 'read' });

    for (const job of [workflow.jobs.preflight, workflow.jobs.publish]) {
      assert.ok(job.steps.some((step: any) => step.run?.includes('scripts/release.ts protection')));
    }

    const archiveCheck = workflow.jobs.archive.steps.find((step: any) =>
      step.run?.includes('scripts/release.ts publish')
    );

    assert.ok(archiveCheck);
    assert.equal(workflow.jobs.archive.env.RELEASE_DRY_RUN, 'true');
    assert.ok(
      workflow.jobs.publish.steps.some((step: any) => step.uses === 'actions/download-artifact@v8')
    );

    for (const job of [workflow.jobs.preflight, workflow.jobs.archive, workflow.jobs.publish]) {
      assert.equal(job.steps[0].with['persist-credentials'], false);
    }
  });

  it('inspects the archive and executes a dry-run without OIDC credentials', () => {
    const env = environment();
    const plan = releasePlan(env, manifest);
    const run = sinon.stub().returns('[]');

    run.onFirstCall().returns(JSON.stringify([manifest]));

    publishArchive('archive.tgz', plan, env, run);

    assert.equal(run.callCount, 2);
    assert.deepEqual(run.firstCall.args[0].slice(2), ['--dry-run', '--ignore-scripts', '--json']);
    assert.deepEqual(run.secondCall.args[0], publishArguments('archive.tgz', plan));
    assert.ok(run.secondCall.args[0].includes('--dry-run'));
    assert.ok(run.secondCall.args[0].includes(registry));
    assert.ok(run.secondCall.args[0].includes('public'));
    assert.ok(run.secondCall.args[0].includes('--ignore-scripts'));
  });

  it('rejects mismatched or multiple archives before any publishing attempt', () => {
    const env = environment();
    const plan = releasePlan(env, manifest);

    for (const packed of [
      [],
      [manifest, manifest],
      [{ ...manifest, name: '@other/config' }],
      [{ ...manifest, version: '0.2.0' }]
    ]) {
      const run = sinon.stub().returns(JSON.stringify(packed));

      assert.throws(() => publishArchive('archive.tgz', plan, env, run));
      assert.equal(run.callCount, 1);
    }
  });

  it('refuses a live upload without OIDC and propagates publishing failures', () => {
    const env = environment({
      RELEASE_DRY_RUN: 'false',
      NPM_TRUSTED_PUBLISHING_ENABLED: 'true'
    });
    const plan = releasePlan(env, manifest);
    const run = sinon.stub().returns(JSON.stringify([manifest]));

    assert.throws(() => publishArchive('archive.tgz', plan, env, run), /OIDC/);
    assert.equal(run.callCount, 1);

    const oidc = {
      ...env,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-test-token'
    };

    run.resetHistory();
    publishArchive('archive.tgz', plan, oidc, run);

    assert.equal(run.callCount, 2);
    assert.ok(!run.secondCall.args[0].includes('--dry-run'));

    run.resetHistory();
    run.onSecondCall().throws(new Error('Registry rejected publication'));

    assert.throws(() => publishArchive('archive.tgz', plan, oidc, run), /Registry rejected/);
  });

  it('keeps live publishing disabled until repository setup is explicitly enabled', () => {
    const plan = { version: '0.1.0', tag: 'latest', dryRun: false };

    for (const value of [undefined, 'false', 'TRUE']) {
      const env = environment({ NPM_TRUSTED_PUBLISHING_ENABLED: value });
      const run = sinon.stub();

      assert.throws(() => assertPublishingEnabled(env), /Live publishing is disabled/);
      assert.throws(
        () => publishArchive('archive.tgz', plan, env, run),
        /Live publishing is disabled/
      );
      assert.equal(run.callCount, 0);
    }

    assert.doesNotThrow(() => assertPublishingEnabled({ NPM_TRUSTED_PUBLISHING_ENABLED: 'true' }));
  });

  it('requires real reviewers and exactly one main-branch deployment rule', () => {
    const protectedEnvironment = {
      name: 'npm',
      can_admins_bypass: false,
      protection_rules: [
        {
          type: 'required_reviewers',
          reviewers: [{ type: 'User' }]
        }
      ],
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true
      }
    };
    const mainOnly = { branch_policies: [{ name: 'main', type: 'branch' }] };

    assert.doesNotThrow(() => assertReviewerProtection(protectedEnvironment, mainOnly));
    assert.throws(
      () =>
        assertReviewerProtection({ ...protectedEnvironment, can_admins_bypass: true }, mainOnly),
      /administrator bypass/
    );

    for (const protection_rules of [[], [{ type: 'required_reviewers', reviewers: [] }]]) {
      assert.throws(
        () => assertReviewerProtection({ ...protectedEnvironment, protection_rules }, mainOnly),
        /requires environment reviewer protection/
      );
    }

    assert.throws(() =>
      assertReviewerProtection(
        { ...protectedEnvironment, deployment_branch_policy: null },
        mainOnly
      )
    );

    for (const branch_policies of [
      [],
      [{ name: '*', type: 'branch' }],
      [{ name: 'main', type: 'tag' }],
      [...mainOnly.branch_policies, { name: 'feature', type: 'branch' }]
    ]) {
      assert.throws(() => assertReviewerProtection(protectedEnvironment, { branch_policies }));
    }
  });
});
