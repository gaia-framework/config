# Public API

All supported imports come from `@gaia-framework/config`. This is a synchronous Node library.
The default export condition resolves compiled ESM; there is no separate CommonJS
or browser build; ESM-only support is intentional. The `development` condition resolves included TypeScript source
and requires a TypeScript-aware loader such as `tsx`.

## Factories and file pipeline

| Export | Input | Result |
| --- | --- | --- |
| `createConfig(value, schema?, options?)` | Configuration input, optional synchronous schema and reader options | `ConfigReader`; resulting root must be an acyclic object |
| `createConfigService(valueOrReader, schema?, options?)` | Input or existing reader, reader options | `ConfigService`; an existing reader skips schema validation; explicit options create a new reader over the same data |
| `loadConfigLayersFromFiles(options?)` | Loading options | Merged raw `ConfigData`; deliberately ignores `schema` |
| `loadConfigObjectFromFiles<T>(options?)` | Loading options and optional schema | Parsed/transformed object typed as `T` |
| `createConfigFromFiles(options?)` | Same options | Reader of the loaded/validated object |
| `createConfigServiceFromFiles(options?)` | Same options | Cached service of the loaded/validated object |
| `resetConfigServiceCacheForTests()` | No arguments | Clears factory-service cache under a test environment. Set `NODE_ENV=test` or `CONFIG_ENV=test`; throws outside test mode |

`LoadConfigOptions<T>` has these optional fields:

| Field | Default / meaning |
| --- | --- |
| `basePath` | Resolve explicitly, otherwise environment directory variable, otherwise `process.cwd()` |
| `envName` | Explicit value, environment name variable, `NODE_ENV`, then `development`; whitespace trimmed |
| `argv` | `process.argv.slice(2)`; pass `[]` to disable flag inspection |
| `configDirEnvVar` | `CONFIG_DIR` |
| `envNameEnvVar` | `CONFIG_ENV` |
| `fileBaseName` | `config` |
| `fileFormat` | `yaml`; exported `ConfigFileFormat` is `yaml` or `toml`; affects discovery only |
| `schema` | Optional `ConfigSchema<T>` synchronous `safeParse` contract; Zod schemas implement it. Absent means no schema validation |
| `env` | `process.env`; supplied map replaces it for discovery/overrides, but placeholders retain per-key process fallback |
| `envOverrideObjectVar` | `CONFIG` |
| `envOverridePrefix` | `CONFIG_` |
| `strictFiles` | `false`; require explicit files and valid `--config` arguments |
| `inheritProcessEnv` | `true`; set false to disable implicit process fallback; omitted `env` then means an empty map |
| `strictGetters` | `false`; finite numeric input, true/false booleans and dense string arrays |
| `strictPaths` | `false`; reject empty segments and noncanonical array indices |
| `safeErrors` | `false`; throw fixed-message `ConfigError` codes without original causes |
| `immutable` | `false`; reader/service factories copy supported data into deeply frozen snapshots after schema processing; object-only loaders ignore this reader option |
| `cache` | `true`; false bypasses service reuse in `createConfigServiceFromFiles` |

By default, missing automatically discovered files and missing explicitly selected
files are skipped. Strict-file mode still permits absent discovery layers.
Default parse/read failures are wrapped with `Failed to load config file <path>:`
and retain their cause. Schema failures throw `Invalid configuration:` followed
by issue paths/messages (`<root>` for root issues). Errors are thrown, not logged.
Environment reads use own entries only. Inherited JavaScript properties do not
satisfy placeholders, `$env` directives or custom control-variable names; explicit
entries with those names are supported. See [environment](environment.md).

Service reuse is partitioned by schema object identity, resolved discovery and
override options, environment source (`process.env` versus a plain supplied map),
and environment snapshots (including process placeholder fallback).
Lookup snapshots include non-enumerable own entries. Path override enumeration
remains enumerable and ordered. Windows supplied-map calls also fingerprint the
process environment separately to retain differently cased fallback values.
Different schemas always validate independently. Identical calls can
reuse a service; changed file contents alone still do not trigger reloading.
Selected directory/name/whole-object controls and NODE_ENV do not become path
overrides. See [loading](loading.md) for exact filtering and cache semantics.

## Classes and getters

`new ConfigLoader({ env?, inheritProcessEnv?, safeErrors? }?)` exposes `loadYamlConfig(filePath)`, returning a
resolved mapping. A missing file, empty file or null YAML root returns `{}`.
Comment-only sources and empty plain YAML documents also return `{}`.
An array/scalar root or root directive resolving to one throws. Each loader owns
its include cache. `loadTomlConfig(filePath)` explicitly parses TOML and rejects
null/scalar/array roots; empty/comment-only files return `{}`.
`loadConfigFile(filePath)` selects TOML for a case-insensitive `.toml` extension,
otherwise preserves YAML parsing. All methods return `{}` for missing paths and
apply loader environment/error options. See [TOML](toml.md) and [directives](directives.md).

