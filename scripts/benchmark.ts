import type { BenchmarkReport, BenchmarkCase, WorkerResult } from './benchmark-types.ts';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, cpus, freemem, totalmem, tmpdir, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture, scenarios } from './benchmark-fixtures.ts';
import { stats, writeReport } from './benchmark-report.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const smoke = process.argv.includes('--smoke');
const selected = process.argv.find((value) => value.startsWith('--case='))?.slice(7);
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.join(root, 'artifacts/benchmarks', smoke ? 'smoke' : stamp);
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'config-benchmark-'));
const phases = [
  'source-files',
  'load',
  'schema',
  'reader',
  'immutable-reader',
  'startup',
  'immutable-startup',
  'cache-hit',
  'get-cold',
  'get-hot',
  'get-hot-segments',
  'keys',
  'key-paths'
];
const heapMiB = smoke ? 256 : 2048;
const timeoutMs = 240000;
const started = performance.now();
const report: BenchmarkReport = {
  generatedAt: new Date().toISOString(),
  smoke,
  libraryCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8'
  }).trim(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: availableParallelism(),
    totalMemoryMiB: totalmem() / 2 ** 20,
    availableMemoryMiB: process.availableMemory(),
    heapMiB,
    timeoutMs
  },
  cases: []
};
report.environment.availableMemoryMiB = Number(report.environment.availableMemoryMiB) / 2 ** 20;
mkdirSync(output, { recursive: true });
assert.ok(existsSync(path.join(root, 'dist/src/index.js')), 'Build before benchmarking.');

assert.deepEqual(stats([1, 2, 3]), { n: 3, mean: 2, median: 2, min: 1, max: 3, p95: 3, stddev: 1 });

function runWorker(manifest: string, phase: string, filename: string): Promise<WorkerResult> {
  return new Promise<WorkerResult>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--expose-gc',
        `--max-old-space-size=${heapMiB}`,
        path.join(root, 'scripts/benchmark-worker.ts'),
        manifest,
        phase,
        filename
      ],
      { cwd: root, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, windowsHide: true }
    );
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.resume();
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8192);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ phase, failed: true, error: error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);

      if (code !== 0 || !existsSync(filename)) {
        const failure = existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) : {};
        resolve({ phase, failed: true, code, signal, timedOut, error: stderr, ...failure });

        return;
      }

      const result = JSON.parse(readFileSync(filename, 'utf8')) as WorkerResult;
      assert.ok(result.samples);
      assert.equal(result.samples.length, JSON.parse(readFileSync(manifest, 'utf8')).samples);
      result.statistics = stats(result.samples);
      resolve(result);
    });
  });
}

function persist() {
  report.elapsedSeconds = (performance.now() - started) / 1000;
  writeReport(report, output);
}

try {
  for (const spec of scenarios(smoke).filter((item) => !selected || item.id === selected)) {
    assert.ok(
      Math.min(freemem(), process.availableMemory()) > (heapMiB + (smoke ? 512 : 1536)) * 2 ** 20,
      'Insufficient available memory for bounded sequential benchmark. Existing services are preserved.'
    );
    console.log(`Generating ${spec.id}...`);
    const fixture = createFixture(spec, path.join(fixtureRoot, spec.id));
    const item: BenchmarkCase = {
      spec,
      bytes: fixture.bytes,
      fileCount: fixture.files.length,
      logicalRecords: fixture.logicalRecords,
      environmentEntries: Object.keys(fixture.env).length,
      results: []
    };
    report.cases.push(item);
    console.log(
      `${spec.id}: ${item.fileCount} files, ${(item.bytes / 2 ** 20).toFixed(2)} MiB, ${item.logicalRecords} records.`
    );

    for (const phase of phases) {
      const result = await runWorker(
        path.join(fixture.directory, 'manifest.json'),
        phase,
        path.join(output, `${spec.id}-${phase}.json`)
      );
      item.results.push(result);
      persist();
      console.log(
        `  ${phase}: ${result.failed ? `FAILED ${result.error!.split('\n').find((line) => /Error|heap/i.test(line)) ?? ('code' in result ? result.code : undefined)}` : `${result.statistics!.mean.toFixed(3)} ms/op (n=${result.statistics!.n})`}`
      );
    }

    rmSync(fixture.directory, { recursive: true, force: true });
  }

  assert.ok(report.cases.length, 'No matching benchmark case.');
  console.log(`Reports: ${output}`);

  if (smoke) {
    assert.ok(
      report.cases.every((item) => item.results.every((result) => !result.failed)),
      'Smoke benchmark validation failed.'
    );
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
