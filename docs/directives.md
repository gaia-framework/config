# Directives

The shared `$env`, `$file` and `$include` directives are objects with **exactly one key** and a string value:

```yaml
label: {$env: EXAMPLE_LABEL}
text: {$file: ./sample.txt}
service: {$include: ./parts/service.yml}
selection: {$include: "./parts/values.json#items.1"}
```

`$env` requires a non-empty environment value and returns a string. Its name can
itself contain placeholders. It follows the [environment precedence](environment.md).

`$file` reads the complete UTF-8 file verbatim, including trailing newlines. It does
not parse or interpolate the file contents. Paths can contain placeholders.

`$include` parses `.yaml`, `.yml`, `.json` or `.toml`, recursively resolving directives and
placeholders in the included value. Empty YAML includes resolve to undefined;
Comment-only sources and empty YAML documents also resolve to undefined. Explicit
quoted, tagged or block-style empty strings remain strings. JSON uses strict
`JSON.parse`. Other extensions throw. Include results may be
objects, arrays or scalars within a configuration; the final top-level config must
be a mapping (a literal null YAML root becomes an empty mapping; TOML null roots
are rejected). Empty TOML includes are `{}`. TOML-only values are normalized in
the included document, before shared directives; YAML/JSON objects containing
`$null` keep their ordinary meaning. See [TOML syntax and null clearing](toml.md).

Paths resolve relative to the **file containing the directive**, including nested
includes, not relative to the process working directory. Absolute paths work.
Missing files, invalid directive types and parse/read errors throw.

## Fragments and cycles

The optional `#` fragment uses dot-separated object properties and numeric array
segments, such as `#service.host` and `#items.0`. Missing properties, out-of-range,
negative/noninteger array indexes, and traversal through a scalar throw. There is
no JSON Pointer or escaped-dot fragment syntax. An empty fragment selects the
whole value. Missing/undefined fragments fail rather than silently returning null.

Direct and indirect include cycles are detected using canonical filesystem paths
(`realpath`), including directory symlinks and Windows junctions. The active
identity stack is separate from the paths used for relative resolution and error
chains. A symlink alias cannot hide an active include cycle.
Recursive YAML aliases in objects or arrays throw `Config value cycle detected:`
with the source filename. Shared aliases without a cycle remain supported.
Canonical identity is used for cycle checks only. Relative includes and `$file`
continue to resolve from the spelling of the containing source path, including
`..` across symlinked directories. Include-cache keys also retain that path
spelling: aliases may have different relative-resolution contexts, so they are
not collapsed into one cached result. Hard-link aliases are not canonicalized
into inode identities. Use configuration files you trust; directives can read
files accessible to Node.

Repeated includes are cached per `ConfigLoader` instance, including resolved
environment values. Reusing an instance after changing a file/environment can
return earlier data. A new loader has a fresh include cache. Factory loading
creates a loader for each top-level file; it does not share one include cache
across all file layers.

An object with extra keys is ordinary data, even if one key resembles a directive.
Unknown keys such as `$unknown` are ordinary data. Directives are not resolved in
environment override objects, which are applied after file loading.
