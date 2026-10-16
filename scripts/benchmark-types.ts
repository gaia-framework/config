export interface Statistics {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  p95: number;
  stddev: number;
}

interface ScenarioBase {
  id: string;
  records: number;
  padding?: number;
  count?: number;
  depth?: number;
  branches?: number;
}

export type ScenarioInput = ScenarioBase &
  (
    | { kind: 'single' | 'flat' | 'array' | 'layers' | 'overrides' | 'directives' }
    | { kind: 'deep' | 'chain'; depth: number }
    | { kind: 'fanout' | 'repeated'; count: number }
    | { kind: 'tree'; depth: number; branches: number }
  );

export type BenchmarkSpec = ScenarioInput & { samples: number; warmups: number };

export interface SourceFile {
  name: string;
  format: 'yaml' | 'json' | 'text';
  bytes: number;
}

export interface BenchmarkFixture {
  directory: string;
  files: SourceFile[];
  env: NodeJS.ProcessEnv;
  lookupPaths: string[][];
  logicalRecords: number;
  expectedReads: number;
  bytes: number;
  argv: string[];
}

export type FixtureManifest = BenchmarkSpec & BenchmarkFixture;
export interface SourceTimings extends SourceFile {
  read: number[];
  parse: number[];
}

export interface WorkerResult {
  id?: string;
  phase: string;
  samples?: number[];
  firstMs?: number | null;
  batch?: number;
  statistics?: Statistics;
  files?: SourceTimings[];
  fileReads?: number;
  retainedReaderHeapMiB?: number;
  indexedKeys?: number;
  peakRssMiB?: number;
  failed?: boolean;
  error?: string;
}

export interface BenchmarkCase {
  spec: BenchmarkSpec;
  bytes: number;
  fileCount: number;
  logicalRecords: number;
  environmentEntries: number;
  results: WorkerResult[];
}

export interface BenchmarkReport {
  generatedAt: string;
  libraryCommit: string;
  smoke: boolean;
  workingTree: string;
  environment: Record<string, string | number | undefined>;
  cases: BenchmarkCase[];
  elapsedSeconds?: number;
}

export type MeasuredWorkerResult = WorkerResult & {
  samples: number[];
  statistics: Statistics;
};

export interface ComparisonRow {
  id: string;
  phase: string;
  bytes: number;
  files: number;
  baseline: MeasuredWorkerResult;
  optimized: MeasuredWorkerResult;
}

export interface TomlScenario {
  id: string;
  kind: 'settings' | 'layers' | 'nested' | 'fanout' | 'repeated';
  count: number;
}

export interface TomlFixture {
  directory: string;
  format: 'yaml' | 'toml';
  expected: Record<string, unknown>;
  bytes: number;
  fileCount: number;
}

export interface TomlWorkerResult {
  importMs: number;
  phases: Record<string, number[]>;
  heapGrowthMiB: Record<string, number[]>;
  peakRssMiB: number;
}

export type TomlMeasurement = TomlWorkerResult & {
  id: string;
  label: string;
  bytes: number;
  fileCount: number;
};
