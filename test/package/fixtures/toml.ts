import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Container } from 'inversify';
import {
  ConfigLoader,
  ConfigReader,
  ConfigService,
  createConfigFromFiles
} from '@gaia-framework/config';

const directory = mkdtempSync(path.join(tmpdir(), 'config-toml-consumer-'));
try {
  const filename = path.join(directory, 'config.toml');
  writeFileSync(
    filename,
    'port = 4000\nclear = { "$null" = true }\nvalue = { "$include" = "./part.yaml" }'
  );
  writeFileSync(path.join(directory, 'part.yaml'), 'enabled: true');
  const expected = { port: 4000, clear: null, value: { enabled: true } };
  const loader = new ConfigLoader();
  assert.deepEqual(loader.loadTomlConfig(filename), expected);
  assert.deepEqual(loader.loadConfigFile(filename), expected);
  const reader = createConfigFromFiles({
    basePath: directory,
    fileFormat: 'toml',
    argv: [],
    inheritProcessEnv: false
  });
  const container = new Container();
  container.bind(ConfigReader).toConstantValue(reader);
  container
    .bind(ConfigService)
    .toDynamicValue((context) => new ConfigService(context.get(ConfigReader)));

  assert.equal(container.get(ConfigService).getNumber('port'), 4000);
  assert.equal(reader.getBoolean('value.enabled'), true);
  assert.equal(reader.getOptional('clear'), undefined);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
