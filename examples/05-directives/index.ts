import { loadConfigObjectFromFiles } from '@gaia-framework/config';

console.log(
  JSON.stringify(loadConfigObjectFromFiles({ argv: [], env: { EXAMPLE_LABEL: 'demo' } }))
);
