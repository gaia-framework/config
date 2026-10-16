# Test coverage

Run `yarn test:coverage` to generate HTML, LCOV and JSON reports in `coverage/`
and compiled test results in `artifacts/tests.json`. Open `coverage/index.html`
to inspect uncovered statements and branches. Reports are generated locally and
retained as CI artifacts; do not commit per-run reports or percentages.

The command compiles tests and production modules, runs the compiled suite under
Node, and remaps coverage through source maps. All production modules are
included. Child-process checks execute compiled JavaScript directly so coverage
uses the same representation as the parent process.

`yarn validate` also runs source tests, type checks, example smoke tests and
independent installed-consumer checks. See [contributor testing](../CONTRIBUTING.md#testing)
for the suite layout.

Review uncovered executable branches against supported behavior and add focused
regressions where needed. Inspect the HTML and source together: type-only exports,
transpiler wrappers and defensive fallbacks can produce coverage entries without
a reachable configuration scenario. Do not add artificial runtime code, exclude
production modules or weaken assertions to improve a percentage.

Coverage complements output assertions, error tests and compatibility checks.
It does not establish application deployment readiness or performance.
