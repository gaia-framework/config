import { loadConfigObjectFromFiles } from '@gaia-framework/config';

console.log(
  JSON.stringify(
    loadConfigObjectFromFiles({
      argv: [],
      env: {
        CONFIG: '{"port":4001,"enabled":false}',
        CONFIG_port: '4002',
        CONFIG_enabled: 'true',
        CONFIG_my___provider_under__score: 'demo'
      }
    })
  )
);
