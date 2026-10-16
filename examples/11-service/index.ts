import { createConfigServiceFromFiles } from '@gaia-framework/config';
import { options } from './configuration.ts';

const config = createConfigServiceFromFiles(options(process.cwd()));

const storage = config.get<{ fallbackDirectory: string | null }>('storage');

console.log(
  JSON.stringify({
    port: config.getNumber('http.port'),
    environment: config.getString('service.environment'),
    storage: config.getString('storage.driver'),
    cleanupInterval: config.getNumber('backgroundJobs.cleanup.intervalSeconds'),
    cleanupEnabled: config.getBoolean('backgroundJobs.cleanup.enabled'),
    route: config.getString('routes.0.path'),
    fallbackDirectory: storage.fallbackDirectory,
    origins: config.getStringArray('http.corsOrigins'),
    logLevel: config.getString('logging.level')
  })
);
