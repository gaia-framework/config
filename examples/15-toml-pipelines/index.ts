import 'reflect-metadata';
import { Container } from 'inversify';
import { ConfigReader, ConfigService, createConfigFromFiles } from '@gaia-framework/config';
import { options } from './configuration.ts';

const reader = createConfigFromFiles({ ...options(process.cwd()), immutable: true });
const container = new Container();
container.bind(ConfigReader).toConstantValue(reader);
container
  .bind(ConfigService)
  .toDynamicValue((context) => new ConfigService(context.get(ConfigReader)));
const config = container.get(ConfigService);

const storage = config.get<{ fallbackDirectory: string | null }>('storage');

console.log(
  JSON.stringify({
    port: config.getNumber('control.port'),
    environment: config.getString('application.environment'),
    destination: config.getString('pipelines.daily.destination.name'),
    stages: config.getStringArray('pipelines.daily.stages'),
    timeoutMs: config.getNumber('pipelines.daily.timeoutMs'),
    workerConcurrency: config.getNumber('workers.ingest.concurrency'),
    batchEnabled: config.getBoolean(['workers', 'batch-runner', 'enabled']),
    telemetryEnabled: config.getBoolean('features.telemetry'),
    fallbackDirectory: storage.fallbackDirectory,
    banner: config.getString('messages.banner').trim(),
    literal: config.getString('messages.literal'),
    greeting: config.getString('messages.greeting'),
    label: config.getString('deploymentLabel')
  })
);
