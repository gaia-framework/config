import { loadConfigObjectFromFiles } from '@gaia-framework/config';

console.log(JSON.stringify(loadConfigObjectFromFiles({ envName: 'production', env: {} })));
