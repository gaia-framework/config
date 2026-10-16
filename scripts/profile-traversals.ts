import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { stats } from './benchmark-report.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const libraryPath = process.argv.find((argument) => argument.startsWith('--library='))?.slice(10);
const filename = path.resolve(libraryPath ?? path.join(root, 'dist/src/index.js'));
const outputOption = process.argv.find((argument) => argument.startsWith('--output='))?.slice(9);
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.resolve(
  outputOption ?? path.join(root, 'artifacts/traversals', `${stamp}.json`)
);
const library = await import(pathToFileURL(filename).href);
const { assertAcyclicConfig } = await import(
  pathToFileURL(path.join(path.dirname(filename), 'inputValidation.js')).href
);
const { createImmutableSnapshot } = await import(
  pathToFileURL(path.join(path.dirname(filename), 'reader/immutableSnapshot.js')).href
);
const { ConfigKeyIndex } = await import(
  pathToFileURL(path.join(path.dirname(filename), 'reader/ConfigKeyIndex.js')).href
);
const schema = z.object({
  services: z.record(z.string(), z.object({ port: z.number(), tags: z.array(z.string()) }))
});
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  library: filename,
  rows: [] as Array<{
    records: number;
    phase: string;
    samples: number[];
    statistics: ReturnType<typeof stats>;
  }>
};

for (const records of [10, 1000, 10000]) {
  const data = {
    services: Object.fromEntries(
      Array.from({ length: records }, (_, index) => [
        `service${index}`,
        { port: 4000 + (index % 1000), tags: ['synthetic', 'local'] }
      ])
    )
  };
  const operations = {
    'cycle-guard': () => assertAcyclicConfig(data),
    schema: () => schema.parse(data),
    'snapshot-copy': () => createImmutableSnapshot(data),
    'key-index': () => new ConfigKeyIndex(data),
    reader: () => new library.ConfigReader(data),
    'immutable-reader': () => new library.ConfigReader(data, { immutable: true }),
    'factory-no-schema': () => library.createConfig(data),
    'factory-schema': () => library.createConfig(data, schema),
    'factory-immutable': () => library.createConfig(data, undefined, { immutable: true })
  };

  for (const [phase, operation] of Object.entries(operations)) {
    for (let index = 0; index < 3; index++) {
      operation();
    }

    const samples = [];
    for (let index = 0; index < 7; index++) {
      globalThis.gc?.();
      const start = performance.now();
      const value = operation();
      samples.push(performance.now() - start);

      if (value instanceof library.ConfigReader) {
        assert.equal(value.getNumber('services.service0.port'), 4000);
        assert.equal(Object.isFrozen(value.get('')), phase.includes('immutable'));
      }
    }

    const row = { records, phase, samples, statistics: stats(samples) };
    report.rows.push(row);
    console.log(`${records}/${phase}: ${row.statistics.mean.toFixed(3)} ms`);
  }
}

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Traversal profile: ${output}`);
