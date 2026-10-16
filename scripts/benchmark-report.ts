import type { Statistics, BenchmarkReport, BenchmarkCase } from './benchmark-types.ts';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export function stats(values: number[]): Statistics {
  assert.ok(values.length > 0 && values.every((value) => Number.isFinite(value) && value >= 0));
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);

  return {
    n: values.length,
    mean,
    median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    min: sorted[0]!,
    max: sorted.at(-1)!,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    stddev:
      values.length > 1
        ? Math.sqrt(
            values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
          )
        : 0
  };
}

function csv(rows: Array<Array<string | number | boolean | null | undefined>>) {
  return `${rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')}\n`;
}

export function writeReport(report: BenchmarkReport, output: string) {
  writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  const timings: Array<Array<string | number | boolean | null | undefined>> = [
    [
      'case',
      'phase',
      'n',
      'mean_ms',
      'median_ms',
      'min_ms',
      'max_ms',
      'p95_ms',
      'stddev_ms',
      'first_ms',
      'peak_rss_mib',
      'failed'
    ]
  ];
  const files: Array<Array<string | number | boolean | null | undefined>> = [
    [
      'case',
      'file',
      'format',
      'bytes',
      'n',
      'read_mean_ms',
      'parse_mean_ms',
      'read_parse_mean_ms',
      'read_min_ms',
      'read_max_ms',
      'parse_min_ms',
      'parse_max_ms'
    ]
  ];

  for (const item of report.cases) {
    for (const result of item.results) {
      const s: Partial<Statistics> = result.statistics ?? {};
      timings.push([
        item.spec.id,
        result.phase,
        s.n,
        s.mean,
        s.median,
        s.min,
        s.max,
        s.p95,
        s.stddev,
        result.firstMs,
        result.peakRssMiB,
        result.failed ?? false
      ]);

      for (const file of result.files ?? []) {
        const read = stats(file.read);
        const parse = stats(file.parse);
        files.push([
          item.spec.id,
          file.name,
          file.format,
          file.bytes,
          read.n,
          read.mean,
          parse.mean,
          read.mean + parse.mean,
          read.min,
          read.max,
          parse.min,
          parse.max
        ]);
      }
    }
  }

  writeFileSync(path.join(output, 'phases.csv'), csv(timings));
  writeFileSync(path.join(output, 'files.csv'), csv(files));
  const table = [
    '# Configuration benchmark results',
    '',
    `Measured ${report.generatedAt}; library commit \`${report.libraryCommit}\`.`,
    '',
    `Node ${report.environment.node}, ${report.environment.platform} ${report.environment.arch}, ${report.environment.cpu}.`,
    '',
    '| Case | Files | MiB | Records/values | Indexed keys | Samples | Fresh loader ms | Validated service ms | Immutable service ms | Peak startup RSS MiB |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];

  function metric(item: BenchmarkCase, phase: string, field: keyof Statistics = 'mean') {
    const result = item.results.find((entry) => entry.phase === phase);

    return result?.statistics?.[field]?.toFixed(3) ?? (result?.failed ? 'FAILED' : 'pending');
  }

  for (const item of report.cases) {
    const peak = item.results.find((entry) => entry.phase === 'startup')?.peakRssMiB;
    const keys = item.results.find((entry) => entry.phase === 'keys')?.indexedKeys;
    const samples = item.results.find((entry) => entry.phase === 'load')?.statistics?.n ?? '—';
    table.push(
      `| ${item.spec.id} | ${item.fileCount} | ${(item.bytes / 2 ** 20).toFixed(3)} | ${item.logicalRecords} | ${keys ?? '—'} | ${samples} | ${metric(item, 'load')} | ${metric(item, 'startup')} | ${metric(item, 'immutable-startup')} | ${peak?.toFixed(1) ?? '—'} |`
    );
  }

  table.push(
    '',
    '## Per-source-file averages',
    '',
    'Every file has its own row in files.csv. These source costs exclude directive resolution and recursive subtrees.',
    '',
    '| Case | Sources | Root read + parse ms | Mean per other source ms | Slowest source mean ms | Physical reads per fresh loader |',
    '| --- | ---: | ---: | ---: | ---: | ---: |'
  );
  const allFileMeans = [];

  for (const item of report.cases) {
    const sources = item.results.find((entry) => entry.phase === 'source-files')?.files;

    if (!sources) {
      continue;
    }

    const fileMeans = sources.map((file) => ({
      name: file.name,
      mean: stats(file.read).mean + stats(file.parse).mean
    }));
    allFileMeans.push(...fileMeans.map((file) => file.mean));
    const root = fileMeans.find((file) => file.name === 'config.yaml');
    const others = fileMeans.filter((file) => file.name !== 'config.yaml').map((file) => file.mean);
    const slowest = Math.max(...fileMeans.map((file) => file.mean));
    const reads = item.results.find((entry) => entry.phase === 'load')?.fileReads;
    table.push(
      `| ${item.spec.id} | ${sources.length} | ${root!.mean.toFixed(6)} | ${others.length ? stats(others).mean.toFixed(6) : '—'} | ${slowest.toFixed(6)} | ${reads ?? '—'} |`
    );
  }

  if (allFileMeans.length) {
    table.push(
      '',
      `Mean across ${allFileMeans.length} source-file means: ${stats(allFileMeans).mean.toFixed(6)} ms/file. Each source has equal weight, regardless of size; this is not a typical config-load estimate.`
    );
  }

  table.push(
    '',
    '## Phase averages and spread',
    '',
    '| Case | Phase | Mean ms/op | Median | Min | Max | P95 | Sample SD |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
  );

  for (const item of report.cases) {
    for (const result of item.results.filter((entry) => entry.statistics)) {
      table.push(
        `| ${item.spec.id} | ${result.phase} | ${(['mean', 'median', 'min', 'max', 'p95', 'stddev'] as const).map((field) => result.statistics![field].toFixed(6)).join(' | ')} |`
      );
    }
  }

  table.push(
    '',
    '## Equal-weight scenario averages',
    '',
    'Each scenario contributes one mean; these mixed workloads are not a typical production startup.',
    '',
    '| Phase | Successful cases | Mean of case means ms/op |',
    '| --- | ---: | ---: |'
  );

  for (const phase of new Set(
    report.cases.flatMap((item) => item.results.map((result) => result.phase))
  )) {
    const means = report.cases.flatMap((item) =>
      item.results
        .filter((result) => result.phase === phase && result.statistics)
        .map((result) => result.statistics!.mean)
    );

    if (means.length) {
      table.push(`| ${phase} | ${means.length} | ${stats(means).mean.toFixed(6)} |`);
    }
  }

  table.push('', '## Failures', '');

  for (const item of report.cases) {
    for (const result of item.results.filter((entry) => entry.failed)) {
      const depthLimit = result.error!.match(/nesting exceeded maxDepth \(\d+\)/)?.[0];
      const message = depthLimit
        ? `YAMLException: ${depthLimit}`
        : result.error!.slice(-600).replaceAll('\n', ' ');
      table.push(`- ${item.spec.id} / ${result.phase}: ${message}`);
    }
  }

  table.push(
    '',
    'All durations exclude module import, fixture generation and explicit pre-sample GC. Initial timing batches before warmup are in phases.csv; cache/getter cases already have setup data in that process. Filesystem caches are not flushed. Worker peak RSS includes setup/warmups, not just the operation. Raw per-file read/parse means are in files.csv. Failures are excluded from averages.',
    ''
  );
  writeFileSync(path.join(output, 'report.md'), table.join('\n'));
}
