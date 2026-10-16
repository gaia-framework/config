# Modular processing pipelines in TOML

This example uses Zod. With an installed package, run `yarn add zod` from your
application's root before running it. A repository development install already
provides Zod; it is not a runtime dependency of the library.

A batch-processing application with workers, pipelines, destinations, routing rules,
feature switches and messages. Its schema and fixture layout are independent examples
owned by this library.
All values are synthetic; no server, provider, database or credential is needed.

Build from the repository root with `yarn build`, then run:

```sh
cd examples/15-toml-pipelines
node index.ts
```

Expected output:

```json
{"port":4500,"environment":"production","destination":"environment-primary","stages":["read","write"],"timeoutMs":60000,"workerConcurrency":2,"batchEnabled":true,"telemetryEnabled":false,"fallbackDirectory":null,"banner":"Synthetic batch processing service","literal":"${PIPELINE_EXAMPLE_ACCESS_KEY}","greeting":"Batch ready","label":"synthetic"}
```

## Files and resolution

```text
config.toml
config.production.toml
config.local.toml
config.production.local.toml
parts/
  workers.yaml
  shared/worker.toml
  pipelines.toml
  destinations.json
  routes.yaml
  banner.txt
configuration.ts
index.ts
```

The four layers merge in the order shown. The supplied environment then applies
object and path overrides. `configuration.ts` owns the synthetic environment and
schema; importing the library alone does not read these files or `.env` files.

- `parts/workers.yaml` includes one shared worker twice, using paths relative to
  that fragment. The loader reuses the included object.
- `parts/pipelines.toml` includes named destinations from `destinations.json`.
- `parts/routes.yaml` supplies both an array fragment and its first object fragment.
- `$env` reads a synthetic access key; `$file` reads `parts/banner.txt`.
- An escaped placeholder remains literal, quoted fallbacks normalize, and boolean
  placeholders become booleans. Schema validation converts worker concurrency to
  a number and supplies the missing deployment label.
- Local settings replace stage/origin arrays and clear `storage.fallbackDirectory`.
  The TOML counterpart uses the single-key `"$null" = true` marker for clearing.
- `PIPELINE_CONFIG` overrides the merged object, then `PIPELINE_CONFIG_*` path
  overrides win. `workers_batch___runner_enabled` addresses `batch-runner`.
- `index.ts` binds an immutable reader to Inversify and resolves `ConfigService`
  through constructor injection.

Required and optional getters treat null values as absent. The output reads the
parent storage object to display the literal cleared value.

The [matching YAML example](../12-pipelines/README.md) resolves to the same
raw configuration and validated output. Tests compare every factory, reader values,
strict/safe modes, immutable snapshots and service-cache identity.

The TOML example follows a TOML → YAML → TOML/JSON include graph. The YAML
example uses YAML/JSON fragments. Both have the same configuration structure
and resolved values.

For generated configurations larger than 1 MiB, see
[16-large-configuration](../16-large-configuration/README.md).

When using an installed package, copy the whole `examples` directory into your
application first. TOML examples share the schema of their YAML counterpart.
