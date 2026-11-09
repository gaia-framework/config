# Contributing

Use Node 24. If `yarn` is not installed, run `npm install -g yarn` once.
Inside the checkout, `.yarnrc.yml` selects the checked-in Yarn 4.12.0 runtime;
`yarn --version` should report `4.12.0`. An existing Corepack-managed command
also works. Install dependencies with `yarn install --immutable`; use Yarn for
dependency changes and packing.
Do not edit the lockfile by hand. Use Yarn to update dependencies deliberately.

The root `resolutions` temporarily selects patched glob 14 and minimatch 11 for
development tools whose dependency ranges still request vulnerable versions.
These overrides do not add runtime dependencies. Recheck them when Mocha, c8,
ESLint and typescript-eslint update their ranges; remove the overrides when the
upstream ranges select patched versions. Their major-version changes affect
matching internals, so validate lint, test discovery and compiled coverage after
updates rather than assuming compatibility.

Keep `@types/node` on the Node 24 release line. TypeScript is pinned to 5.9.3;
compiler upgrades are separate compatibility changes that must verify emitted
declarations, container-free use and independently compiled DI consumers.
Dependabot stays within Node 24 types and the TypeScript 5.9 release line;
patch updates remain eligible.

Dependabot checks npm/Yarn dependencies and GitHub Actions each Monday at 09:00
America/New_York. Routine development dependency and Actions minor/patch updates
are grouped; runtime dependencies and major updates receive separate PRs.
Security updates remain enabled independently of the weekly version-update
schedule. Every update requires review and the normal Linux/Windows validation;
updates do not publish packages or merge automatically.

Run `yarn format` to format maintained TypeScript and repository JSON.
`yarn format:check` is enforced by lint. Keep braces around control-flow bodies,
separate statements onto their own lines, and use blank lines between logical
steps. Do not format the vendored Yarn runtime.

Run `yarn validate` before delivery. Focused `yarn test --grep ...` is available
through Mocha; run the full suite and independent archive acceptance after any
public behavior or packaging change. See [testing](#testing) below.

The `package.json` files allowlist controls published contents; `.npmignore`
records repository/tooling exclusions without hiding compiled exports or example
fixtures. Keep compiled output limited to `dist/src`. `yarn test:package` verifies
the Yarn archive against npm's dry-run manifest, including a leftover compiled-test
probe, nested development license and nested Markdown probes, then installs the
archive in an independent consumer. Keep the explicit root documentation/license
allowlist entries anchored: `/README.md`, `/CONTRIBUTING.md`, `/CHANGELOG.md`, `/SECURITY.md` and
`/LICENSE`. Unanchored names also match nested tooling files in Yarn 4.12. npm inspects
archive metadata and handles the final OIDC upload in the protected release
workflow. Dependency installation and actual packing use Yarn. See
[releasing](docs/releasing.md) for approval, fork behavior and test boundaries.

`yarn benchmark` runs the full synthetic performance suite from a development
checkout; `yarn benchmark:smoke` checks its smaller fixtures and measurements.
See [benchmarking](docs/benchmarking.md). Keep expensive performance runs outside
ordinary validation, and do not turn machine-dependent timings into CI thresholds.

Keep tests under `test`, production code under `src`, and runnable examples under
`examples`. Filesystem tests own temporary directories and restore environment
changes. Provider, database and application-service dependencies do not belong in
this library. Use library-owned synthetic fixtures and explicit expected outcomes;
do not add private application snapshots or external source manifests.

Preserve documented behavior and explain intentional contract changes in the
pull request and changelog. The package is MIT-licensed; keep [LICENSE](LICENSE)
in package archives. Use synthetic values in fixtures and examples; never commit
credentials, local configuration or real application data.

Keep maintained examples, tools, tests and configuration source in `.ts` files.
Node 24 runs examples and tools directly; no TypeScript loader is required for
them. `yarn typecheck` checks their imports and types as well as the library.
Independent package tests also check example types against installed declarations.
Independent package tests compile their consumer fixtures
to JavaScript outside the checkout and execute them without TypeScript loaders.
Record public behavior changes in CHANGELOG and maintain the Markdown guides.
Keep agent journals and generated reports local and ignored. Make every example
executable with a checked expected result.

`test/support` contains shared validation helpers: documentation and source-layout
checks, disposable fixtures and isolated environment setup. Test infrastructure
does not ship in npm archives. Report vulnerabilities privately using
[SECURITY.md](SECURITY.md).

## Testing

| Suite | Purpose |
| --- | --- |
| `test/unit` | Parsing, substitution, merging, overrides, readers and options |
| `test/integration` | File pipelines, mixed includes, schemas, services and DI |
| `test/compatibility` | Public contract regressions with explicit expected outcomes |
| `test/examples` | Run every documented example and check its expected output |
| `test/package` | Archive contents, installed declarations, runtime imports and independent consumers |

Add focused regression tests beside the behavior being changed. Exercise default
and enabled options, errors, special property names and cache behavior where
relevant. Keep YAML and TOML examples equivalent when they demonstrate the same
feature. Tests should assert results rather than implementation details or timing
thresholds. Use [coverage reports](docs/coverage-notes.md) to investigate missing
checks; a coverage percentage alone does not establish compatibility.
