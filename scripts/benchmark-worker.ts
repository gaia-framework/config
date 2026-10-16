import type { FixtureManifest, WorkerResult, SourceTimings } from './benchmark-types.ts';
import type { ConfigReader as Reader } from '../src/index.js';
import type * as ConfigLibrary from '../src/index.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import { schemaFor } from './benchmark-fixtures.ts';

const [manifestPath, phase, output, libraryPath] = process.argv.slice(2);
assert.ok(manifestPath && phase && output, 'Supply manifest, phase and output paths.');
const collectGarbage = global.gc;
assert.ok(collectGarbage, 'Run benchmark workers with --expose-gc.');

const {
  ConfigLoader,
  ConfigReader,
  createConfigServiceFromFiles,
  resetConfigServiceCacheForTests
}: typeof ConfigLibrary = await import(
  libraryPath
    ? pathToFileURL(path.resolve(libraryPath)).href
    : new URL('../dist/src/index.js', import.meta.url).href
);
const spec = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FixtureManifest;
const schema = schemaFor(spec);
const root = path.join(spec.directory, 'config.yaml');
const options = {
  basePath: spec.directory,
  envName: 'benchmark',
  argv: spec.argv,
  env: spec.env,
  inheritProcessEnv: false,
  strictFiles: true,
  schema,
  cache: false
};
const loaderOptions = { env: spec.env, inheritProcessEnv: false };
const result: WorkerResult & { samples: number[]; batch: number } = {
  id: spec.id,
  phase,
  samples: [],
  firstMs: null,
  batch: 1
};

process.on('uncaughtException', (error) => {
  fs.writeFileSync(
    output,
    JSON.stringify({
      id: spec.id,
      phase,
      failed: true,
      error: `${error.name}: ${'reason' in error ? error.reason : error.message}`
    })
  );
  process.exitCode = 1;
});

function expectedPort(parts: string[], pipeline = false) {
  if (pipeline && spec.kind === 'overrides') {
    return 5000;
  }

  if (pipeline && spec.kind === 'layers' && parts.includes('svc000000')) {
    return 9090;
  }

  return 4080;
}

function verifyReader(reader: Pick<Reader, 'getNumber'>, pipeline = false) {
  for (const parts of [spec.lookupPaths[0]!, spec.lookupPaths.at(-1)!]) {
    assert.equal(reader.getNumber(parts), expectedPort(parts, pipeline));
  }
}

function verifyData(data: any, pipeline = false) {
  for (const parts of [spec.lookupPaths[0]!, spec.lookupPaths.at(-1)!]) {
    let value = data;

    for (const part of parts) {
      value = value[part];
    }

    assert.equal(Number(value), expectedPort(parts, pipeline));
  }
}

function freshData() {
  return new ConfigLoader(loaderOptions).loadYamlConfig(root);
}

function measure<T>(operation: () => T, verify: (value: T) => void, setup: () => void = () => {}) {
  function run(timed: boolean) {
    collectGarbage!();
    setup();
    const start = performance.now();
    const value = operation();
    const elapsed = (performance.now() - start) / result.batch;
    verify(value);

    if (timed) {
      result.samples.push(elapsed);
    }

    return elapsed;
  }

  result.firstMs = run(false);

  for (let index = 0; index < spec.warmups; index++) {
    run(false);
  }

  for (let index = 0; index < spec.samples; index++) {
    run(true);
  }
}

