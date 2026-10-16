import { z } from 'zod';

const workerSchema = z.object({
  enabled: z.boolean(),
  concurrency: z.coerce.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  tags: z.array(z.string())
});

const ruleSchema = z.object({ match: z.string(), pipeline: z.string() });

const pipelineSchema = z.object({
  enabled: z.boolean(),
  stages: z.array(z.string()),
  destination: z.object({ name: z.string(), url: z.string() }),
  timeoutMs: z.number().int().positive()
});

export const schema = z.object({
  application: z.object({ name: z.string(), environment: z.string() }),
  control: z.object({ port: z.coerce.number().int(), allowedOrigins: z.array(z.string()) }),
  storage: z.object({
    driver: z.string(),
    directory: z.string(),
    fallbackDirectory: z.string().nullable()
  }),
  security: z.object({ accessKey: z.string() }),
  workers: z.record(z.string(), workerSchema),
  pipelines: z.record(z.string(), pipelineSchema),
  routing: z.object({ rules: z.array(ruleSchema), primaryRule: ruleSchema }),
  messages: z.object({ banner: z.string(), literal: z.string(), greeting: z.string() }),
  features: z.object({ audit: z.boolean(), telemetry: z.boolean() }),
  logging: z.object({ level: z.string() }),
  deploymentLabel: z.string().default('synthetic')
});

export function options(basePath: string) {
  return {
    argv: [],
    configDirEnvVar: 'PIPELINE_CONFIG_DIR',
    envNameEnvVar: 'PIPELINE_ENV',
    envOverrideObjectVar: 'PIPELINE_CONFIG',
    envOverridePrefix: 'PIPELINE_CONFIG_',
    inheritProcessEnv: false,
    env: {
      PIPELINE_CONFIG_DIR: basePath,
      PIPELINE_ENV: 'production',
      PIPELINE_EXAMPLE_ACCESS_KEY: 'synthetic-key-not-a-credential',
      PIPELINE_CONFIG: '{"control":{"port":4490},"logging":{"level":"warn"}}',
      PIPELINE_CONFIG_control_port: '4500',
      PIPELINE_CONFIG_pipelines_daily_destination_name: 'environment-primary',
      PIPELINE_CONFIG_workers_batch___runner_enabled: 'true'
    },
    schema
  };
}