`new ConfigReader(data, options?)` accepts an acyclic object and reader options.
`reader.withOptions(options)` creates a reader over the same data with merged
options and independent caches, snapshotting when `immutable` is enabled.
`new ConfigService(reader)` wraps a
reader and delegates all methods below. Both use dotted paths with numeric array
segments. `ConfigService` is container-independent and has no DI decorators.
Traversal reads own properties only, including array indices. Inherited names
such as `constructor` and `toString` are missing unless explicitly supplied as
configuration data. Explicit `__proto__` keys are stored as ordinary own data;
loading, merging and override assignment do not invoke prototype setters.

| Method | Contract |
| --- | --- |
| `has(key)` | False for undefined/missing/null; true otherwise |
| `keys()` | Copy of the construction-time dotted-key index, including parent objects and arrays; no array element enumeration |
| `keyPaths()` | Defensive copies of literal segment arrays for the same indexed entries and order; dotted names remain unambiguous |
| `get<T>(key)` | Value asserted as `T`; missing/null throws `Missing config key: <key>` |
| `getOptional<T>(key)` | Undefined for missing/null; otherwise asserted value |
| `getString(key)` | Requires an actual string |
| `getOptionalString(key)` | Undefined for missing/null/wrong type |
| `getNumber(key)` | Number as-is, otherwise JavaScript `Number(value)`; throws for NaN conversion |
| `getOptionalNumber(key)` | Undefined for missing/null/NaN conversion |
| `getBoolean(key)` | Boolean, or case-insensitive strings `true/1/yes/on` and `false/0/no/off`; no whitespace trimming |
| `getOptionalBoolean(key)` | Undefined for missing/null/invalid boolean |
| `getStringArray(key)` | Requires an array containing only strings |
| `getOptionalStringArray(key)` | Undefined for missing/null/wrong type |

Readers cache values and missing results and capture their key index at
construction. Mutating supplied or returned data does not refresh these caches.
Create a new reader for changed data, or enable immutable snapshots to prevent
subsequent mutation.

Required typed getters throw `Config key '<key>' must be ...` on a mismatch.
Optional getters are intentionally permissive. Numeric conversion may itself
throw for unusual in-memory objects; it is not a finite-number validator.

## Exported types

`Config` describes reader/service methods. `ConfigValue` is the recursive
string/number/boolean/null/object/array union; `ConfigObject` is its object map.
`ConfigData` is the format-neutral open mapping returned by raw file loaders.
It retains an open index signature and can be augmented as an interface.
`LoadConfigOptions<T>` carries optional schema typing. `ConfigSchema<T>` describes
the synchronous safeParse result used by validation, preserving Zod output
inference across consumer minor versions. `ConfigPath` accepts dotted
strings or readonly literal string segments. `ConfigReaderOptions` and its alias
`ConfigOptions` contain getter/path/error and snapshot settings; `ConfigLoaderOptions` contains
environment/error settings. `ConfigErrorCode` is the safe error code union, and
`ConfigError` is its runtime error class. Getter string paths are
not checked against the schema at compile time; `get<T>` is an assertion, not
runtime validation. Validate untrusted values with a supplied schema.

Merge/env helper modules remain implementation modules, not additional package
export paths. Readers reject invalid roots and cyclic
own-property graphs. Schemas may transform scalar/array inputs into objects.
The getter table above describes the defaults. Numeric getters can convert an
empty string to zero and booleans to numbers; actual NaN/Infinity values are
returned as-is. Default string-array checks permit sparse holes. Enable strict
getters for the narrower rules below.

## Strict getters

`strictGetters: true` accepts only finite actual numbers or nonblank numeric
strings for numeric getters. JavaScript numeric string syntax such as `0x10` and
`1e2` remains valid. Booleans, arrays, objects, blank strings, NaN and infinities
are rejected. Boolean getters accept actual booleans or trimmed, case-insensitive
`true`/`false`; synonyms such as `yes`, `on` and `1` are rejected. String-array
getters require dense arrays of strings. Required getters throw for mismatches;
optional getters return `undefined`. String and generic getters retain their
existing contracts. Default: `false`; placeholder boolean rules are independent.

## Paths and literal keys

Every getter, `has` and service delegate accepts `ConfigPath`: a dotted string or
a readonly array of literal string segments. `getString(['literal.name'])` reads
the exact dotted property; `getString('literal.name')` traverses two properties.
Segment arrays are copied for cache lookup, so later caller mutation does not
change earlier cached paths. Prototype properties remain inaccessible.

