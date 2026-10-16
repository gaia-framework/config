# Benchmarking

The reusable harness measures synthetic configurations without application
repositories, services, credentials or implicit process environment dependencies.
Run from a development checkout with Node 24 and the pinned Yarn runtime:

```sh
yarn benchmark
yarn benchmark --case=includes-10000
yarn benchmark:toml
yarn benchmark:traversals
yarn benchmark:smoke
```

## Scenarios and phases

The YAML suite covers small/large documents, strings, arrays, nesting, four layers,
overrides, directives, include fan-out, trees, chains and repeated references.
Measurements separate source-file reads/parsing, complete loading, schema
validation, reader/snapshot construction, uncached service startup, cache hits,
getters and key enumeration. Assertions check outputs, cache identity, freezing,
physical read counts and sample counts outside timed operations.

The TOML suite compares equivalent YAML/TOML small and application-shaped
configurations, 10,000/100,000 settings, nesting, include fan-out and repeated
includes. It records separate module-import time, complete loading, schema/service
startup and cache hits. See [TOML behavior](toml.md) for type/format differences.

Traversal profiling separates graph guards, schema passes, snapshot copying,
indexing and complete reader/factory construction. These independently measured
phases are not additive: allocation, JIT and GC context differ from whole startup.

## Generated output

Reports belong in ignored artifacts directories, never in source or npm archives:

- YAML: artifacts/benchmarks, with timestamped full runs and a smoke subdirectory.
- TOML: artifacts/toml-benchmarks/full or smoke.
- Traversal profiles: artifacts/traversals.

Outputs include JSON observations/environment metadata and Markdown tables;
the YAML suite also produces phase/file CSV tables. Statistics include arithmetic
mean, median, min/max, nearest-rank p95, spread and sample count. Retain raw
observations with the table when sharing a result. CI uploads smoke measurements,
test/coverage reports and package acceptance as workflow artifacts.

Do not commit per-machine JSON/Markdown results. Keep reusable fixtures, commands
and interpretation guidance here. A future curated release comparison should
identify exact versions, hardware, settings and supported behavior.

## Comparing a baseline

Supply an independently compiled baseline library; do not change the working
library or benchmark fixtures to produce a favorable comparison:

```sh
node scripts/benchmark-compare.ts --baseline=/absolute/path/to/baseline/dist/src/index.js --cases=single-1000,includes-1000
node scripts/benchmark-toml.ts --baseline=/absolute/path/to/baseline/dist/src/index.js
```

The YAML comparison uses the same generated workload and worker for each library.
The TOML comparison adds baseline YAML rows to the candidate YAML/TOML results.
Launch order alternates by scenario. Record the baseline commit and candidate
commit/working-tree state beside the generated reports.

## Limits and interpretation

Fixtures use owned temporary directories and are removed after measurement.
Workers are sequential. The YAML suite bounds worker heaps to 2 GiB (256 MiB for
smoke) and uses a four-minute timeout; TOML workers use 1 GiB and a one-minute
timeout. Available memory checks and failures are reported; services are not
stopped to make benchmark room. Heap limits do not cap total process memory.

Normal workloads use seven samples after warmup; the largest use three. Smoke
samples verify the harness, not performance. With small sample counts, nearest-
rank p95 can be the maximum rather than an estimated production tail. Never use
machine-dependent timing thresholds as CI pass/fail criteria.

File caches are not flushed; reads can use warm OS caches. Operation timings
exclude fixture generation, output assertions and explicit pre-sample collection,
but include allocations/GC occurring during the measured operation. Import time
is excluded from operation timings and separately reported in the TOML suite.
Peak RSS covers a whole worker; net heap deltas can be negative and do not measure
retained library memory or leaks. Independent phases should not be summed.

Results depend on workload, hardware, runtime, scheduling and filesystem behavior.
They do not guarantee application startup time, concurrency, provider/database
latency or universal superiority over another format/library. Record failures and
resource limits instead of dropping difficult cases from a comparison.
