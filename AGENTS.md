# AGENTS.md

## Scope and source of truth

These instructions apply throughout this repository. More specific `AGENTS.md`
files apply within their directories. Follow explicit task instructions and keep
changes within the requested scope.

This repository owns `@gaia-framework/config`, a general-purpose synchronous
TypeScript ESM configuration library for Node.js. Start with [README](README.md),
[CONTRIBUTING](CONTRIBUTING.md), the [API reference](docs/api.md), and nearby code.
Use existing patterns before introducing a dependency, abstraction or directory.

Before editing, inspect the current branch and working-tree changes. Preserve
unrelated edits. Do not reset, clean, overwrite or reformat another contributor's
work. Do not modify sibling repositories, worktrees or running services as part
of a library change.

## Repository map and ownership

| Location | Responsibility |
| --- | --- |
| `src/index.ts` | Supported package exports |
| `src/config.ts`, `src/loadOptions.ts` | Factories, discovery, pipeline orchestration and loading contracts |
| `src/loader/` | Format parsing, environment substitution, directives and include resolution |
| `src/merge.ts`, `src/envOverrides.ts` | Merge semantics and environment overrides |
| `src/reader/` | Typed access, paths, key indexing, conversions and immutable snapshots |
| `src/services/` | Container-independent service delegation and factory-service cache |
| Other `src/` modules | Shared types, options, input validation and error handling |
| `test/unit/`, `test/integration/`, `test/compatibility/` | Unit, pipeline and public contract regression tests |
| `test/package/`, `test/examples/`, `test/support/` | Independent consumers, example checks and shared test infrastructure |
| `examples/`, `docs/` | Runnable consumer examples and maintained developer guides |
| `scripts/` | Reusable TypeScript build, benchmark and release tools |
| `.github/workflows/` | Cross-platform validation and guarded releases |

Keep parsing separate from resolution, merging, schema validation and reading.
Readers must not acquire filesystem or process-environment responsibilities.
Keep `ConfigService` a thin reader delegate and service-cache policy in its owning
module. See [architecture](docs/architecture.md) for the existing boundaries.

## Clean code and TypeScript

- Write maintained library, test, example and tooling code in `.ts`. Do not add
  maintained `.js`, `.mjs`, `.cjs` or `.mts` implementations. Generated JavaScript,
  and the vendored Yarn runtime are exceptions.
- Use the existing TypeScript ESM import conventions, including `.js` specifiers
  in compiled library source. Keep ordinary package consumers independent of
  TypeScript loaders and special Node conditions.
- Run the repository formatter. Use braces for control flow, one statement per
  line, and blank lines between logical steps. Keep tests as readable as source;
  avoid compressed setup, chained side effects and dense one-line branches.
- Prefer descriptive names, focused functions, explicit inputs and clear return
  types at public boundaries. Reduce nesting with guard clauses where they
  preserve evaluation order and error behavior.
- Use existing types, narrow `unknown` at boundaries, and avoid unjustified `any`,
  non-null assertions, double casts or broad type suppressions. Generic getter
  types are assertions, not runtime validation.
- Extract a helper when it removes meaningful duplication or names a cohesive
  operation. Prefer composition and small interfaces; do not add speculative
  plugin systems, inheritance hierarchies or wrappers around a single trivial call.
- Comments should explain invariants, compatibility requirements or non-obvious
  choices. Remove obsolete comments and dead code; do not leave commented-out
  implementations or unexplained TODOs.
- Fix the underlying typing or lint configuration before adding a suppression.
  If an exception is unavoidable, scope it narrowly and explain why. Keep runtime
  dependencies container-independent; application DI registration belongs in
  consumer code and development-only integration tests.
- Keep refactors focused. Do not combine unrelated formatting, dependency upgrades,
  feature additions and behavior fixes in an optimization or extraction change.

## Public behavior and compatibility

Preserve the contracts in the usage guides unless the task explicitly changes
them. A bug fix that changes observable behavior needs focused regression tests
and a clear explanation in the changelog and pull request.

- Preserve synchronous loading, ESM exports, declaration resolution, the source
  development condition and explicit DI integration. Do not introduce CommonJS builds,
  new formats, watchers, remote sources or async APIs incidentally.
- Keep YAML as default discovery and TOML explicitly selectable. Preserve file
  precedence, repeated `--config` order, missing/strict-file rules, supplied
  environment handling and override precedence.
- Preserve object merging, array replacement, null clearing, undefined handling,
  placeholder fallback/escaping/coercion, mixed-format directives, fragment
  resolution, relative paths, include cycles and cache lifetimes.
- Preserve schema defaults, transforms and failures, required/optional getter
  behavior, literal paths, strict modes, safe errors and immutable snapshots.
  Schema integration uses the structural synchronous contract; Zod is optional
  and belongs to applications that use it.
- Cache changes must preserve identity, invalidation inputs, reference sharing,
  environment observation and error behavior. Do not cache failed loads or
  substituted values where the existing contract requires fresh evaluation.
- Treat special keys such as `__proto__`, `constructor` and `toString` as ordinary
  own data. Preserve prototype-safe writes, own-property lookups, cycle checks,
  depth limits and descriptor/accessor behavior.
