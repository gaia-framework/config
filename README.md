# @gaia-framework/config

Synchronous configuration for Node.js applications: layered YAML or TOML files,
environment overrides, reusable file fragments, optional Zod validation, and
typed getters. Use it with plain objects, load files into a reader, or bind a
configuration service in your application's DI container. The library has no
runtime dependency on a container or decorator metadata.

- Ordered file layers and explicit `--config` selection.
- Deep object merging, array replacement, and explicit `null` values.
- Environment placeholders, fallbacks, escaping, and per-key overrides.
- `$env`, `$file`, and YAML/JSON/TOML `$include` directives with fragment selection.
- Required and optional getters, literal key paths, and key enumeration.
- Optional strict input checks, isolated environments, immutable snapshots, and
  safe errors.
- TypeScript declarations and compiled ESM exports.

The library is MIT-licensed. Package archives include source, compiled exports,
declarations, documentation and examples.

Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Requirements

Node.js **24 or newer**, with ESM imports. CI validates Node 24 on Windows and
Linux. Ordinary consumers run the compiled JavaScript without `tsx` or special
Node conditions. CommonJS and browser builds are not provided.

## Supported scope

Automatic discovery defaults to `.yaml`; choose `fileFormat: 'toml'` for `.toml`
layers. Includes support `.yaml`, `.yml`, `.json` and `.toml`, including mixed-format
chains. There is no remote loading, watcher, or async API. See [TOML](docs/toml.md).
Importing the library does not load `.env` files.

## Installation

Install the package in your application:

```sh
npm install @gaia-framework/config
```

Or with Yarn:

```sh
yarn add @gaia-framework/config
```

Zod is optional. Install it separately with `yarn add zod` if your application
uses Zod schemas.

### Build a local archive

If the `yarn` command is not installed, install it globally once:

```sh
npm install -g yarn
```

Inside this repository, `yarn` uses the checked-in Yarn 4.12.0 runtime selected by
`.yarnrc.yml`. An existing Corepack-managed `yarn` command also works.

To build an archive from a checkout you can access:

```sh
git clone https://github.com/gaia-framework/config.git
cd config
yarn install --immutable
yarn build
yarn pack --out artifacts/gaia-framework-config-0.3.0.tgz
```

Copy the generated archive into your application's directory, then install it:

```sh
yarn add ./gaia-framework-config-0.3.0.tgz
```

The archive contains compiled exports, declarations, development sources, docs,
examples, and the license. It works independently of this checkout.

## Quick start

Save this as `app.ts` in your application and run `node app.ts`:

```js
import { createConfig } from '@gaia-framework/config';

const config = createConfig({
  http: { port: 4001 },
  feature: { enabled: true },
  providers: ['local']
});

console.log(config.getNumber('http.port')); // 4001
console.log(config.getBoolean('feature.enabled')); // true
console.log(config.getStringArray('providers')); // ['local']
console.log(config.getOptionalString('http.host') ?? 'localhost'); // localhost
```

### Load YAML files

Create `config.yaml` in your application's working directory:

```yaml
http:
  host: ${APP_HOST:-localhost}
  port: 4001
feature:
  enabled: ${APP_FEATURE_ENABLED:-false}
```

Replace `app.ts` with:

```js
import { createConfigFromFiles } from '@gaia-framework/config';

const config = createConfigFromFiles({ argv: [] });

console.log(config.getNumber('http.port')); // 4001
console.log(config.getString('http.host')); // localhost when APP_HOST is unset
console.log(config.getBoolean('feature.enabled')); // false when unset
```

`argv: []` disables inspection of the application's command-line arguments.
Omit it to accept repeated `--config <file>` arguments, for example
`node app.ts --config base.yaml --config deployment.yaml`. Selected files replace
automatic discovery and merge in argument order.

### Load TOML files

Create `config.toml`:

```toml
[http]
port = 4001
host = "${APP_HOST:-localhost}"

[feature]
enabled = "${APP_FEATURE_ENABLED:-false}"
```

Select TOML discovery explicitly:

```js
const config = createConfigFromFiles({ fileFormat: 'toml', argv: [] });
console.log(config.getNumber('http.port')); // 4001
```

