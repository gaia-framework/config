import type {
  BenchmarkSpec,
  ScenarioInput,
  SourceFile,
  FixtureManifest
} from './benchmark-types.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export function scenarios(smoke = false): BenchmarkSpec[] {
  if (smoke) {
    const seeds: ScenarioInput[] = [
      { id: 'single', kind: 'single', records: 10 },
      { id: 'flat', kind: 'flat', records: 100 },
      { id: 'array', kind: 'array', records: 10 },
      { id: 'deep', kind: 'deep', records: 2, depth: 10 },
      { id: 'fanout', kind: 'fanout', records: 2, count: 10 },
      { id: 'tree', kind: 'tree', records: 2, depth: 2, branches: 2 },
      { id: 'chain', kind: 'chain', records: 2, depth: 10 },
      { id: 'repeated', kind: 'repeated', records: 2, count: 10 },
      { id: 'layers', kind: 'layers', records: 10 },
      { id: 'overrides', kind: 'overrides', records: 10 },
      { id: 'directives', kind: 'directives', records: 10 }
    ];

    return seeds.map((spec) => ({ ...spec, samples: 2, warmups: 1 }));
  }

  const seeds: ScenarioInput[] = [
    ...[10, 100, 1000, 10000, 50000, 100000].map((records) => ({
      id: `single-${records}`,
      kind: 'single' as const,
      records
    })),
    { id: 'single-100mib', kind: 'single', records: 10000, padding: 10240 },
    { id: 'flat-250000', kind: 'flat', records: 250000 },
    { id: 'array-10000', kind: 'array', records: 10000 },
    { id: 'deep-50', kind: 'deep', records: 10, depth: 50 },
    { id: 'deep-90', kind: 'deep', records: 10, depth: 90 },
    { id: 'deep-200', kind: 'deep', records: 10, depth: 200 },
    { id: 'includes-10', kind: 'fanout', records: 100, count: 10 },
    { id: 'includes-100', kind: 'fanout', records: 100, count: 100 },
    { id: 'includes-1000', kind: 'fanout', records: 10, count: 1000 },
    { id: 'includes-10000', kind: 'fanout', records: 1, count: 10000 },
    { id: 'tree-1093', kind: 'tree', records: 10, depth: 6, branches: 3 },
    { id: 'chain-100', kind: 'chain', records: 10, depth: 100 },
    { id: 'chain-250', kind: 'chain', records: 10, depth: 250 },
    { id: 'repeated-1000', kind: 'repeated', records: 10, count: 1000 },
    { id: 'layers-10000', kind: 'layers', records: 10000 },
    { id: 'overrides-1000', kind: 'overrides', records: 10000 },
    { id: 'directives-1000', kind: 'directives', records: 1000 }
  ];

  return seeds.map((spec) => ({
    samples: spec.records >= 50000 || spec.padding || (spec.count ?? 0) >= 1000 ? 3 : 7,
    warmups: spec.records >= 50000 || spec.padding || (spec.count ?? 0) >= 1000 ? 1 : 2,
    ...spec
  }));
}

const service = z.object({
  name: z.string(),
  port: z.coerce.number(),
  enabled: z.boolean(),
  endpoint: z.string(),
  retries: z.number(),
  tags: z.array(z.string()),
  limits: z.object({ requests: z.number(), window: z.number() })
});

export function schemaFor(spec: BenchmarkSpec) {
  let schema: z.ZodType = z.object({ services: z.record(z.string(), service) });

  if (spec.kind === 'flat') {
    return z.record(z.string(), z.number());
  }

  if (spec.kind === 'array') {
    return z.object({ items: z.array(service) });
  }

  if (spec.kind === 'deep' || spec.kind === 'chain') {
    for (let index = 0; index < spec.depth; index++) {
      schema = z.object({ next: schema });
    }
  }

  const levels =
    spec.kind === 'tree' ? spec.depth : spec.kind === 'fanout' || spec.kind === 'repeated' ? 1 : 0;

  for (let level = 0; level < levels; level++) {
    schema = z.object({ groups: z.record(z.string(), schema) });
  }

  return schema;
}

function serviceLines(spec: BenchmarkSpec, index: number, prefix: number, array = false) {
  const indent = ' '.repeat(prefix);
  const heading = array
    ? `${indent}- name: synthetic`
    : `${indent}svc${String(index).padStart(6, '0')}:\n${indent}  name: synthetic`;
  const field = `${indent}  `;
  const directives = spec.kind === 'directives';

  return [
    directives ? heading.replace('name: synthetic', 'name: {$env: BENCH_NAME}') : heading,
    `${field}port: ${directives ? '${BENCH_PORT:-4080}' : 4080}`,
    `${field}enabled: ${directives ? '${BENCH_ENABLED:-true}' : 'true'}`,
    `${field}endpoint: ${directives ? '{$file: ./endpoint.txt}' : `https://synthetic.invalid/${'x'.repeat(spec.padding ?? 16)}`}`,
    `${field}retries: 3`,
    `${field}tags: [synthetic, benchmark]`,
    `${field}limits: ${directives ? '{$include: ./limits.json}' : '{requests: 1000, window: 60}'}`
  ].join('\n');
}