if (phase === 'source-files') {
  const rows: SourceTimings[] = spec.files.map((file) => ({ ...file, read: [], parse: [] }));

  for (let iteration = -spec.warmups - 1; iteration < spec.samples; iteration++) {
    collectGarbage();
    let total = 0;

    for (const file of rows) {
      const start = performance.now();
      const text = fs.readFileSync(path.join(spec.directory, file.name), 'utf8');
      const readMs = performance.now() - start;
      const parseStart = performance.now();
      const parsed =
        file.format === 'yaml'
          ? yaml.load(text, { schema: yaml.JSON_SCHEMA })
          : file.format === 'json'
            ? JSON.parse(text)
            : text;
      const parseMs = performance.now() - parseStart;
      assert.ok(parsed !== undefined);
      total += readMs + parseMs;

      if (iteration >= 0) {
        file.read.push(readMs);
        file.parse.push(parseMs);
      }
    }

    if (result.firstMs === null) {
      result.firstMs = total;
    }

    if (iteration >= 0) {
      result.samples.push(total);
    }
  }

  result.files = rows;
} else if (phase === 'load') {
  measure(freshData, (data) => verifyData(data));
  const original = fs.readFileSync;
  let reads = 0;
  const instrumented = (
    ...args: Parameters<typeof fs.readFileSync>
  ): ReturnType<typeof fs.readFileSync> => {
    reads++;

    return Reflect.apply(original, fs, args);
  };

  fs.readFileSync = instrumented as typeof fs.readFileSync;

  try {
    verifyData(freshData());
  } finally {
    fs.readFileSync = original;
  }

  assert.equal(reads, spec.expectedReads);
  result.fileReads = reads;
} else if (phase === 'startup' || phase === 'immutable-startup') {
  measure(
    () => createConfigServiceFromFiles({ ...options, immutable: phase === 'immutable-startup' }),
    (reader) => {
      verifyReader(reader, true);
      assert.equal(Object.isFrozen(reader.get('')), phase === 'immutable-startup');
    }
  );
} else if (phase === 'cache-miss') {
  process.env.NODE_ENV = 'test';
  measure(
    () => createConfigServiceFromFiles({ ...options, cache: true }),
    (reader) => verifyReader(reader, true),
    () => resetConfigServiceCacheForTests()
  );
} else if (phase === 'cache-hit') {
  const cached = createConfigServiceFromFiles({ ...options, cache: true });
  verifyReader(cached, true);
  result.batch = 1000;
  measure(
    () => {
      let last;

      for (let index = 0; index < result.batch; index++) {
        last = createConfigServiceFromFiles({ ...options, cache: true });
      }

      return last;
    },
    (value) => assert.equal(value, cached)
  );
} else {
  const data = freshData();
  verifyData(data);

  if (phase === 'schema') {
    measure(
      () => schema.parse(data),
      (value) => verifyData(value)
    );
  } else if (phase === 'reader' || phase === 'immutable-reader') {
    measure(
      () => new ConfigReader(data, { immutable: phase === 'immutable-reader' }),
      (reader) => verifyReader(reader)
    );
    collectGarbage();
    const before = process.memoryUsage().heapUsed;
    const retained = new ConfigReader(data, { immutable: phase === 'immutable-reader' });
    collectGarbage();
    result.retainedReaderHeapMiB = (process.memoryUsage().heapUsed - before) / 2 ** 20;
    verifyReader(retained);
  } else {
    let reader = new ConfigReader(data);
    verifyReader(reader);

    if (phase === 'keys' || phase === 'key-paths') {
      const count = reader.keys().length;
      result.indexedKeys = count;
      measure(
        () => (phase === 'keys' ? reader.keys() : reader.keyPaths()),
        (value) => assert.equal(value.length, count)
      );
    } else if (['get-cold', 'get-hot', 'get-hot-segments'].includes(phase)) {
      const paths =
        phase === 'get-hot-segments'
          ? spec.lookupPaths
          : spec.lookupPaths.map((parts) => parts.join('.'));
      result.batch = phase === 'get-cold' ? paths.length : 10000;

      if (phase !== 'get-cold') {
        for (const parts of paths) {
          reader.getNumber(parts);
        }
      }

      measure(
        () => {
          let checksum = 0;

          for (let index = 0; index < result.batch; index++) {
            checksum += reader.getNumber(paths[index % paths.length]!);
          }

          return checksum;
        },
        (value) => assert.equal(value, result.batch * 4080),
        () => {
          if (phase === 'get-cold') {
            reader = new ConfigReader(data);
          }
        }
      );
    } else {
      throw new Error(`Unknown benchmark phase: ${phase}`);
    }
  }
}

result.peakRssMiB = process.resourceUsage().maxRSS / 1024;
fs.writeFileSync(output, JSON.stringify(result));
