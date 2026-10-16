import type { ComparisonRow, MeasuredWorkerResult } from './benchmark-types.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { freemem, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture, scenarios } from './benchmark-fixtures.ts';
import { stats } from './benchmark-report.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = process.argv.find((argument) => argument.startsWith('--baseline='))?.slice(11);
const candidate = process.argv.find((argument) => argument.startsWith('--candidate='))?.slice(12);
assert.ok(baseline, 'Supply --baseline=/absolute/path/to/previous/dist/src/index.js');
const libraries = {
  baseline: path.resolve(baseline),
  optimized: candidate ? path.resolve(candidate) : path.join(root, 'dist/src/index.js')
};

for (const filename of Object.values(libraries)) {
  assert.ok(existsSync(filename), `Missing compiled library: ${filename}`);
}

const selected = process.argv
  .find((argument) => argument.startsWith('--cases='))
  ?.slice(8)
  .split(',');
const cases = scenarios().filter(
  (spec) => spec.id !== 'deep-200' && (!selected || selected.includes(spec.id))
);
const supportedPhases = [
  'load',
  'reader',
  'immutable-reader',
  'startup',
  'immutable-startup',
  'cache-miss',
  'keys',
  'key-paths'
];
const selectedPhases = process.argv
  .find((argument) => argument.startsWith('--phases='))
  ?.slice(9)
  .split(',');
const phases = selectedPhases ?? supportedPhases;
assert.ok(
  phases.length && phases.every((phase) => supportedPhases.includes(phase)),
  'Unknown or empty comparison phase selection.'
);
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.join(root, 'artifacts/benchmarks', `comparison-${stamp}`);
const temporary = mkdtempSync(path.join(tmpdir(), 'config-compare-'));
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  libraries,
  rows: [] as ComparisonRow[]
};
mkdirSync(output, { recursive: true });

function persist() {
  writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    '# Configuration optimization comparison',
    '',
    'Means in milliseconds per operation. Same generated fixtures and worker; alternating library launch order. See raw JSON for samples, first calls, and process peak RSS.',
    '',
    '| Case | Phase | Before ms | After ms | Change | Reader retained heap before/after MiB |',
    '| --- | --- | ---: | ---: | ---: | ---: |'
  ];

  for (const row of report.rows) {
    const before = row.baseline.statistics.mean;
    const after = row.optimized.statistics.mean;
    const memory = (['baseline', 'optimized'] as const)
      .map((name) => row[name].retainedReaderHeapMiB?.toFixed(2) ?? '—')
      .join(' / ');
    lines.push(
      `| ${row.id} | ${row.phase} | ${before.toFixed(3)} | ${after.toFixed(3)} | ${((after / before - 1) * 100).toFixed(1)}% | ${memory} |`
    );
  }

  writeFileSync(path.join(output, 'report.md'), `${lines.join('\n')}\n`);
}

try {
  assert.ok(cases.length, 'No matching cases.');

  for (const [caseIndex, spec] of cases.entries()) {
    assert.ok(
      Math.min(freemem(), process.availableMemory()) > 3584 * 2 ** 20,
      'Insufficient available memory; existing services are preserved.'
    );
    const fixture = createFixture(spec, path.join(temporary, spec.id));

    for (const [phaseIndex, phase] of phases.entries()) {
      const row: Omit<ComparisonRow, 'baseline' | 'optimized'> &
        Partial<Pick<ComparisonRow, 'baseline' | 'optimized'>> = {
        id: spec.id,
        phase,
        bytes: fixture.bytes,
        files: fixture.files.length
      };
      const order =
        (caseIndex + phaseIndex) % 2
          ? (['optimized', 'baseline'] as const)
          : (['baseline', 'optimized'] as const);

      for (const name of order) {
        const filename = path.join(output, `${spec.id}-${phase}-${name}.json`);
        const child = spawnSync(
          process.execPath,
          [
            '--expose-gc',
            '--max-old-space-size=2048',
            path.join(root, 'scripts/benchmark-worker.ts'),
            path.join(fixture.directory, 'manifest.json'),
            phase,
            filename,
            libraries[name]
          ],
          {
            cwd: root,
            env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
            windowsHide: true,
            timeout: 240000,
            encoding: 'utf8'
          }
        );
        assert.equal(
          child.status,
          0,
          `${spec.id}/${phase}/${name}: ${child.stderr || child.error}`
        );
        const result = JSON.parse(readFileSync(filename, 'utf8')) as MeasuredWorkerResult;
        assert.equal(result.samples.length, spec.samples);
        result.statistics = stats(result.samples);
        row[name] = result;
      }

      assert.ok(row.baseline && row.optimized);
      report.rows.push({ ...row, baseline: row.baseline, optimized: row.optimized });
      persist();
      console.log(
        `${spec.id}/${phase}: ${row.baseline.statistics.mean.toFixed(3)} -> ${row.optimized.statistics.mean.toFixed(3)} ms`
      );
    }

    rmSync(fixture.directory, { recursive: true, force: true });
  }

  console.log(`Comparison: ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
