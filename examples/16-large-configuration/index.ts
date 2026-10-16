import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { createConfigFromFiles } from '@gaia-framework/config';

const argument = process.argv.find((value) => value.startsWith('--records='));
const records = argument ? Number(argument.slice('--records='.length)) : 1000;
assert.ok(
  Number.isInteger(records) && records >= 1000 && records <= 10000,
  '--records must be an integer between 1000 and 10000.'
);
const directory = mkdtempSync(path.join(tmpdir(), 'config-large-example-'));
try {
  mkdirSync(path.join(directory, 'parts'));
  const fragments = [];
  for (let index = 0; index < 25; index++) {
    fragments.push(`group${index} = { "$include" = "./group${index}.toml" }`);
    writeFileSync(
      path.join(directory, 'parts', `group${index}.toml`),
      `rank = ${index}\nflags = ["synthetic", "enabled"]\n`
    );
  }

  writeFileSync(path.join(directory, 'parts', 'groups.toml'), fragments.join('\n'));
  const payload = 'synthetic '.repeat(160);
  const sections = [
    'port = "${EXAMPLE_PORT:-4000}"',
    'workerGroups = { "$include" = "./parts/groups.toml" }'
  ];
  for (let index = 0; index < records; index++) {
    sections.push(`[components.component${index}]\nvalue = ${index}\npayload = "${payload}"`);
  }

  const text = sections.join('\n\n');
  assert.ok(Buffer.byteLength(text) > 1024 * 1024);
  writeFileSync(path.join(directory, 'config.toml'), text);
  writeFileSync(path.join(directory, 'config.local.toml'), 'port = 4200');
  const reader = createConfigFromFiles({
    basePath: directory,
    fileFormat: 'toml',
    argv: [],
    env: { CONFIG: '{"port":4400}', CONFIG_port: '4500' },
    inheritProcessEnv: false,
    immutable: true,
    schema: z.object({
      port: z.coerce.number(),
      components: z.record(z.string(), z.object({ value: z.number(), payload: z.string() })),
      workerGroups: z.record(z.string(), z.object({ rank: z.number(), flags: z.array(z.string()) }))
    })
  });
  assert.equal(reader.getString(`components.component${records - 1}.payload`), payload);
  console.log(
    JSON.stringify({
      componentCount: Object.keys(reader.get('components')).length,
      groupCount: Object.keys(reader.get('workerGroups')).length,
      port: reader.getNumber('port'),
      lastValue: reader.getNumber(`components.component${records - 1}.value`),
      payloadChecked: true
    })
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
