import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    assert.ok(
      specifier !== 'inversify' &&
        !specifier.startsWith('inversify/') &&
        !specifier.startsWith('@inversifyjs/') &&
        specifier !== 'reflect-metadata' &&
        !specifier.startsWith('reflect-metadata/'),
      `Configuration must not load a DI dependency: ${specifier}`
    );

    return nextResolve(specifier, context);
  }
});
const directory = mkdtempSync(path.join(tmpdir(), 'config-without-di-'));

try {
  const library = await import('@gaia-framework/config');
  const reader = library.createConfig({ port: '4100', enabled: true });
  const service = library.createConfigService(reader);
  assert.equal(service.getNumber('port'), 4100);
  assert.equal(service.getBoolean('enabled'), true);
  assert.equal(new library.ConfigService(reader).getNumber('port'), 4100);

  writeFileSync(path.join(directory, 'config.yaml'), 'port: 4100\nchild:\n  $include: part.toml\n');
  writeFileSync(path.join(directory, 'part.toml'), 'enabled = true\n');
  const options = { basePath: directory, argv: [], env: {}, inheritProcessEnv: false };
  const expected = { port: 4100, child: { enabled: true } };
  assert.deepEqual(
    new library.ConfigLoader().loadYamlConfig(path.join(directory, 'config.yaml')),
    expected
  );
  assert.deepEqual(library.loadConfigLayersFromFiles(options), expected);
  assert.deepEqual(library.loadConfigObjectFromFiles(options), expected);
  assert.equal(library.createConfigFromFiles(options).getBoolean('child.enabled'), true);

  const cached = library.createConfigServiceFromFiles(options);
  assert.equal(cached.getNumber('port'), 4100);
  assert.equal(library.createConfigServiceFromFiles(options), cached);
  assert.notEqual(library.createConfigServiceFromFiles({ ...options, cache: false }), cached);
} finally {
  hooks.deregister();
  rmSync(directory, { recursive: true, force: true });
}
