# Runnable examples

Run `yarn build` from the repository root first. Then change into an example directory and run `node index.ts`. `yarn test:examples` checks every expected result below; `yarn test:package` repeats them from an independent archive consumer.

All values are synthetic; no services or credentials are required.

When using an installed archive, copy its `examples` directory into your application's
root before running commands. Node 24 runs these TypeScript files directly outside
`node_modules`; library imports still use the package's compiled JavaScript.

Examples 06 and 11-16 use application-owned Zod schemas (14 and 15 reuse the
schemas from 11 and 12). When running them from an installed package, run
`yarn add zod` in your application's root first. A repository development install
already includes Zod. The other examples and the library itself do not require it.

- [01-memory](01-memory/README.md)
- [02-files](02-files/README.md)
- [03-overrides](03-overrides/README.md)
- [04-placeholders](04-placeholders/README.md)
- [05-directives](05-directives/README.md)
- [06-validation](06-validation/README.md)
- [07-di](07-di/README.md)
- [08-conventions](08-conventions/README.md)
- [09-hardening](09-hardening/README.md)
- [10-snapshots](10-snapshots/README.md)
- [11-service](11-service/README.md)
- [12-pipelines](12-pipelines/README.md)
- [13-toml](13-toml/README.md)
- [14-toml-service](14-toml-service/README.md)
- [15-toml-pipelines](15-toml-pipelines/README.md)
- [16-large-configuration](16-large-configuration/README.md)

The convention example prints the complete configuration objects. Directory and environment-selection controls do not become configuration properties; see [file loading](../docs/loading.md).