function servicesYaml(spec: BenchmarkSpec, indentation = 0) {
  const rows = [`${' '.repeat(indentation)}services:`];

  for (let index = 0; index < spec.records; index++) {
    rows.push(serviceLines(spec, index, indentation + 2));
  }

  return `${rows.join('\n')}\n`;
}

export function createFixture(spec: BenchmarkSpec, directory: string): FixtureManifest {
  const files: SourceFile[] = [];
  const env: NodeJS.ProcessEnv = {};
  const lookupPaths: string[][] = [];
  let logicalRecords = spec.records;
  let expectedReads;

  function write(name: string, content: string, format: SourceFile['format'] = 'yaml') {
    const filename = path.join(directory, name);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, content);
    files.push({ name, format, bytes: Buffer.byteLength(content) });
  }

  function addPaths(prefix: string[] = [], recordCount = spec.records) {
    for (let index = 0; index < recordCount && lookupPaths.length < 1000; index++) {
      lookupPaths.push([...prefix, 'services', `svc${String(index).padStart(6, '0')}`, 'port']);
    }
  }

  if (spec.kind === 'flat') {
    const rows = [];

    for (let index = 0; index < spec.records; index++) {
      rows.push(`key${String(index).padStart(6, '0')}: 4080`);

      if (lookupPaths.length < 1000) {
        lookupPaths.push([`key${String(index).padStart(6, '0')}`]);
      }
    }

    write('config.yaml', `${rows.join('\n')}\n`);
  } else if (spec.kind === 'array') {
    const rows = ['items:'];

    for (let index = 0; index < spec.records; index++) {
      rows.push(serviceLines(spec, index, 2, true));

      if (lookupPaths.length < 1000) {
        lookupPaths.push(['items', String(index), 'port']);
      }
    }

    write('config.yaml', `${rows.join('\n')}\n`);
  } else if (spec.kind === 'deep' || spec.kind === 'chain') {
    if (spec.kind === 'deep') {
      const wrappers = Array.from(
        { length: spec.depth },
        (_, index) => `${' '.repeat(index * 2)}next:`
      );
      write('config.yaml', `${wrappers.join('\n')}\n${servicesYaml(spec, spec.depth * 2)}`);
    } else {
      for (let index = 0; index < spec.depth; index++) {
        write(
          index === 0 ? 'config.yaml' : `chain-${index}.yaml`,
          `next: {$include: ./chain-${index + 1}.yaml}\n`
        );
      }

      write(`chain-${spec.depth}.yaml`, servicesYaml(spec));
    }

    addPaths(new Array(spec.depth).fill('next'));
  } else if (spec.kind === 'fanout' || spec.kind === 'repeated') {
    const rows = ['groups:'];

    for (let index = 0; index < spec.count; index++) {
      const name = spec.kind === 'repeated' ? 'parts/shared.yaml' : `parts/part-${index}.yaml`;
      rows.push(`  group${index}: {$include: ./${name}}`);

      if (spec.kind !== 'repeated' || index === 0) {
        write(name, servicesYaml(spec));
      }

      addPaths(['groups', `group${index}`]);
    }

    write('config.yaml', `${rows.join('\n')}\n`);
    logicalRecords *= spec.count;
    expectedReads = spec.kind === 'repeated' ? 2 : files.length;
  } else if (spec.kind === 'tree') {
    function tree(level: number, name: string, prefix: string[]) {
      if (level === 0) {
        write(name, servicesYaml(spec));
        addPaths(prefix);

        return;
      }

      const rows = ['groups:'];

      for (let index = 0; index < spec.branches!; index++) {
        const child = `${name.replace('.yaml', '')}-${index}.yaml`;
        rows.push(`  group${index}: {$include: ./${path.basename(child)}}`);
        tree(level - 1, child, [...prefix, 'groups', `group${index}`]);
      }

      write(name, `${rows.join('\n')}\n`);
    }

    tree(spec.depth, 'config.yaml', []);
    logicalRecords *= spec.branches ** spec.depth;
  } else {
    write('config.yaml', servicesYaml(spec));
    addPaths();

    if (spec.kind === 'layers') {
      for (const [name, port] of [
        ['config.benchmark.yaml', 7070],
        ['config.local.yaml', 8080],
        ['config.benchmark.local.yaml', 9090]
      ] as const) {
        write(name, `services:\n  svc000000:\n    port: ${port}\n`);
      }
    }

    if (spec.kind === 'overrides') {
      env.CONFIG = JSON.stringify({ services: { svc000000: { retries: 7 } } });

      for (let index = 0; index < Math.min(spec.records, 1000); index++) {
        env[`CONFIG_services_svc${String(index).padStart(6, '0')}_port`] = '5000';
      }
    }

    if (spec.kind === 'directives') {
      Object.assign(env, { BENCH_NAME: 'synthetic', BENCH_PORT: '4080', BENCH_ENABLED: 'true' });
      write('endpoint.txt', 'https://synthetic.invalid/endpoint', 'text');
      write('limits.json', '{"requests":1000,"window":60}', 'json');
      expectedReads = spec.records + 2;
    }
  }

  const manifest = {
    ...spec,
    directory,
    files,
    env,
    lookupPaths,
    logicalRecords,
    expectedReads: expectedReads ?? (spec.kind === 'layers' ? 1 : files.length),
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    argv: spec.kind === 'layers' ? [] : ['--config', 'config.yaml']
  };
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));

  return manifest;
}
