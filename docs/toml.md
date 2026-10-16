# TOML configuration

TOML is an alternative file syntax for the same synchronous loading, merging,
environment, schema, reader and service pipeline. Existing YAML applications do
not need to change.

## Discovery and explicit files

```js
import { createConfigFromFiles } from '@gaia-framework/config';

const reader = createConfigFromFiles({
  fileFormat: 'toml',
  envName: 'production',
  argv: []
});
```

This selects `config.toml`, `config.production.toml`, `config.local.toml`, then
`config.production.local.toml`. Later layers win. YAML files in the same directory
are not discovered in this mode. Omit `fileFormat` for the existing YAML defaults.
The usual directory, environment and filename-prefix options still apply.
Do not put an extension in `fileBaseName`.

Repeated `--config` arguments replace discovery. For example,
`node app.ts --config base.yaml --config deployment.toml` merges YAML then TOML.
Each explicit `.toml` extension selects TOML, regardless of `fileFormat`; other
explicit filenames retain legacy YAML parsing. Extensions are case-insensitive.
There is no new top-level JSON parser or JSON discovery.

`ConfigLoader.loadConfigFile(path)` uses the same dispatch. `loadTomlConfig(path)`
always parses TOML; `loadYamlConfig(path)` always parses YAML. Missing paths return
`{}` under these direct methods. Factory strict-file rules are unchanged.

## Tables, arrays and strings

```toml
port = "${APP_PORT:-4400}"
enabled = "${APP_ENABLED:-true}"
literal = "$${APP_NAME}"

[routing."route.v1"]
endpoint = 'https://destination.example.test'
methods = ["GET", "POST"]

[[workers]]
name = "synthetic-worker"
```

Table headers replace YAML indentation. Keys after a table header belong to that
table until another header: put root settings before table headers. Quote keys
containing literal dots. A reader can access them with segment arrays, such as
`['routing', 'route.v1', 'endpoint']`.

Objects deep-merge and arrays replace, including arrays of tables. TOML basic,
literal and multiline strings all undergo library placeholder substitution after
parsing. Single quotes prevent TOML backslash decoding, not library substitution.
Use `$${NAME}` to retain literal `${NAME}`. Boolean fallbacks retain the existing
strict true/false coercion; numeric placeholders remain strings until a getter or
schema converts them. Multiline strings follow TOML newline/escape rules.

TOML 1.1 inline tables may span lines and have trailing commas. Duplicate keys,
conflicting table definitions and malformed values throw; separate files may
override each other through the ordinary layer merge.

## Directives and null clearing

```toml
secret = { "$env" = "APP_KEY" }
certificate = { "$file" = "./certificate.pem" }
providers = { "$include" = "./providers.toml#providers.0" }
other = { "$include" = "./settings.yaml" }
cleared = { "$null" = true }
```

The three existing directives use quoted keys and retain all existing behavior.
Includes can traverse TOML, YAML and JSON in either direction. Each relative path
uses the file containing that directive. Cycle detection, fragments and per-loader
include reuse work across formats. `$file` remains verbatim text loading.

TOML has no native null. This library reserves an object containing exactly one
`$null` key with boolean `true` as a TOML-only extension. It becomes null before
merging, so it clears an inherited value. It also works in arrays and table form.
False, strings, numbers and other arguments throw; placeholders are not evaluated
as null-marker arguments. An object with additional keys remains ordinary data.
Omitting a local key inherits its base value; it does not clear it.

YAML/JSON objects containing `$null` keep their existing ordinary-data meaning,
including when included from TOML. Overrides are applied after file resolution,
so JSON null in `CONFIG`/path overrides still clears normally; directive-shaped
override objects are not resolved. A null marker cannot be the main file root.

## Types, errors and limits

- Native date/time literals are rejected with instructions to quote them. Quoted
  dates retain their exact spelling, offset and precision as strings. No native
  Date, Temporal or parser-specific date objects reach the reader.
- Integers within JavaScript's safe range become numbers. Larger integer values
  throw instead of rounding: write exact identifiers as quoted strings. Numeric
  bases and separators are supported. Float literals follow JavaScript binary64
  semantics, including `inf`, `-inf` and `nan`; strict getters/schemas may reject
  them under their existing rules.
- Files must decode as valid UTF-8. Empty, comment-only and UTF-8 BOM-prefixed
  documents are accepted. An empty TOML include resolves to `{}`.
- Inline containers are bounded by the parser's maximum depth of 100. A separate
  check rejects parsed object/array containers deeper than 100 below the root,
  including dotted keys and table headers. Scalar leaves do not add a container.
  These checks apply per document; includes can compose deeper resulting graphs.
- The main root must resolve to an object. Root directives resolving to strings,
  arrays or null throw. Missing/read/parse errors retain existing factory wrapping
  and causes; `safeErrors: true` replaces them with fixed messages/codes.
- YAML anchors/tags are YAML syntax and are not TOML features. Use tables or
  includes for TOML composition. Text layout, comments and key enumeration order
  are not promised identical between differently authored YAML/TOML documents.

The parser is pinned to `smol-toml@1.9.1`; its date objects are deliberately
rejected and unsafe integers normalized to errors. See its
[upstream documentation](https://github.com/squirrelchat/smol-toml) and the
[TOML specification](https://toml.io/en/v1.1.0).

## Examples and verification

- [Complete TOML pipeline](../examples/13-toml/README.md)
- [Layered service TOML](../examples/14-toml-service/README.md)
- [Modular pipelines TOML](../examples/15-toml-pipelines/README.md)
- [Generated large configuration](../examples/16-large-configuration/README.md)
- [Contributor testing](../CONTRIBUTING.md#testing)
- [Measurement methodology](benchmarking.md)

Paired synthetic YAML/TOML cases verify resolved/validated values and getters.
They run without application services. Deployment and application integration
remain separate acceptance work.
