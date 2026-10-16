import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigLoader } from '@gaia-framework/config';

const directory = mkdtempSync(path.join(tmpdir(), 'config-consumer-substitution-'));
const expressions = Array.from({ length: 1000 }, (_, index) => `\${ITEM_${index}:-${index}}`);
const expectedValues = expressions.map((_, index) => String(index));
const longFallback = 'x'.repeat(4096);
const data = {
  values: expressions,
  flag: '${VALUE:-false}',
  mixed: 'value=${VALUE:-false}',
  escaped: '$${VALUE}',
  long: `\${LONG:-${longFallback}}`,
  environment: { $env: 'VALUE' }
};

try {
  for (const format of ['yaml', 'toml']) {
    const source =
      format === 'yaml'
        ? JSON.stringify(data)
        : [
            `values = ${JSON.stringify(expressions)}`,
            `flag = ${JSON.stringify(data.flag)}`,
            `mixed = ${JSON.stringify(data.mixed)}`,
            `escaped = ${JSON.stringify(data.escaped)}`,
            `long = ${JSON.stringify(data.long)}`,
            'environment = { "$env" = "VALUE" }'
          ].join('\n');
    const filename = path.join(directory, `config.${format}`);

    writeFileSync(filename, source);

    const env = { VALUE: 'true' };
    const loader = new ConfigLoader({ env, inheritProcessEnv: false });

    assert.deepEqual(loader.loadConfigFile(filename), {
      values: expectedValues,
      flag: true,
      mixed: 'value=true',
      escaped: '${VALUE}',
      long: longFallback,
      environment: 'true'
    });

    env.VALUE = 'false';

    assert.deepEqual(loader.loadConfigFile(filename), {
      values: expectedValues,
      flag: false,
      mixed: 'value=false',
      escaped: '${VALUE}',
      long: longFallback,
      environment: 'false'
    });
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
