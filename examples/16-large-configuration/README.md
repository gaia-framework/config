# Large nested configuration

This example uses Zod. With an installed package, run `yarn add zod` from your
application's root before running it. A repository development install already
provides Zod; it is not a runtime dependency of the library.

This runnable example generates a TOML document larger than 1 MiB, 1,000 nested
components and 25 included fragments reached through an intermediate TOML file.
It exercises placeholders, local overlays, object/path overrides, schema
validation, typed getters and immutable snapshots using entirely synthetic data.
It needs no application checkout, service or credentials. Files are generated in
an owned temporary directory and removed after the run.

Build from the repository root with `yarn build`, then run:

```sh
cd examples/16-large-configuration
node index.ts
```

Expected output:

```json
{"componentCount":1000,"groupCount":25,"port":4500,"lastValue":999,"payloadChecked":true}
```

To generate 10,000 components instead, run `node index.ts --records=10000`.
The component count then becomes 10,000 and the final value is 9,999. Valid record
counts are integers from 1,000 through 10,000. This is a correctness example;
use the [benchmark harness](../../docs/benchmarking.md) for repeatable timing tables.