- Keep `.env` loading application-owned. Importing the package root must not
  load local files, start services or introduce other new side effects.
- Assert documented contracts with synthetic fixtures and explicit expected
  outcomes. Do not add private application snapshots, source manifests or
  external repository dependencies to tests, or weaken regression assertions.

## Dependencies and commands

Use Node 24 and Yarn 4.12.0. Contributor setup uses `npm install -g yarn` when
`yarn` is unavailable; an existing Corepack-managed command also works. Run
commands from the repository root, where `.yarnrc.yml` selects the checked-in
runtime. Confirm `yarn --version` reports `4.12.0`. CI and internal tooling may
invoke the checked-in runtime directly for reproducible bootstrap.

```sh
yarn install --immutable
yarn format
yarn validate
```

| Command | Purpose |
| --- | --- |
| `yarn lint` | Formatting, ESLint, Markdown links and source-layout checks |
| `yarn typecheck` | Library, test, tooling and example types |
| `yarn test` | Source unit, integration and compatibility suites |
| `yarn test:coverage` | Compiled tests and coverage reports |
| `yarn build` | Compiled library and declarations |
| `yarn test:examples` | Documented example outputs |
| `yarn test:package` | Yarn archive and disposable installed consumers |
| `yarn benchmark:smoke` | Benchmark harness checks without timing thresholds |

`yarn validate` runs lint, type checking, source tests, compiled coverage, build,
examples and package acceptance in sequence. Use Yarn for dependency changes and
packing; never hand-edit `yarn.lock`. Declare runtime dependencies explicitly and
keep development-only dependencies out of consumers' runtime requirements.
Do not modify the vendored package manager or rely on monorepo hoisting.

## Testing and validation

- Start with focused tests for the changed behavior, then run `yarn format` and
  `yarn validate` before handoff. GitHub CI must pass on Linux and Windows for the
  exact final commit before reporting a PR ready. Report unavailable or failing
  checks plainly; do not claim unrun checks passed.
- Follow existing Mocha, Chai and Sinon patterns. Test public outcomes, errors and
  relevant identities rather than private implementation structure. Add regression
  coverage for fixes; avoid redundant tests for trivial formatting changes.
- Keep tests deterministic and isolated. Own disposable directories, restore
  environment changes and stubs, and use child processes where global state needs
  isolation. Never require credentials, live providers, databases or application
  startup for ordinary validation.
- Exercise default and enabled options, malformed inputs and cross-platform path
  handling when relevant. Preserve paired YAML/TOML feature coverage and actual
  DI resolution with consumer-owned dependencies and a container-free consumer.
- Verify compiled imports, declarations, development exports and examples through
  an independently installed archive outside the checkout. Coverage percentages
  complement behavior assertions; do not exclude production modules or relax
  checks merely to improve a percentage.

## Performance work

Profile before optimizing. Compare the unchanged baseline and candidate using
matched inputs and capabilities, warmups and repeated samples. Assert outputs,
errors and relevant identities as well as measuring time. Account for allocation,
memory retention, deep inputs, ordinary small inputs and cache lifecycle.

Keep an optimization only when measurements support it and compatibility checks
pass. Do not remove features, input guards or prototype-safe handling for a faster
benchmark. Report mixed results honestly. Follow [benchmarking](docs/benchmarking.md);
keep generated fixtures and machine-specific results ignored, and never make
wall-clock performance thresholds part of ordinary CI.

## Documentation, examples and package contents

- Keep README and guides developer-facing, with commands, defaults, examples and
  relevant boundaries beside their features. Update docs and `CHANGELOG.md` when
  public behavior changes. Avoid duplicated contracts and internal work logs.
- Examples must use synthetic values and independent application vocabulary.
  Include fixtures, working-directory instructions and checked expected outputs;
  register executable scenarios in the existing example runner.
- Never commit secrets, tokens, credentials, local configuration, real application
  data or generated performance reports. Keep source attribution, dependency
  notices and the MIT license intact.
- Treat `dist/`, `coverage/`, `artifacts/` and other generated output as derived.
  Keep tests, tooling, local journals and private evidence out
  of package archives. Preserve the package allowlist and verify it with
  `yarn test:package`; do not rely on `.npmignore` alone.
- Optional local notes belong in ignored `JOURNAL.md`, `journal/` or `.evidence/`.
  If using an existing journal, read its entrypoint first. Keep public project
  history in the changelog and pull requests, not agent handoff records.

## Git and release discipline

Keep commits cohesive and descriptions focused on the resulting behavior and
validation. Inspect the final diff for unrelated edits, generated files, secrets
and accidental API changes. Preserve uncommitted user work.

Merging, npm publication, visibility changes and consumer migrations require
explicit authorization. A cleanup request does not authorize them. Follow
[releasing](docs/releasing.md), preserve dry-run defaults, repository/fork guards
and approval requirements, and never bypass protections to make a release pass.
Do not change package identity, version or license incidentally.

At handoff, summarize what changed, checks actually run, material limitations and
any remaining work. Identify the commit or PR when one was created; distinguish
local validation from hosted CI and application-level acceptance.
