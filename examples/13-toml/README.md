# 13-toml example

This example uses Zod. With an installed package, run `yarn add zod` from your
application's root before running it. A repository development install already
provides Zod; it is not a runtime dependency of the library.

Run from this example directory after building the repository, or copy the entire
examples folder into an application with the package installed. Values are synthetic.

This demonstrates all four TOML layers, JSON object/path environment overrides,
placeholders, null clearing, TOML/YAML/JSON includes, text/environment directives,
schema defaults and actual automatic Inversify constructor injection.

```sh
node index.ts
```

Expected output:

```json
{"port":6500,"enabled":true,"clear":null,"label":"synthetic","text":"synthetic message","destination":"synthetic-output","defaulted":"schema-default"}
```

```sh
node index.ts --config config.toml --config explicit.yaml
```

Expected output:

```json
{"port":6500,"enabled":true,"clear":"inherited","label":"explicit","text":"synthetic message","destination":"synthetic-output","defaulted":"schema-default"}
```
