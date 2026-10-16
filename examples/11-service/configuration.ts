import { z } from 'zod';

const jobSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.coerce.number().int().positive(),
  retainDays: z.number().int().positive()
});

export const schema = z.object({
  service: z.object({ name: z.string(), environment: z.string() }),
  http: z.object({
    host: z.string(),
    port: z.coerce.number().int(),
    corsOrigins: z.array(z.string())
  }),
  storage: z.object({
    driver: z.string(),
    directory: z.string(),
    fallbackDirectory: z.string().nullable()
  }),
  authentication: z.object({ enabled: z.boolean(), apiKey: z.string() }),
  backgroundJobs: z.record(z.string(), jobSchema),
  routes: z.array(z.object({ path: z.string(), methods: z.array(z.string()) })),
  logging: z.object({ level: z.string() }),
  tier: z.string().default('standard')
});

export function options(basePath: string) {
  return {
    argv: [],
    configDirEnvVar: 'SERVICE_CONFIG_DIR',
    envNameEnvVar: 'SERVICE_ENV',
    envOverrideObjectVar: 'SERVICE_CONFIG',
    envOverridePrefix: 'SERVICE_CONFIG_',
    inheritProcessEnv: false,
    env: {
      SERVICE_CONFIG_DIR: basePath,
      SERVICE_ENV: 'production',
      SERVICE_EXAMPLE_KEY: 'synthetic-key-not-a-credential',
      SERVICE_CONFIG: '{"http":{"port":4200},"logging":{"level":"warn"}}',
      SERVICE_CONFIG_http_port: '4300'
    },
    schema
  };
}
