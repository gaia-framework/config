import { loadConfigObjectFromFiles } from '@gaia-framework/config';

console.log(
  JSON.stringify(
    loadConfigObjectFromFiles({ argv: [], env: { EXAMPLE_NAME: 'demo', EXAMPLE_ENABLED: 'true' } })
  )
);
