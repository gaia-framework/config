# Immutable snapshots, literal paths and include aliases

Build at the repository root with `yarn build`, then run from this directory:

```sh
cd examples/10-snapshots
node index.ts
```

Expected output:

```json
{"paths":[["service"],["service","port"],["literal.name"],["list"]],"literal":"synthetic","snapshotValue":"original","mutationRejected":true,"aliasCycleDetected":true}
```

`immutable: true` creates a detached, deeply frozen data snapshot. Mutating the
original input leaves the snapshot unchanged, and mutating returned data throws
in ESM. `keyPaths()` returns literal segments, so dotted names stay unambiguous.
Arrays are leaves, matching `keys()` enumeration.

The cycle fixture is copied into an owned temporary directory. A directory
symlink (junction on Windows) points back to it; canonical cycle detection
rejects the include. The directory is removed afterward. No fixture or source
repository is modified. See [snapshot details](../../docs/api.md#immutable-snapshots) and
[directive path rules](../../docs/directives.md).
