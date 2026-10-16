# 02-files

From the repository root:

```sh
cd examples/02-files
node index.ts
```

Expected output:

```json
{"port":4002,"name":"example"}
```

Explicit files replace automatic discovery:

```sh
node index.ts --config custom.yaml
```

Expected output:

```json
{"port":5000}
```

The command uses this directory as its working directory. Fixture paths resolve relative to their containing configuration file. See [all examples](../README.md) and the [API](../../docs/api.md).
