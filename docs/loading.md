# File loading and merging

From `basePath`, files merge in this order (later wins):

```text
config.yaml
config.{environment}.yaml
config.local.yaml
config.{environment}.local.yaml
```

Use `fileBaseName: 'settings'` to change the prefix. Discovery defaults to YAML.
Select `fileFormat: 'toml'` to replace `.yaml` with `.toml` in all four layers.
Formats are never automatically combined or detected; unsupported runtime format
values throw, including when explicit files are supplied. There is no `.yml` or
JSON discovery. See [TOML](toml.md). JSON syntax
inside YAML files is accepted by the YAML parser; that is not separate JSON
discovery or a strict top-level JSON parser.

`basePath` overrides `CONFIG_DIR`, which overrides the current working directory.
Environment selection is `envName`, `CONFIG_ENV`, `NODE_ENV`, `development`.
Pass an explicit `env` map to change the source for these environment reads.

## Explicit files

```js
loadConfigObjectFromFiles({
  basePath: '/path/to/configuration',
  argv: ['--config', 'base.yaml', '--config', 'deployment.yaml'],
  env: {}
});
```

One or more `--config <path>` pairs replace automatic discovery entirely. Relative
paths resolve against `basePath`; absolute paths are retained. Files merge in
argument order. Each `.toml` file uses TOML parsing (case-insensitive extension);
other selected filenames retain legacy YAML parsing. The discovery `fileFormat`
does not override explicit-file parsing, so mixed explicit files work. A missing selected file is skipped, not rejected. A trailing
`--config` without a following value is ignored. There is no `--config=file`
parser or network loading.

`strictFiles: true` on file factories rejects a missing explicitly selected file
and a `--config` with no path, an empty path, or another `--flag` in place of its
argument. Prefix flag-like filenames with `./` or use absolute paths. Repeated
files still merge in argument order. Automatically discovered layers remain
optional. Default: `false`, retaining skipped missing files and trailing flags.

## Merge contract

Objects merge recursively. Arrays and scalar values replace earlier values.
`null` explicitly clears; `undefined` does not override. Neither objects nor arrays
are promised deep clones: unchanged nested objects and replacement arrays can
remain shared references. Treat loaded values as immutable after construction.
Only own mapping properties participate in merges. Explicit special names such
as `__proto__` remain ordinary data keys and do not change output prototypes.

After files, the whole-object `CONFIG` override merges, followed by `CONFIG_*`
path overrides. Schema validation runs last if supplied. Raw-layer loading stops
before validation. No remote lookups, watching, live reload or implicit writes
occur. Missing files are rechecked on each uncached load, but cached services do
not reload changes. See [caching and fresh reads](#caching-and-fresh-reads).

The selected directory, environment-name and whole-object control variables are
excluded from per-path override enumeration, even when they match its prefix.
The `NODE_ENV` fallback is also excluded. Thus `CONFIG_DIR` and `CONFIG_ENV` select
files without creating `DIR`/`ENV` properties. The same rule applies to custom
environment naming options. Control-name comparison follows Windows
`process.env` case-insensitivity, with exact matching on other platforms and for
ordinary supplied maps. Prefix/suffix case rules are unchanged. Explicit
file/object `DIR`/`ENV` keys and similarly named data paths remain valid. Names
not selected as controls remain ordinary overrides.

## Caching and fresh reads

Service cache reuse requires the same schema object (or no schema), discovery
inputs (including normalized file format), selected control/override names, environment source and environment fingerprint. The
fingerprint includes the override map and effective process fallback for file
placeholders/directives. It snapshots values, so mutating a supplied environment
map or changing process fallback values cannot reuse a stale service. Override
enumeration order is preserved because conflicting ancestor/descendant paths can
depend on it. Values are hashed rather than stored in plaintext cache keys.
Equivalent explicit default options reuse entries; a new schema instance has its
own cache. This is cache isolation, not automatic reload of file contents.
`cache: false` on the service factory explicitly bypasses reuse and reads fresh
files/includes. Reader and error options participate in cached service identity.
With `inheritProcessEnv: false`, snapshots omit implicit process fallback.
Non-enumerable own environment values participate in lookup snapshots; changing
enumerability can also change path override participation. On Windows, supplied
maps additionally fingerprint the process environment because differently cased
fallback reads may still consume it. Consequently, process changes may select a
new service even when an exact-case map entry masks that particular variable.

The process environment and an ordinary supplied map use separate cache entries,
even when their enumerated names and values match. Windows process lookups and
control exclusion ignore case; a plain map does not. Omitting `env` and passing
`env: process.env` reuse the same process entry. Copies of an equivalent plain
map can reuse its map entry. A prior process entry cannot bypass map validation.

Service entries do not track file contents, modification times, or mutable state
captured by schema closures. Treat schemas as stable objects. Failed loading or
validation is never cached. The exported cache-reset function is test-only;
there is no production reset or watch API.

`cache: false` on `createConfigServiceFromFiles` bypasses global service reuse and
creates fresh loaders, include caches and readers on every call. This explicitly
reloads current files and reevaluates schemas. Default: `true`. Other file
factories already read fresh files; the option has no additional effect on them.

```js
import { createConfigServiceFromFiles } from '@gaia-framework/config';

const service = createConfigServiceFromFiles({
  basePath: './configuration',
  argv: [],
  cache: false
});
```

A loader caches resolved includes for its lifetime. Construct a new loader for
fresh includes. Readers cache values, missing results and their construction-time
key index; construct a new reader to refresh data. See [directives](directives.md)
and [immutable snapshots](api.md#immutable-snapshots).

## YAML parsing

Empty files, comment-only documents and null YAML roots load as empty mappings.
Scalar and array roots are rejected. Shared aliases are supported; recursive
aliases are rejected. Mapping keys that collide with inherited properties remain
ordinary own data, including `__proto__`.

YAML nesting is limited to 100 by the parser, including mapping and sequence
containers. There is no public depth override. This limit applies per document;
includes can compose a deeper result. See [TOML](toml.md#types-errors-and-limits)
for its corresponding type and depth rules.
