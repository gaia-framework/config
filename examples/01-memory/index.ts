import { createConfigService } from '@gaia-framework/config';

const config = createConfigService({ http: { port: 4001 }, enabled: true });

console.log(
  JSON.stringify({ port: config.getNumber('http.port'), enabled: config.getBoolean('enabled') })
);
