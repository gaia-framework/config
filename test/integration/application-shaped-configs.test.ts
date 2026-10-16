import { expect } from 'chai';
import { cpSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import * as current from '../../src/index.js';
import type { LoadConfigOptions } from '../../src/index.js';
import { fixture, isolatedEnvironment } from '../support/fixtures.js';

function outcome(action: () => unknown): unknown {
  try {
    return { value: action() };
  } catch (error) {
    const failure = error as Error & { code?: string; cause?: unknown };

    return {
      name: failure.name,
      message: failure.message,
      code: failure.code,
      cause: failure.cause
        ? outcome(() => {
            throw failure.cause;
          })
        : undefined
    };
  }
}

describe('Application-shaped configuration contracts', () => {
  isolatedEnvironment();
  let files: ReturnType<typeof fixture>;

  beforeEach(() => {
    files = fixture();
  });

  afterEach(() => files.dispose());

  for (const application of [
    {
      name: 'Service',
      directory: '11-service',
      port: 'http.port',
      objectVariable: 'SERVICE_CONFIG',
      prefix: 'SERVICE_CONFIG_',
      layers: [4000, 4100, 4150, 4175],
      overriddenPort: 4300
    },
    {
      name: 'Pipeline',
      directory: '12-pipelines',
      port: 'control.port',
      objectVariable: 'PIPELINE_CONFIG',
      prefix: 'PIPELINE_CONFIG_',
      layers: [4400, 4450, 4470, 4480],
      overriddenPort: 4500
    }
  ]) {
    describe(application.name, () => {
      let options: LoadConfigOptions;

      beforeEach(async () => {
        const source = path.resolve('examples', application.directory);
        cpSync(source, files.directory, { recursive: true });
        const module = await import(pathToFileURL(path.join(source, 'configuration.ts')).href);
        options = module.options(files.directory);
      });

      it('preserves each selected layer and raw versus validated values', () => {
        const env = { ...options.env };
        for (const name of Object.keys(env)) {
          if (name.startsWith(application.prefix) || name === application.objectVariable) {
            delete env[name];
          }
        }

        // Directory selection is explicit after removing override-prefixed control variables.
        const layers = [
          'config.yaml',
          'config.production.yaml',
          'config.local.yaml',
          'config.production.local.yaml'
        ];
        for (let count = 1; count <= layers.length; count++) {
          const selected = {
            ...options,
            basePath: files.directory,
            env,
            argv: layers.slice(0, count).flatMap((filename) => ['--config', filename])
          };
          const reader = current.createConfigFromFiles(selected);
          expect(reader.getNumber(application.port)).equal(application.layers[count - 1]);
          expect(
            reader.get<{ fallbackDirectory: string | null }>('storage').fallbackDirectory
          ).equal(count < 3 ? (application.name === 'Service' ? './fallback' : './spool') : null);
          if (application.name === 'Service') {
            expect(reader.getBoolean('backgroundJobs.cleanup.enabled')).equal(count < 4);
          } else {
            expect(reader.getStringArray('pipelines.daily.stages')).deep.equal(
              count < 3 ? ['read', 'validate', 'write'] : ['read', 'write']
            );
            expect(reader.getBoolean('features.audit')).equal(count < 4);
          }

          const rawReader = new current.ConfigReader(current.loadConfigLayersFromFiles(selected));
          expect(rawReader.getNumber(application.port)).equal(application.layers[count - 1]);
        }

        const raw = current.loadConfigLayersFromFiles(options);
        const validated = current.loadConfigObjectFromFiles(options);
        if (application.name === 'Service') {
          expect(raw.backgroundJobs.cleanup.intervalSeconds).equal('120');
          expect((validated as any).backgroundJobs.cleanup.intervalSeconds).equal(120);
          expect(raw.storage.fallbackDirectory).equal(null);
          expect(raw.routes[0].path).equal('/health');
          expect(raw.tier).equal(undefined);
          expect((validated as any).tier).equal('standard');
        } else {
          expect(raw.deploymentLabel).equal(undefined);
          expect((validated as any).deploymentLabel).equal('synthetic');
          expect(raw.messages.banner).equal(
            readFileSync(path.join(files.directory, 'parts/banner.txt'), 'utf8')
          );
          expect(raw.workers.ingest.concurrency).equal('2');
          expect((validated as any).workers.ingest.concurrency).equal(2);
          expect(raw.storage.fallbackDirectory).equal(null);
          expect(raw.pipelines.daily.stages).deep.equal(['read', 'write']);
          expect(raw.pipelines.daily.timeoutMs).equal(60000);
          expect(raw.pipelines.daily.destination).deep.equal({
            name: 'environment-primary',
            url: 'https://primary.example.test/batches'
          });
          expect(raw.workers['batch-runner'].enabled).equal(true);
          expect(raw.routing.primaryRule).deep.equal(raw.routing.rules[0]);
          expect(raw.messages.literal).equal('${PIPELINE_EXAMPLE_ACCESS_KEY}');
          expect(raw.messages.greeting).equal('Batch ready');
        }
      });

      it('matches all factories, strict modes, immutable results and actual cache reuse', () => {
        for (const immutable of [false, true]) {
          for (const safeErrors of [false, true]) {
            const selected = {
              ...options,
              immutable,
              safeErrors,
              strictFiles: true,
              strictGetters: true
            };

            function snapshot(library: typeof current) {
              const raw = library.loadConfigLayersFromFiles(selected);
              const service = library.createConfigServiceFromFiles(selected);
              const readers = [
                library.createConfigFromFiles(selected),
                current.createConfig(raw, selected.schema, selected),
                library.createConfigService(raw, selected.schema, selected),
                library.createConfigService(library.createConfigFromFiles(selected))
              ];

              return {
                object: library.loadConfigObjectFromFiles(selected),
                values: [service, ...readers].map((reader) => reader.get('')),
                keys: service.keys(),
                paths: service.keyPaths(),
                frozen: Object.isFrozen(service.get('')),
                reused: library.createConfigServiceFromFiles(selected) === service,
                bypassed:
                  library.createConfigServiceFromFiles({ ...selected, cache: false }) !== service
              };
            }

            const actual = snapshot(current);
            for (const value of actual.values) {
              expect(value).deep.equal(actual.object);
            }

            expect(actual.keys).include(application.port);
            expect(actual.paths).deep.include(application.port.split('.'));
            expect(current.createConfig(actual.object).getNumber(application.port)).equal(
              application.overriddenPort
            );
            expect(actual.reused).equal(true);
            expect(actual.bypassed).equal(true);
            expect(actual.frozen).equal(immutable);
          }
        }
      });

      it('retains schema and environment cache isolation and validation failures', () => {
        for (const safeErrors of [false, true]) {
          const selected = { ...options, safeErrors };
          const changed = {
            ...selected,
            env: {
              ...selected.env,
              [`${application.prefix}${application.port.replaceAll('.', '_')}`]: '4900'
            }
          };
          const original = current.createConfigServiceFromFiles(selected);
          const updated = current.createConfigServiceFromFiles(changed);
          const failure = outcome(() =>
            current.createConfigServiceFromFiles({ ...selected, schema: z.never() })
          ) as { message: string; code?: string };
          if (safeErrors) {
            expect(failure.code).equal('CONFIG_VALIDATION_FAILED');
          } else {
            expect(failure.message).include('Invalid configuration:');
          }

          expect(updated).not.equal(original);
          expect(updated.getNumber(application.port)).equal(4900);
          expect(current.createConfigServiceFromFiles(selected)).equal(original);
        }
      });

      it('preserves directive failures and original causes in both error modes', () => {
        files.write('config.yaml', 'value: {$include: ./missing.yaml}');
        for (const safeErrors of [false, true]) {
          const selected = { ...options, safeErrors, cache: false };
          const failure = outcome(() => current.loadConfigLayersFromFiles(selected)) as {
            message: string;
            code?: string;
            cause?: { message: string };
          };
          if (safeErrors) {
            expect(failure.code).equal('CONFIG_FILE_LOAD_FAILED');
            expect(failure.cause).equal(undefined);
            expect(failure.message).not.include(files.directory);
          } else {
            expect(failure.message).include('Failed to load config file');
            expect(failure.cause?.message).include('missing.yaml');
          }
        }
      });
    });
  }

  it('keeps observable getter passes and schema boundaries instead of removing guards', () => {
    function observe(library: typeof current, immutable: boolean, useSchema: boolean) {
      let reads = 0;
      let schemaCalls = 0;
      const input = Object.defineProperty({}, 'value', {
        enumerable: true,
        get() {
          reads++;

          return { port: 4001 };
        }
      });
      const schema = z.any().transform((value) => {
        schemaCalls++;

        return value;
      });
      const result = outcome(() =>
        library
          .createConfig(input, useSchema ? schema : undefined, { immutable })
          .getNumber('value.port')
      );

      return { reads, schemaCalls, result };
    }

    for (const immutable of [false, true]) {
      for (const schema of [false, true]) {
        const observed = observe(current, immutable, schema);
        expect(observed.reads).equal(immutable ? 0 : 4);
        expect(observed.schemaCalls).equal(!immutable && schema ? 1 : 0);
        if (immutable) {
          expect(observed.result).include({
            message: 'Immutable configuration does not support accessor properties.'
          });
        } else {
          expect(observed.result).deep.equal({ value: 4001 });
        }
      }
    }
  });

  it('rejects cycles before schemas and rejects cyclic transformed results afterward', () => {
    let called = false;
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(() =>
      current.createConfig(
        cyclic,
        z.any().transform(() => {
          called = true;

          return {};
        })
      )
    ).to.throw('cycle');
    expect(called).equal(false);
    expect(() =>
      current.createConfig(
        {},
        z.any().transform(() => cyclic)
      )
    ).to.throw('cycle');
  });
});
