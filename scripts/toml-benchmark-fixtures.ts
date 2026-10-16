import type { TomlScenario, TomlFixture } from './benchmark-types.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { stringify } from 'smol-toml';

export function tomlScenarios(smoke: boolean): TomlScenario[] {
  return [
    { id: 'small', kind: 'settings', count: 10 },
    { id: 'application-layers', kind: 'layers', count: smoke ? 5 : 100 },
    { id: 'settings-10000', kind: 'settings', count: smoke ? 20 : 10000 },
    { id: 'settings-100000', kind: 'settings', count: smoke ? 30 : 100000 },
    { id: 'include-fanout', kind: 'fanout', count: smoke ? 5 : 1000 },
    { id: 'nested-50', kind: 'nested', count: smoke ? 5 : 50 },
    { id: 'repeated-includes', kind: 'repeated', count: smoke ? 5 : 1000 }
  ];
}

export function createTomlBenchmarkFixture(
  spec: TomlScenario,
  directory: string,
  format: TomlFixture['format']
): TomlFixture {
  mkdirSync(directory, { recursive: true });
  let bytes = 0;
  let fileCount = 0;

  function write(name: string, data: Record<string, any>) {
    const text = format === 'toml' ? stringify(data) : yaml.dump(data, { lineWidth: -1 });
    writeFileSync(path.join(directory, name), text);
    bytes += Buffer.byteLength(text);
    fileCount++;
  }

  let data: Record<string, any>;
  let expected: Record<string, unknown>;
  if (spec.kind === 'settings') {
    data = {
      settings: Object.fromEntries(
        Array.from({ length: spec.count }, (_, index) => [`item${index}`, index])
      )
    };
    expected = data;
  } else if (spec.kind === 'layers') {
    const providers = Object.fromEntries(
      Array.from({ length: spec.count }, (_, index) => [
        `provider-${index}`,
        {
          enabled: '${ENABLED:-true}',
          endpoint: `https://provider-${index}.example.test`,
          models: ['small', 'large']
        }
      ])
    );
    data = {
      port: '${PORT:-4400}',
      database: { provider: 'postgres' },
      queues: { driver: 'redis' },
      ai: { llm: { providers } }
    };
    expected = {
      ...data,
      port: 4500,
      ai: {
        llm: {
          providers: Object.fromEntries(
            Object.entries(providers).map(([key, value]) => [key, { ...value, enabled: true }])
          )
        }
      }
    };
    write(`config.benchmark.${format}`, { port: 4450 });
    write(`config.local.${format}`, { port: 4475 });
    write(`config.benchmark.local.${format}`, { port: 4500 });
  } else if (spec.kind === 'nested') {
    data = { value: 1 };
    for (let index = 0; index < spec.count; index++) {
      data = { next: data };
    }

    expected = data;
  } else {
    data = {};
    expected = {};
    for (let index = 0; index < spec.count; index++) {
      const part = spec.kind === 'repeated' ? 0 : index;
      const name = `part${part}.${format}`;
      if (spec.kind !== 'repeated' || index === 0) {
        write(name, { value: part });
      }

      data[`part${index}`] = { $include: `./${name}` };
      expected[`part${index}`] = { value: part };
    }
  }

  write(`config.${format}`, data);
  assert.ok(bytes > 0 && fileCount > 0);

  return { directory, format, expected, bytes, fileCount };
}
