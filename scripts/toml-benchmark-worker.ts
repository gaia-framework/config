import type { TomlFixture, TomlScenario, TomlWorkerResult } from './benchmark-types.ts';
import type * as ConfigLibrary from '../src/index.js';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const [manifest, library, output] = process.argv.slice(2);
assert.ok(manifest && library && output, 'Supply fixture, library and output paths.');
const collectGarbage = global.gc;
assert.ok(collectGarbage, 'Run benchmark workers with --expose-gc.');
const fixture = JSON.parse(readFileSync(manifest, 'utf8')) as TomlFixture &
  Pick<TomlScenario, 'kind'> & { warmups: number; samples: number };
const importStart = performance.now();
const { loadConfigLayersFromFiles, createConfigServiceFromFiles }: typeof ConfigLibrary =
  await import(pathToFileURL(library).href);
const importMs = performance.now() - importStart;
const options = {
  basePath: fixture.directory,
  fileFormat: fixture.format,
  envName: 'benchmark',
  argv: [],
  env: {},
  inheritProcessEnv: false,
  schema:
    fixture.kind === 'settings'
      ? z.object({ settings: z.record(z.string(), z.number()) })
      : fixture.kind === 'layers'
        ? z.object({
            port: z.coerce.number(),
            database: z.object({ provider: z.string() }),
            queues: z.object({ driver: z.string() }),
            ai: z.object({
              llm: z.object({
                providers: z.record(
                  z.string(),
                  z.object({
                    enabled: z.boolean(),
                    endpoint: z.string(),
                    models: z.array(z.string())
                  })
                )
              })
            })
          })
        : z.record(z.string(), z.unknown())
};
const result: TomlWorkerResult = { importMs, phases: {}, heapGrowthMiB: {}, peakRssMiB: 0 };

function measure<T>(
  name: string,
  operation: () => T,
  verify: (value: T | undefined) => void,
  batch = 1
) {
  const samples = [];
  const heaps = [];
  for (let index = -fixture.warmups; index < fixture.samples; index++) {
    collectGarbage!();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    let value: T | undefined;
    for (let iteration = 0; iteration < batch; iteration++) {
      value = operation();
    }

    const elapsed = (performance.now() - start) / batch;
    const growth = (process.memoryUsage().heapUsed - before) / 2 ** 20;
    verify(value);
    if (index >= 0) {
      samples.push(elapsed);
      heaps.push(growth);
    }
  }

  result.phases[name] = samples;
  result.heapGrowthMiB[name] = heaps;
}

measure(
  'load',
  () => loadConfigLayersFromFiles(options),
  (value) => assert.deepEqual(value, fixture.expected)
);
measure(
  'startup',
  () => createConfigServiceFromFiles({ ...options, cache: false }),
  (value) => assert.deepEqual(value!.get(''), fixture.expected)
);
const cached = createConfigServiceFromFiles(options);
measure(
  'cache-hit',
  () => createConfigServiceFromFiles(options),
  (value) => assert.equal(value, cached),
  50
);
result.peakRssMiB = process.resourceUsage().maxRSS / 1024;
writeFileSync(output, JSON.stringify(result));
