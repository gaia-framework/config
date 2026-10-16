import { loadConfigLayersFromFiles, loadConfigObjectFromFiles } from '@gaia-framework/config';
import { z } from 'zod';

const options = {
  argv: [],
  env: {},
  schema: z.object({ port: z.coerce.number(), enabled: z.boolean().default(true) })
};

console.log(
  JSON.stringify({
    raw: loadConfigLayersFromFiles(options),
    validated: loadConfigObjectFromFiles(options)
  })
);