The same environment, merge, directive and schema rules apply after parsing.
TOML dates must be quoted, unsafe integers must be quoted, and `{ "$null" = true }`
clears an inherited value. See the [TOML guide](docs/toml.md) and
[runnable examples](examples/13-toml/README.md).

## Loading order and merging

Automatic discovery merges the following files, with later values taking priority:

| Order | File or override |
| --- | --- |
| 1 | `config.yaml` |
| 2 | `config.{environment}.yaml` |
| 3 | `config.local.yaml` |
| 4 | `config.{environment}.local.yaml` |
| 5 | Whole-object `CONFIG` environment override |
| 6 | Per-key `CONFIG_*` environment overrides |
| 7 | Supplied schema validation, defaults, and transformations |

With `fileFormat: 'toml'`, the same four discovery layers use `.toml` instead.

The directory comes from `basePath`, then `CONFIG_DIR`, then `process.cwd()`.
The environment comes from `envName`, then `CONFIG_ENV`, then `NODE_ENV`, then
`development`. These names and the `config` filename prefix are configurable.

Objects merge recursively; arrays and scalars replace earlier values. `null`
clears a value, while `undefined` does not override it. Missing discovery layers
are optional. Missing explicit files are also skipped by default; enable
`strictFiles: true` to require them. See [file loading](docs/loading.md).

## Environment overrides and placeholders

An explicit environment map makes this example independent of shell syntax:

```js
import { loadConfigObjectFromFiles } from '@gaia-framework/config';

const config = loadConfigObjectFromFiles({
  argv: [],
  inheritProcessEnv: false,
  env: {
    CONFIG: '{"http":{"host":"example.test","port":4001}}',
    CONFIG_http_port: '5000'
  }
});

console.log(config.http.port); // 5000
console.log(config.http.host); // example.test
```

`CONFIG` must be a JSON object. Per-key values are parsed as JSON when possible,
so numbers, booleans, arrays, objects, and `null` can override file values.
Names are case-sensitive: `CONFIG_http_port` targets `http.port`, `__` encodes
a literal underscore, and `___` encodes a hyphen.

Inside YAML, `${NAME}` requires a non-empty variable; `${NAME:-fallback}` supplies
a fallback, and `$${NAME}` preserves the literal `${NAME}`. A whole placeholder
with a `true` or `false` fallback produces a boolean and validates that vocabulary.
Numeric placeholders remain strings until a getter or schema converts them.

By default, a supplied `env` map replaces process variables for discovery and
overrides, but placeholders and `$env` can still fall back to individual process
variables. Set `inheritProcessEnv: false` for full isolation. See
[environment variables](docs/environment.md) for escaping, empty values, encoding,
and exact precedence rules.

## Includes and file directives

Directives are objects with exactly one key and a string argument:

```yaml
label: { $env: APP_LABEL }
message: { $file: ./message.txt }
service: { $include: ./parts/service.yaml }
firstItem: { $include: "./parts/items.json#items.0" }
```

`$env` reads a required string. `$file` reads UTF-8 text verbatim. `$include`
parses YAML, JSON or TOML and resolves nested placeholders and directives. Relative
paths start from the file containing the directive; fragments select nested
object properties or array elements. Cycles are rejected and repeated includes
are cached per loader. Use trusted configuration files: directives can read
paths accessible to the Node process.

The [directive guide](docs/directives.md) explains fragments, errors, relative
paths, and cache lifetime. [Example 05](examples/05-directives/README.md) includes
all required fixture files and an expected result.

## Schema validation

Validation is optional. If your application uses Zod, install it explicitly:

```sh
yarn add zod
```

Supply a synchronous Zod schema to validate, apply defaults, and transform values:

```js
import { z } from 'zod';
import { createConfig } from '@gaia-framework/config';

const schema = z.object({
  port: z.coerce.number().int().positive(),
  enabled: z.boolean().default(true)
});
const config = createConfig({ port: '4001' }, schema);

console.log(config.getNumber('port')); // 4001
console.log(config.getBoolean('enabled')); // true
```

