import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createConfig,
  createConfigFromFiles,
  createConfigService,
  createConfigServiceFromFiles,
  loadConfigLayersFromFiles,
  loadConfigObjectFromFiles
} from '@gaia-framework/config';

const examples = process.argv[2];
assert.ok(examples, 'Supply installed examples, outside the source checkout.');
const directory = mkdtempSync(path.join(tmpdir(), 'config-application-consumer-'));
try {
  for (const [name, portPath, expectedPort] of [
    ['11-service', 'http.port', 4300],
    ['12-pipelines', 'control.port', 4500],
    ['14-toml-service', 'http.port', 4300],
    ['15-toml-pipelines', 'control.port', 4500]
  ] as const) {
    const source = path.join(examples, name);
    const target = path.join(directory, name);
    cpSync(source, target, { recursive: true });
    const { options } = await import(pathToFileURL(path.join(source, 'configuration.ts')).href);

    for (const immutable of [false, true]) {
      const selected = { ...options(target), immutable };
      const raw = loadConfigLayersFromFiles(selected);
      const validated = loadConfigObjectFromFiles(selected);
      const service = createConfigServiceFromFiles(selected);
      const readers = [
        service,
        createConfigFromFiles(selected),
        createConfig(raw, selected.schema, selected),
        createConfigService(raw, selected.schema, selected)
      ];

      for (const reader of readers) {
        assert.equal(reader.getNumber(portPath), expectedPort);
        assert.deepEqual(reader.get(''), validated);
        assert.equal(Object.isFrozen(reader.get('')), immutable);
        assert.equal(reader.has('DIR'), false);
        assert.equal(reader.has('ENV'), false);
      }

      assert.equal(createConfigServiceFromFiles(selected), service);
      assert.notEqual(createConfigServiceFromFiles({ ...selected, cache: false }), service);
      if (name.endsWith('service')) {
        assert.equal(raw.backgroundJobs.cleanup.intervalSeconds, '120');
        assert.equal(service.getNumber('backgroundJobs.cleanup.intervalSeconds'), 120);
        assert.equal(service.getBoolean('backgroundJobs.cleanup.enabled'), false);
        assert.equal(service.getString('routes.0.path'), '/health');
        assert.equal(raw.tier, undefined);
        assert.equal(service.getString('tier'), 'standard');
        assert.deepEqual(service.getStringArray('http.corsOrigins'), [
          'https://local.example.test'
        ]);
      } else {
        assert.equal(raw.deploymentLabel, undefined);
        assert.equal(service.getString('deploymentLabel'), 'synthetic');
        assert.equal(service.getBoolean(['workers', 'batch-runner', 'enabled']), true);
        assert.equal(service.getString('messages.literal'), '${PIPELINE_EXAMPLE_ACCESS_KEY}');
        assert.equal(raw.workers.ingest.concurrency, '2');
        assert.equal(service.getNumber('workers.ingest.concurrency'), 2);
        assert.deepEqual(service.getStringArray('pipelines.daily.stages'), ['read', 'write']);
        assert.equal(service.getString('pipelines.daily.destination.name'), 'environment-primary');
        assert.equal(
          service.getString('pipelines.daily.destination.url'),
          'https://primary.example.test/batches'
        );
        assert.equal(service.getNumber('pipelines.daily.timeoutMs'), 60000);
        assert.deepEqual(service.get('routing.primaryRule'), service.get('routing.rules.0'));
        assert.equal(service.getString('messages.greeting'), 'Batch ready');
        assert.equal(
          service.getString('messages.banner'),
          readFileSync(path.join(target, 'parts/banner.txt'), 'utf8')
        );
      }

      assert.equal(
        service.get<{ fallbackDirectory: string | null }>('storage').fallbackDirectory,
        null
      );
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
