# Layered service configuration in TOML

This example uses Zod. With an installed package, run `yarn add zod` from your
application's root before running it. A repository development install already
provides Zod; it is not a runtime dependency of the library.

A document service with HTTP settings, filesystem storage, API-key authentication,
background jobs, public routes and logging. Its schema and fixture layout are
independent examples owned by this library.
All values are synthetic; no server, provider, database or credential is needed.

Build from the repository root with `yarn build`, then run:

```sh
cd examples/14-toml-service
node index.ts
```

Expected output:

```json
{"port":4300,"environment":"production","storage":"filesystem","cleanupInterval":120,"cleanupEnabled":false,"route":"/health","fallbackDirectory":null,"origins":["https://local.example.test"],"logLevel":"warn"}
```

## Files and resolution

```text
config.toml
config.production.toml
config.local.toml
config.production.local.toml
parts/
  jobs.yaml
  routes.json
configuration.ts
index.ts
```

The four layers merge in the order shown. The supplied environment then applies
object and path overrides. `configuration.ts` owns the synthetic environment and
schema; importing the library alone does not read these files or `.env` files.

- `parts/jobs.yaml` supplies nested job settings; an interval placeholder is a
  string before schema validation and a number afterward.
- `parts/routes.json#public` selects an array fragment. Reader access traverses
  the first route with `routes.0.path`.
- `$env` reads a synthetic API key. Directory/environment controls and all example
  values come from the isolated environment in `configuration.ts`.
- Local settings replace origin arrays and clear `storage.fallbackDirectory`.
  The TOML counterpart uses the single-key `"$null" = true` marker for clearing.
- `SERVICE_CONFIG` changes the merged object, then `SERVICE_CONFIG_http_port`
  wins over that object override. The schema supplies the missing service tier.

Required and optional getters treat null values as absent. The output reads the
parent storage object to display the literal cleared value.

The [matching YAML example](../11-service/README.md) resolves to the same
raw configuration and validated output. Tests compare every factory, reader values,
strict/safe modes, immutable snapshots and service-cache identity.

When using an installed package, copy the whole `examples` directory into your
application first. TOML examples share the schema of their YAML counterpart.
