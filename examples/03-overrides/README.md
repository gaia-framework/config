# 03-overrides

From the repository root:

```sh
cd examples/03-overrides
node index.ts
```

Expected output:

```json
{"port":4002,"enabled":true,"my-provider":{"under_score":"demo"}}
```

The command uses this directory as its working directory. Fixture paths resolve relative to their containing configuration file. See [all examples](../README.md) and the [API](../../docs/api.md).
