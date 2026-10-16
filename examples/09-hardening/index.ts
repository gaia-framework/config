import { ConfigError, createConfigServiceFromFiles } from '@gaia-framework/config';

const settings = createConfigServiceFromFiles({
  argv: ['--config', 'config.yaml'],
  env: { EXAMPLE_PORT: '4002' },
  inheritProcessEnv: false,
  strictFiles: true,
  strictGetters: true,
  strictPaths: true,
  safeErrors: true,
  cache: false
});

let strictPathRejected = false;

try {
  settings.getString('.label');
} catch (error) {
  strictPathRejected = error instanceof ConfigError && error.code === 'CONFIG_PATH_INVALID';
}

console.log(
  JSON.stringify({
    port: settings.getNumber('port'),
    literal: settings.getString(['literal.name']),
    label: settings.getString('label'),
    strictPathRejected
  })
);
