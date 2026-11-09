# Releasing

`package.json` is the release version source. For example, version `0.3.0`
publishes `@gaia-framework/config@0.3.0` and creates Git tag/GitHub Release
`v0.3.0` at the exact validated commit. Branch names do not determine versions.

Registry publication and repository visibility are separate. A public npm
package does not make its GitHub repository or GitHub Releases public. The npm
archive includes source, compiled exports, declarations, documentation, examples
and the MIT license. Keep credentials and local reports out of Git and archives.

The package uses public npm access. Both package metadata and the upload command
enforce it. Registry metadata, integrity checks and consumer installation use
anonymous reads; no `NPM_TOKEN` secret is needed. Upload authorization still uses
OIDC. Provenance stays disabled while the source GitHub repository is private.
Changing npm access does not change GitHub repository visibility.

## Normal release flow

1. Update the package version deliberately with Yarn and update the changelog in
   a pull request. Use an unpublished semantic version greater than the previous
   version. Build metadata (`+...`), leading zeroes and version rollbacks are
   rejected. Normal configuration changes do not automatically bump versions.
2. Run `yarn validate`, review the changes and wait for Linux/Windows PR checks.
3. Merge into `main`. `publish.yml` compares the manifest at the push's previous
   commit with the manifest at the exact merged commit. An unchanged version
   runs validation only; a higher version continues into the release pipeline.
4. The workflow runs the complete Linux/Windows checks once, builds and packs
   with Yarn, and inspects the exact archive with npm dry-run. Inspect the
   `npm-release-archive` artifact before approval.
5. Approve **Review deployments → npm → Approve and deploy**. Required reviewers
   and main-only environment protection are checked before release preparation
   and again immediately before upload. This approval is required even though
   version detection is automatic.
6. The protected job publishes through npm Trusted Publishing (OIDC). A separate
   read-only job waits for registry availability and verifies an independent
   anonymous installation, runtime/types/development imports, DI and all examples.
   Public npm integrity must match the exact Actions archive.
7. Only after registry acceptance, GitHub CLI creates a draft release with
   generated notes, uploads the same archive and checks its digest, then
   publishes the GitHub Release. Its tag must point to the validated commit.

Stable versions automatically use npm `latest`; prereleases such as
`0.3.0-rc.1` use `next` and a GitHub prerelease. A GitHub Release is marked latest
only when it is a stable `latest` release that still matches npm's current
`latest` version at the time of the check.

Every feature-branch push runs Linux/Windows validation, even before a PR exists.
PRs also validate their merge result. A feature push skips duplicate validation
only when GitHub confirms that PR CI for the same commit is queued, running or
completed with success/failure. Canceled, skipped and unconfirmed runs do not
suppress branch validation. API failures or event-delivery races can produce an
extra validation run; coverage takes priority over deduplication.

There is no second main-branch CI run: `publish.yml` calls the same reusable
`ci.yml` used by feature branches and pull requests, regardless of version changes.
The first push of a new main branch validates without selecting a release.
Fork main pushes also validate, but skip release selection and all publication.
New feature-branch/PR commits cancel superseded validation in their own event group;
separate main commits do not cancel each other's validation or approval waits.
Uploads and GitHub Release creation each serialize through their own queue.
GitHub permits up to 100 pending jobs with `queue: max`; inspect canceled runs if
that limit is reached. Older pending versions cannot move npm tags backwards.

## Manual dry-run and recovery

**Actions → Publish package → Run workflow** remains available. Select `main`
and supply:

- `version`: the exact version in `package.json`.
- `commit`: the full commit SHA selected by the dispatch.
- `dry-run`: defaults to `true`; no npm upload or GitHub Release is created.
- `tag`: `latest`, `next` or `test`. Prereleases cannot use `latest`.

For example, after merging an unpublished version into `main`:

```sh
git fetch origin main
gh workflow run publish.yml --ref main \
  -f version=0.3.0 \
  -f commit="$(git rev-parse origin/main)" \
  -f dry-run=true \
  -f tag=latest
```

In PowerShell, obtain the SHA with `$releaseCommit = git rev-parse origin/main`
and pass `-f "commit=$releaseCommit"` in a single-line command. A live manual
recovery uses `dry-run=false` and still requires environment approval. A dry-run
does not exercise OIDC or prove that a future publication will be accepted.

Prefer rerunning the failed jobs of the original workflow: they keep its exact
commit and release archive. If `main` has advanced, a fresh manual dispatch
cannot select an older commit; rerun the original workflow instead. Artifacts
are retained for 14 days. Recovery after artifact expiration may require a new
version; do not substitute an archive with different bytes.

