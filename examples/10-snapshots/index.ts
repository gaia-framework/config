import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigLoader, createConfig, createConfigServiceFromFiles } from '@gaia-framework/config';

const settings = createConfigServiceFromFiles({
  argv: ['--config', 'config.yaml'],
  env: {},
  inheritProcessEnv: false,
  immutable: true
});

const input = { nested: { value: 'original' } };
const snapshot = createConfig(input, undefined, { immutable: true });
input.nested.value = 'changed';

let mutationRejected = false;

try {
  settings.getStringArray('list').push('two');
} catch (error) {
  mutationRejected = error instanceof TypeError;
}

const directory = mkdtempSync(path.join(tmpdir(), 'config-alias-example-'));
let aliasCycleDetected = false;

try {
  const filename = path.join(directory, 'cycle.yaml');
  cpSync('cycle.yaml', filename);
  symlinkSync(
    directory,
    path.join(directory, 'alias'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  try {
    new ConfigLoader().loadYamlConfig(filename);
  } catch (error) {
    aliasCycleDetected =
      error instanceof Error && error.message.startsWith('$include cycle detected:');
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log(
  JSON.stringify({
    paths: settings.keyPaths(),
    literal: settings.getString(['literal.name']),
    snapshotValue: snapshot.getString('nested.value'),
    mutationRejected,
    aliasCycleDetected
  })
);
