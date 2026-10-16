# Environment overrides and placeholders

## Overrides

`CONFIG` must contain a JSON object. Malformed JSON, null, arrays and primitives
throw; an unset or empty override is ignored. `CONFIG_*` values use `JSON.parse`
when possible, otherwise remain strings. Thus `true`, `42`, `null`, `[1,2]`, and
`{"key":"value"}` become their corresponding JavaScript values.

The suffix encoding is case-sensitive:

| Environment name | Configuration path |
| --- | --- |
| `CONFIG_http_port` | `http.port` |
| `CONFIG_under__score` | `under_score` |
| `CONFIG_my___provider_enabled` | `my-provider.enabled` |

A single underscore separates path segments, two encode a literal underscore,
three encode a hyphen. Dots in suffixes also separate path segments. An empty suffix is ignored. Paths can replace a non-object intermediate
value with an object. Conflicting path entries follow environment enumeration
order; avoid ancestor/descendant conflicts in the same override map.

File-loading factories skip their selected directory, environment-name and
whole-object control variables, plus `NODE_ENV`, during path-override enumeration.
This excludes controls such as `CONFIG_DIR` and `CONFIG_ENV` without deleting
explicit `DIR`/`ENV` configuration data. Custom control names are handled
the same way. Exclusion follows case-insensitive Windows `process.env` lookup;
on other platforms and for ordinary supplied maps, names match exactly.
Override prefixes and suffixes remain case-sensitive. All other matching
environment names remain normal overrides.

Override values are merged after directive resolution. They are not run through
placeholder/directive resolution themselves. Supply `envOverrideObjectVar` and
`envOverridePrefix` to use other names.

## Placeholders

```yaml
required: ${EXAMPLE_NAME}
fallback: ${EXAMPLE_NAME:-local}
empty: ${EXAMPLE_NAME:-}
quoted: ${EXAMPLE_NAME:-"local"}
literal: $${EXAMPLE_NAME}
message: hello ${EXAMPLE_NAME:-reader}
enabled: ${EXAMPLE_ENABLED:-false}
```

These rules apply to YAML and TOML string values and directive arguments.

Missing and empty environment values use a fallback, or throw when none exists.
Quoted fallbacks are normalized; `:-`, `:-""`, and `:-''` yield empty strings.
`$${...}` yields a literal placeholder. Substitution recurses through object and
array values, not object keys.
Escaping consumes `$${` openings directly, without reserving marker text inside
strings. Literal marker-shaped text remains intact in file values,
fallbacks, environment values and directive arguments. Inserted environment
values are returned verbatim; their contents are not scanned again for placeholders
or escape syntax.

The loader reuses parsed placeholder names and fallback metadata in a bounded
instance-local cache. It still reads environment values on each resolution;
missing values and errors are not cached. The internal admission limits are 256
expressions of at most 1,024 UTF-16 code units each. Longer expressions and new
expressions after saturation resolve normally without being cached. These limits
do not restrict configuration values or introduce new loading options.

A whole scalar placeholder whose fallback is `true` or `false` produces a boolean.
Its environment value must then also be `true` or `false`, case-insensitively with
whitespace trimmed. Mixed strings remain strings. Other values, including numeric
fallbacks and a placeholder with no boolean fallback, remain strings.
An invalid boolean error names the variable and expected type, without including
the supplied environment value, including when wrapped by file-loading factories.

Only own entries count as environment variables. Inherited names such as
`constructor`, `toString` and `__proto__` are missing unless explicitly supplied.
This rule also covers directory/environment selection, the whole-object override,
test-reset guards. Explicit special-name
entries remain valid; Windows `process.env` retains its case-insensitive lookup.
Non-enumerable own entries are valid for direct lookups and control variables;
`CONFIG_*` path override enumeration still visits enumerable entries only. Cache
snapshots account for both lookup values and override enumeration/order.

## Environment isolation

For placeholder and `$env` reads, a supplied `env` map has per-key precedence:
an undefined/missing key falls back to `process.env`; an empty string prevents
that fallback and counts as missing. File discovery and override enumeration use
the supplied map instead of the process map.

`inheritProcessEnv: false` on file factories or `ConfigLoader` disables implicit
process fallback for placeholders, mixed strings and directive arguments/values,
including included files. With no `env`, the effective map is empty, so discovery
and overrides do not read process variables either. An explicitly supplied `env`
still supplies its own entries, even if the caller deliberately passes
`process.env`. Default: `true`. Relative files still resolve against their source
and discovery still uses the working directory when no directory is supplied.

```js
import { createConfigFromFiles } from '@gaia-framework/config';

const reader = createConfigFromFiles({
  argv: [],
  env: { APP_PORT: '4400' },
  inheritProcessEnv: false
});
```

Importing the package does not load `.env` files. Applications own any dotenv
loading and can pass its resulting environment map explicitly.

## Error handling

All names/values in examples are synthetic. Configurations can contain sensitive
values; do not print entire configuration objects in an application. The boolean
error safeguard is not general error redaction: parser diagnostics and custom
schema messages may still contain input snippets.
Enable [`safeErrors: true`](api.md#safe-errors) for fixed-message errors without original causes or
parser/schema details; this does not sanitize successful return values or user
schema side effects.
