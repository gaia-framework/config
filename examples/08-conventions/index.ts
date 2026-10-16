import { loadConfigObjectFromFiles } from '@gaia-framework/config';

const service = loadConfigObjectFromFiles({
  argv: [],
  inheritProcessEnv: false,
  configDirEnvVar: 'SERVICE_CONFIG_DIR',
  envNameEnvVar: 'SERVICE_ENV',
  envOverrideObjectVar: 'SERVICE_CONFIG',
  envOverridePrefix: 'SERVICE_CONFIG_',
  env: { SERVICE_CONFIG_DIR: process.cwd(), SERVICE_ENV: 'production', SERVICE_CONFIG_port: '4001' }
});

const platform = loadConfigObjectFromFiles({
  argv: [],
  inheritProcessEnv: false,
  configDirEnvVar: 'PLATFORM_CONFIG_DIR',
  envNameEnvVar: 'PLATFORM_ENV',
  envOverrideObjectVar: 'PLATFORM_CONFIG',
  envOverridePrefix: 'PLATFORM_CONFIG_',
  env: {
    PLATFORM_CONFIG_DIR: process.cwd(),
    PLATFORM_ENV: 'production',
    PLATFORM_CONFIG_port: '4002'
  }
});

console.log(JSON.stringify({ service, platform }));