`strictPaths: true` rejects empty paths and empty segments, including leading,
trailing or doubled dots. Array indices must use canonical nonnegative decimal
integers (`0`, `1`, etc.); `00`, `+0`, `0e0` and negative indices throw. A valid
out-of-bounds index remains missing. Literal segment arrays may contain dots.
Default: `false`; legacy dotted strings ignore empty segments and use numeric
coercion for array indices. Empty segment arrays select the root by default.
`keys()` still returns dotted strings and may be ambiguous for literal dotted
keys. `keyPaths()` returns the corresponding literal segment arrays in the same
depth-first index order, including parent objects and array-valued keys. Arrays
are leaves; elements are not enumerated. Both the outer array and its segment
arrays are defensive copies. Empty property names remain explicit segments, even
where legacy dotted `keys()` strings collapse them. Use segment arrays for
unambiguous reads; `strictPaths` still rejects empty property segments.

## Safe errors

`safeErrors: true` on loaders/readers/factories throws exported `ConfigError`
instances with stable `code`, fixed `message`, and no original `cause`, issue
array, parser snippet, configuration key/path or value. Default: `false`, keeping
detailed diagnostics. Existing `ConfigError` instances propagate unchanged.

| Code | Message |
| --- | --- |
| `CONFIG_LOAD_FAILED` | Unable to load configuration. |
| `CONFIG_FILE_LOAD_FAILED` | Unable to load configuration file. |
| `CONFIG_VALIDATION_FAILED` | Invalid configuration. |
| `CONFIG_INPUT_INVALID` | Invalid configuration input. |
| `CONFIG_PATH_INVALID` | Invalid configuration path. |
| `CONFIG_KEY_MISSING` | Missing configuration key. |
| `CONFIG_VALUE_INVALID` | Invalid configuration value. |

Ordinary JavaScript stacks still identify library/caller source locations. Safe
errors do not sanitize values returned successfully or logs/side effects inside
caller-supplied schemas/getters. The filesystem directives remain trusted local
configuration features, not a sandbox. `ConfigErrorCode` is the exported code
union. Optional wrong-type getters retain their `undefined` behavior.

## Immutable snapshots

`immutable: true` on readers or reader/service factories creates a detached,
deeply frozen snapshot after schema validation/transformation. Default: `false`;
existing reference sharing and mutability stay unchanged. Changes to the caller's
original objects cannot alter the snapshot, and writes to returned objects or
arrays throw in ESM. This is runtime immutability; the existing getter return
types are unchanged. See the [runnable example](../examples/10-snapshots/README.md).

Snapshots accept acyclic plain objects (ordinary or null prototype), ordinary
arrays, strings, numbers (including NaN/Infinity), booleans, null and undefined.
They preserve shared references inside the copied graph, sparse array holes,
array length, special keys, symbol-keyed data properties and non-enumerability.
All copied data properties become nonwritable/nonconfigurable through freezing.
Original objects are never frozen. Copying, validation and freezing use iterative
traversal so deep supported graphs do not overflow this implementation's stack.

Accessors are rejected without invoking them. Functions, symbol/bigint values,
class instances, Date, Map, Set, typed arrays and custom object/array prototypes
are rejected instead of silently changing their semantics or leaving mutable
internals. `safeErrors` maps snapshot input failures to `CONFIG_INPUT_INVALID`.
Caller-supplied schemas/proxies can still execute their own code; this is not a
sandbox. Schemas may transform supported or other inputs into supported plain
data, subject to the pre-schema cycle/accessor checks.

`withOptions({ immutable: true })` snapshots an existing reader's current data;
this does not reconstruct earlier state lost through caller mutation. Other
options retain immutable mode unless overridden. Turning it off on an existing
immutable reader does not thaw its frozen data. File-service cache identity
includes the flag; mutable and immutable calls never share a service. Repeated
identical immutable calls still reuse a service; `cache: false` explicitly reloads.
The raw-layer and validated-object-only loaders do not create reader snapshots,
so `immutable` has no effect on their results.

## In-memory inputs and option placement

Readers require an object root and acyclic own-property graphs. Factories reject
cycles before schema execution and validate the resulting root after schema
transformation. A schema may still transform a scalar/array input into an object.
The iterative guard handles deep objects and permits shared acyclic references.
Without immutable mode, input validation does not freeze or clone mutable
references. Neither mode sandboxes arbitrary proxies or user schema execution.

Use `new ConfigReader(data, options)`, `createConfig(data, schema?, options?)` or
`createConfigService(dataOrReader, schema?, options?)` for reader options
(`strictGetters`, `strictPaths`, `safeErrors`, `immutable`). With an existing reader, explicit
options create a new reader over the same data, preserving the original reader;
without options the original reader is reused. `reader.withOptions(options)`
creates such a reader with existing options plus supplied overrides.
`ConfigOptions` aliases `ConfigReaderOptions`. `ConfigLoaderOptions` contains
`env`, `inheritProcessEnv` and `safeErrors`. `LoadConfigOptions` combines loading
and reader options. DI continues to construct `ConfigService` from one reader.
