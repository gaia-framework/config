# 06-validation

This example uses Zod. With an installed package, run `yarn add zod` from your
application's root before running it. A repository development install already
provides Zod; it is not a runtime dependency of the library.

From the repository root:

```sh
cd examples/06-validation
node index.ts
```

Expected output:

```json
{"raw":{"port":"4001"},"validated":{"port":4001,"enabled":true}}
```

The command uses this directory as its working directory. Fixture paths resolve relative to their containing configuration file. See [all examples](../README.md) and the [API](../../docs/api.md).
