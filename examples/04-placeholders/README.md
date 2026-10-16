# 04-placeholders

From the repository root:

```sh
cd examples/04-placeholders
node index.ts
```

Expected output:

```json
{"name":"demo","fallback":"local","empty":"","enabled":true,"literal":"${EXAMPLE_NAME}","message":"hello demo"}
```

The command uses this directory as its working directory. Fixture paths resolve relative to their containing configuration file. See [all examples](../README.md) and the [API](../../docs/api.md).