The release checks existing npm versions before any upload. Matching identity
and SHA-512 integrity mean publication already succeeded, so the upload is
skipped. Different bytes, registry failures and malformed metadata
stop the job. An existing version is never overwritten. Direct npm dry-run also
rejects an already-published version; matching retries bypass that command and
verify integrity instead. A retry never changes an existing npm distribution tag.

npm may accept an upload before it becomes installable. Registry acceptance
checks the same full-metadata URL used by the pinned Yarn runtime, then attempts
the actual consumer installation. It checks up to 30 times, with ten-second pauses
and five-second metadata request timeouts. The consumer uses its own disposable
Yarn global folder. Missing versions, transient metadata errors and Yarn's exact
`YN0082` “No candidates found” error for the release version retry. Authentication,
dependency, script and other installation failures stop immediately, as do
invalid metadata and terminal HTTP errors. If processing lasts
longer, confirm availability and rerun only the failed verification jobs.

After draft creation, archive upload and publication, the GitHub Release helper
checks visibility up to ten times, with two-second pauses between reads (up to
18 seconds of waiting per phase). These requests require cache revalidation.
It repeats only reads, so a delayed response
does not create another release, upload another asset or publish the draft twice.
A newly uploaded asset's digest may finish processing during this wait; its final
digest must still match the validated archive. Permission/API errors and conflicting
commits, metadata or non-null digests fail immediately. If visibility never catches
up, the job stops with a phase-specific timeout and can be rerun to resume.

GitHub Release recovery resumes a matching draft after interrupted creation or
asset upload. Completed matching releases are left untouched. Both lightweight
and annotated tags must resolve to the expected commit. Conflicting tags,
draft targets, duplicate releases, missing published assets or unverifiable
asset digests require investigation; automation does not move tags, replace
assets or delete releases. A GitHub Release failure does not undo npm publication.

Do not unpublish to reset a release. npm versions cannot be reused after deletion.
See the [npm unpublish policy](https://docs.npmjs.com/policies/unpublish/).

## Repository and npm setup

Before enabling live publishing:

1. Own the npm scope and establish the package through an authorized first
   release. GitHub ownership and npm permissions are independent.
2. In npm **Settings → Trusted publishing**, configure owner `gaia-framework`,
   repository `config`, workflow `publish.yml`, environment `npm`, with permission
   for direct `npm publish`. Automatic releases keep this same workflow identity.
3. Restrict the GitHub `npm` environment to `main`, with required maintainer
   reviewers and administrator bypass disabled. If the repository plan cannot
   provide reviewer protection, keep live publishing disabled. A manual dispatch
   or version bump cannot replace it.
4. Set `NPM_TRUSTED_PUBLISHING_ENABLED=true` only after configuring those controls.
   Unchanged-version validation and manual dry-runs do not need enablement.

Only the protected publishing job receives `id-token: write`. The GitHub Release
job alone receives `contents: write`, using the built-in `GITHUB_TOKEN`. No
personal access token or permanent npm token is required. Public registry
verification requires no read credential. GitHub CLI generates
release notes and creates the tag directly at the selected commit; publication
is not chained through a tag-triggered workflow.

Forks, PR events, non-main branches and unrelated workflow files cannot publish
through the configured npm identity. Fork validation uses read-only permissions
and no publishing credentials. A contributor editing their fork's workflow does
not inherit access to this repository or the npm trusted publisher.

npm provenance stays disabled while the source GitHub repository is private, even
though the npm package is public. GitHub repository visibility is never changed
by this workflow. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[GitHub CLI releases](https://cli.github.com/manual/gh_release_create) and
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Verification boundaries

`yarn test` evaluates workflow gates and permissions, version ordering, real
Git-commit version selection, registry identity/integrity checks and GitHub
Release recovery with deterministic synthetic fixtures. The npm CLI upload tests
use a disposable loopback registry and synthetic credentials. GitHub CLI mutation
responses are simulated; these tests create no real releases or packages.

`yarn validate` additionally builds and packs the actual package and checks an
independently installed consumer. Hosted Linux/Windows CI runs the same checks.
Only a separately approved live release establishes end-to-end hosted OIDC,
GitHub Release creation and public registry acceptance for a new version.

Making an existing npm package public does not rewrite its previously published
archives. Older archives can retain `publishConfig.access: restricted`; anonymous
installation proves current read access. Local archive checks still require
`publishConfig.access: public`, and release integrity checks compare exact bytes.
