# Explicit hardening options

Build at the repository root with `yarn build`, then run from this directory:

```sh
cd examples/09-hardening
node index.ts
```

Expected output:

```json
{"port":4002,"literal":"value","label":"isolated","strictPathRejected":true}
```

The fixture uses only supplied environment values. Explicit files are required,
getters use strict conversions, empty path segments are rejected, and segment
arrays access literal dots. Safe errors carry a fixed code/message without the
original cause. `cache: false` creates a fresh service on each factory call.
All these settings are opt-in; see [reader options](../../docs/api.md#strict-getters) and
[environment isolation](../../docs/environment.md#environment-isolation).
