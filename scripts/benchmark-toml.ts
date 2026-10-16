import type { TomlMeasurement, TomlWorkerResult } from './benchmark-types.ts';
import type { ConfigFileFormat } from '../src/index.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stats } from './benchmark-report.ts';
import { createTomlBenchmarkFixture, tomlScenarios } from './toml-benchmark-fixtures.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const smoke = process.argv.includes('--smoke');
const baseline = process.argv.find((argument) => argument.startsWith('--baseline='))?.slice(11);
const directory = mkdtempSync(path.join(tmpdir(), 'config-toml-benchmark-'));
const output = path.join(root, 'artifacts/toml-benchmarks', smoke ? 'smoke' : 'full');
const report = {
  node: process.version,
  platform: process.platform,
  cpu: cpus()[0]?.model,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8'
  }).trim(),
  baseline: baseline ?? null,
  rows: [] as TomlMeasurement[]
};
mkdirSync(output, { recursive: true });

function persist() {
  writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  const lines = [
    '# YAML and TOML measurements',
    '',
    'Milliseconds per operation, separate child process per library/format/case. Startup includes loading, schema validation and service creation; import time is separate. Cache hits use batches of 50. Heap growth is sampled before verification; peak RSS covers the whole worker. OS file caches are warm. No timing thresholds.',
    '',
    '| Case | Library / format | Files | KiB | Phase | Samples | Mean ms | Median ms | p95 ms | Peak RSS MiB | Mean heap growth MiB | Import ms |',
    '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const row of report.rows) {
    for (const [phase, values] of Object.entries(row.phases)) {
      const timing = stats(values);
      lines.push(
        `| ${row.id} | ${row.label} | ${row.fileCount} | ${(row.bytes / 1024).toFixed(1)} | ${phase} | ${timing.n} | ${timing.mean.toFixed(3)} | ${timing.median.toFixed(3)} | ${timing.p95.toFixed(3)} | ${row.peakRssMiB.toFixed(1)} | ${(row.heapGrowthMiB[phase]!.reduce((sum, value) => sum + value, 0) / row.heapGrowthMiB[phase]!.length).toFixed(2)} | ${row.importMs.toFixed(2)} |`
      );
    }
  }

  writeFileSync(path.join(output, 'report.md'), `${lines.join('\n')}\n`);
}

try {
  for (const [index, spec] of tomlScenarios(smoke).entries()) {
    const runs: Array<{ label: string; format: ConfigFileFormat; library: string }> = [
      { label: 'candidate / yaml', format: 'yaml', library: path.join(root, 'dist/src/index.js') },
      { label: 'candidate / toml', format: 'toml', library: path.join(root, 'dist/src/index.js') }
    ];
    if (baseline) {
      runs.push({ label: 'baseline / yaml', format: 'yaml', library: path.resolve(baseline) });
    }

    if (index % 2) {
      runs.reverse();
    }

    for (const run of runs) {
      const fixture = createTomlBenchmarkFixture(
        spec,
        path.join(directory, `${spec.id}-${run.label.replaceAll(/\W/g, '-')}`),
        run.format
      );
      const manifest = path.join(fixture.directory, 'manifest.json');
      const receipt = path.join(fixture.directory, 'result.json');
      writeFileSync(
        manifest,
        JSON.stringify({
          ...fixture,
          kind: spec.kind,
          samples: smoke ? 2 : spec.count >= 100000 ? 3 : 7,
          warmups: smoke ? 1 : 2
        })
      );
      const result = spawnSync(
        process.execPath,
        [
          '--expose-gc',
          '--max-old-space-size=1024',
          path.join(root, 'scripts/toml-benchmark-worker.ts'),
          manifest,
          run.library,
          receipt
        ],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 60000,
          windowsHide: true,
          env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', NODE_ENV: 'test' }
        }
      );
      assert.equal(result.status, 0, `${spec.id} / ${run.label}: ${result.stderr || result.error}`);
      const measurement = JSON.parse(readFileSync(receipt, 'utf8')) as TomlWorkerResult;
      report.rows.push({
        id: spec.id,
        label: run.label,
        bytes: fixture.bytes,
        fileCount: fixture.fileCount,
        ...measurement
      });
      persist();
      console.log(
        `${spec.id} / ${run.label}: ${stats(measurement.phases.load!).mean.toFixed(3)} ms load`
      );
    }
  }

  console.log(`Reports: ${output}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