Zod is a development dependency of this repository, not a runtime or peer dependency
of the library. Applications choose their own Zod version; custom synchronous
schemas can implement the exported `ConfigSchema<T>` interface instead. For files,
pass `schema` to a file factory; it runs after loading, resolution, merging, and
environment overrides. `loadConfigLayersFromFiles(options)` returns raw layers
without running a schema, even if one is present in the options.

Without a supplied schema, there is no schema validation or application-specific
defaulting. Validation failures throw. Async schemas are unsupported. See
[validation and DI](docs/validation-and-di.md).

## Readers, services, and typed getters

`createConfig` and `createConfigFromFiles` return a `ConfigReader`.
`createConfigService` and `createConfigServiceFromFiles` return a `ConfigService`
with the same getter interface.

| Required getter | Optional counterpart | Purpose |
| --- | --- | --- |
| `get<T>(path)` | `getOptional<T>(path)` | Read a value with a caller-supplied type assertion |
| `getString(path)` | `getOptionalString(path)` | Require a string |
| `getNumber(path)` | `getOptionalNumber(path)` | Read a number or convert a value numerically |
| `getBoolean(path)` | `getOptionalBoolean(path)` | Read a boolean or a recognized boolean string |
| `getStringArray(path)` | `getOptionalStringArray(path)` | Require a string array |

Required getters throw for missing or `null` values and typed getters reject
invalid values. Optional getters return `undefined` for missing/`null` values;
optional typed getters also return `undefined` for ordinary type mismatches.
Default numeric conversion follows JavaScript `Number`; boolean getters accept
`true/false`, `1/0`, `yes/no`, and `on/off` strings without trimming whitespace.
Use strict getters when narrower conversions are needed.

Every getter and `has(path)` accepts a dotted string or literal segment array.
For example, `getString(['literal.name'])` reads a single dotted property, while
`getString('literal.name')` traverses two properties. Numeric segments access array
elements. `keys()` lists captured dotted keys; `keyPaths()` returns defensive
copies of unambiguous segment arrays. Arrays are leaves during enumeration.

Generic getter types are assertions, not schema-inferred paths or runtime
validation. See the [API reference](docs/api.md) for every export, option, default,
conversion, and error contract.

## Caching and optional stricter behavior

`createConfigServiceFromFiles` reuses services for equivalent loading options,
environment snapshots, and schema identity. **Changing file contents alone does
not invalidate that cache.** Pass `cache: false` to read fresh files each time.
`createConfigFromFiles` and the object-loading functions do not reuse services.
Reusing a `ConfigLoader` also reuses its include cache; construct a new loader
for fresh includes.

Readers cache lookups and capture their key index at construction. Treat their
data as stable after construction. Default values can share mutable object/array
references; `immutable: true` instead creates a detached, deeply frozen snapshot
of supported plain data after schema processing.

| Option | Effect when enabled |
| --- | --- |
| `strictFiles` | Require explicitly selected files and valid `--config` arguments |
| `strictGetters` | Require finite numeric input, strict boolean strings, and dense string arrays |
| `strictPaths` | Reject empty path segments and noncanonical array indices |
| `inheritProcessEnv: false` | Disable implicit process environment reads |
| `safeErrors` | Return fixed-message `ConfigError` codes without original error causes |
| `immutable` | Copy supported data into a deeply frozen reader snapshot |
| `cache: false` | Bypass service reuse in `createConfigServiceFromFiles` |

Strict checks, safe errors, and immutable snapshots are disabled by default;
environment inheritance and file-service caching are enabled. File factories take
these options directly. In-memory factories take reader options as their third
argument, after the optional schema. See the [API reference](docs/api.md#in-memory-inputs-and-option-placement)
for option placement, [strict getters](docs/api.md#strict-getters),
[safe errors](docs/api.md#safe-errors), and [snapshots](docs/api.md#immutable-snapshots).
The [loading guide](docs/loading.md) covers parser depth and cache lifetimes.

## Inversify integration

Install `inversify` and `reflect-metadata` in the application, bind a reader and
construct the ordinary service explicitly:

```js
import 'reflect-metadata';
import { Container } from 'inversify';
import { ConfigReader, ConfigService } from '@gaia-framework/config';

const container = new Container();
container.bind(ConfigReader).toConstantValue(new ConfigReader({ port: 4001 }));
container.bind(ConfigService).toDynamicValue((context) =>
  new ConfigService(context.get(ConfigReader))
);

console.log(container.get(ConfigService).getNumber('port')); // 4001
```

Declare `inversify` and `reflect-metadata` in applications that import them.
Initialize metadata before decorated classes; TypeScript applications using
decorators should retain the corresponding compiler settings. See
[validation and DI](docs/validation-and-di.md) and the
[runnable DI example](examples/07-di/README.md).

## Documentation and examples

| Guide | Contents |
| --- | --- |
| [Public API](docs/api.md) | Factories, classes, types, getters, defaults, and errors |
| [File loading](docs/loading.md) | Discovery, working directory, explicit files, merging, and caching |
| [Environment variables](docs/environment.md) | Overrides, path encoding, placeholders, fallbacks, and escaping |
| [Directives](docs/directives.md) | Environment/text reads, mixed-format includes, fragments, and cycles |
| [TOML](docs/toml.md) | Explicit TOML discovery, null clearing, type rules and syntax |
| [Validation and DI](docs/validation-and-di.md) | Zod processing and Inversify composition |
| [Runnable examples](examples/README.md) | Commands, fixture files, and expected outputs for all examples |
| [Custom naming](examples/08-conventions/README.md) | Explicit custom service and platform naming options |
| [Internal architecture](docs/architecture.md) | Module ownership, resolution context, caching, and validation boundaries |

For complete application examples, start with the [layered service](examples/11-service/README.md)
or [modular processing pipelines](examples/12-pipelines/README.md). Each has a matching
TOML version with the same resolved values and a library-owned synthetic schema.

Use [benchmarking](docs/benchmarking.md) to generate timing tables for your own
workloads. Results belong in ignored artifacts or CI artifacts; they are not
committed per-machine snapshots or universal performance guarantees.

## Development and verification

Use Node 24 and run the commands below from the repository root. Follow the
[installation steps](#installation) to make `yarn` available, then confirm that
`yarn --version` reports `4.12.0` inside the checkout.

Maintained examples, tools, tests and configuration use `.ts` source. Run examples
directly with Node 24 (`node index.ts` from their documented directory). Type checks
cover the examples and tools; independent package checks also validate examples
against installed declarations and execute compiled JavaScript consumer fixtures.

| Command | Purpose |
| --- | --- |
| `yarn lint` | Formatting, ESLint, and Markdown/example checks |
| `yarn typecheck` | Check TypeScript without emitting output |
| `yarn test` | Unit, integration, and regression tests |
| `yarn test:coverage` | Compiled tests and production coverage |
| `yarn build` | Compile production JavaScript and declarations |
| `yarn test:examples` | Run every documented example; build first |
| `yarn test:package` | Build, pack, and verify a disposable independent consumer |
| `yarn validate` | Run the full sequence above |
| `yarn benchmark:smoke` | Check synthetic benchmark fixtures without speed thresholds |
| `yarn benchmark` | Run the full synthetic timing suite |
| `yarn benchmark:traversals` | Measure graph guards, schema processing, snapshots, indexing, and factory construction |

CI runs full validation and benchmark smoke on Windows and Linux for every branch
push and pull request, including feature branches without a PR. A feature push
skips duplicate validation when PR CI already covers the same commit. Main pushes
run the shared checks through `publish.yml`, even without a version bump.
New updates cancel superseded feature-branch or PR runs; main commits keep their
own validation and release approval waits.
Package acceptance compares npm/Yarn archive contents, verifies the license, checks
compiled imports and declarations, exercises development exports and DI, and
runs the examples outside the checkout. Tests use synthetic data and disposable
files. Coverage is written to `coverage/`; reports and archives to `artifacts/`.
See [contributing](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## Releases

Merging a higher `package.json` version into `main` starts a release after
Linux/Windows validation and required maintainer approval. The workflow publishes
to npm, verifies the installed package, then creates a matching GitHub Release
with generated notes and the validated archive. Other merges run validation only.
Manual dry-runs and recovery remain available. Forks can validate but do not
inherit publishing permission. See the [release guide](docs/releasing.md).

## License

[MIT](LICENSE) © 2026 gaia-framework. Dependencies retain their own licenses.
